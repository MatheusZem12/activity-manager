package dev.activitymanager.rastro;

import dev.activitymanager.seguranca.Conta;
import dev.activitymanager.usuario.Dispositivo;
import dev.activitymanager.usuario.DispositivoRepositorio;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * A porta de entrada do rastreio.
 *
 * O dispositivo manda o que observou, em lote, e nada mais: nenhuma conclusão
 * sobre o que aquilo significa. A classificação acontece aqui.
 */
@RestController
@RequestMapping("/api/segmentos")
public class SegmentoControlador {

    /** Um segmento como o coletor viu: só fatos. */
    public record Entrada(@NotNull Instant inicio,
                          @NotNull Instant fim,
                          String wmClass,
                          String titulo,
                          boolean travado,
                          boolean midia) {}

    public record Lote(@NotBlank String dispositivo,
                       List<String> executores,
                       @Valid List<Entrada> segmentos) {}

    private final SegmentoRepositorio segmentos;
    private final DispositivoRepositorio dispositivos;
    private final ClassificadorServico classificador;

    public SegmentoControlador(SegmentoRepositorio segmentos,
                               DispositivoRepositorio dispositivos,
                               ClassificadorServico classificador) {
        this.segmentos = segmentos;
        this.dispositivos = dispositivos;
        this.classificador = classificador;
    }

    @PostMapping
    @Transactional
    public Map<String, Object> receber(@Valid @RequestBody Lote lote) {
        var usuarioId = Conta.id();
        var dispositivo = registrar(usuarioId, lote);
        var ctx = classificador.contexto(usuarioId);

        int gravados = 0;
        int repetidos = 0;

        for (var entrada : lote.segmentos() == null ? List.<Entrada>of() : lote.segmentos()) {
            // O coletor reenvia o que não teve confirmação — é assim que ele
            // sobrevive a ficar offline. A chave (usuário, dispositivo, início)
            // torna o reenvio inofensivo.
            if (segmentos.existsByUsuarioIdAndDispositivoIdAndInicio(
                    usuarioId, dispositivo.getId(), entrada.inicio())) {
                repetidos++;
                continue;
            }

            var s = new Segmento();
            s.setUsuarioId(usuarioId);
            s.setDispositivoId(dispositivo.getId());
            s.setInicio(entrada.inicio());
            s.setFim(entrada.fim());
            s.setSegundos((int) Math.max(0, entrada.fim().getEpochSecond() - entrada.inicio().getEpochSecond()));
            s.setWmClass(entrada.wmClass());
            s.setTitulo(entrada.titulo());
            s.setTravado(entrada.travado());
            s.setMidia(entrada.midia());

            classificador.classificar(s, ctx);
            segmentos.save(s);
            gravados++;
        }

        return Map.of("gravados", gravados, "repetidos", repetidos, "dispositivo", dispositivo.getId());
    }

    /**
     * O dispositivo se apresenta a cada envio. `executores` não é segredo, é
     * capacidade: é como o servidor sabe a quem pode entregar uma tarefa de
     * classificação que só roda numa máquina local.
     */
    private Dispositivo registrar(Long usuarioId, Lote lote) {
        var dispositivo = dispositivos.findByUsuarioIdAndNome(usuarioId, lote.dispositivo())
                .orElseGet(() -> {
                    var novo = new Dispositivo();
                    novo.setUsuarioId(usuarioId);
                    novo.setNome(lote.dispositivo());
                    return novo;
                });
        if (lote.executores() != null) {
            dispositivo.setExecutores(lote.executores().toArray(String[]::new));
        }
        dispositivo.setVistoEm(Instant.now());
        return dispositivos.save(dispositivo);
    }
}
