package dev.activitymanager.atividade;

import dev.activitymanager.comum.ErroDeUso;
import dev.activitymanager.seguranca.Conta;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * As atividades, agora no banco.
 *
 * O parsing de `#tag` e `!30` continua no dispositivo — é entrada de texto, e
 * mostrar o preview enquanto se digita exige que aconteça ali. O que chega aqui
 * já vem separado em texto, tags e intervalo.
 *
 * O que é regra de negócio e mora aqui: quando o próximo alerta vence, o que
 * adiar faz, e o que concluir e reabrir significam.
 */
@RestController
@RequestMapping("/api/atividades")
public class AtividadeControlador {

    public record Entrada(String texto, List<String> tags, Integer alertaMin,
                          Instant venceEm, Instant criadaEm, Instant concluidaEm) {}

    public record Saida(Long id, String texto, List<String> tags, Integer alertaMin,
                        Instant venceEm, Instant criadaEm, Instant concluidaEm) {
        static Saida de(Atividade a) {
            return new Saida(a.getId(), a.getTexto(), List.of(a.getTags()), a.getAlertaMin(),
                             a.getVenceEm(), a.getCriadaEm(), a.getConcluidaEm());
        }
    }

    private final AtividadeRepositorio atividades;

    public AtividadeControlador(AtividadeRepositorio atividades) {
        this.atividades = atividades;
    }

    @GetMapping
    public Map<String, Object> listar() {
        return Map.of("atividades",
                atividades.findByUsuarioIdAndApagadaEmIsNullOrderByCriadaEmDesc(Conta.id())
                        .stream().map(Saida::de).toList());
    }

    @PostMapping
    @Transactional
    public Saida criar(@RequestBody Entrada entrada) {
        if (entrada.texto() == null || entrada.texto().isBlank()) {
            throw ErroDeUso.pedidoInvalido("A atividade precisa de um texto.");
        }
        var a = new Atividade();
        a.setUsuarioId(Conta.id());
        a.setCriadaEm(entrada.criadaEm() != null ? entrada.criadaEm() : Instant.now());
        aplicar(a, entrada);

        // Importação traz o estado junto: uma atividade que já estava concluída
        // não pode voltar para a lista de pendentes só por mudar de banco.
        if (entrada.concluidaEm() != null) a.setConcluidaEm(entrada.concluidaEm());

        // Concluída não alerta. Sem vencimento explícito, o alerta é daqui a
        // `alertaMin` minutos.
        if (a.getConcluidaEm() != null) {
            a.setVenceEm(null);
        } else if (a.getVenceEm() == null && a.getAlertaMin() != null) {
            a.setVenceEm(a.getCriadaEm().plus(a.getAlertaMin(), ChronoUnit.MINUTES));
        }
        return Saida.de(atividades.save(a));
    }

    @PatchMapping("/{id}")
    @Transactional
    public Saida alterar(@PathVariable Long id, @RequestBody Entrada entrada) {
        var a = minha(id);
        // Editar sem informar novo intervalo preserva o alerta atual — mexer no
        // texto de uma atividade não deveria zerar o lembrete dela.
        aplicar(a, entrada);
        a.setAtualizadaEm(Instant.now());
        return Saida.de(atividades.save(a));
    }

    /** Adiar reagenda o vencimento sem tocar no intervalo. */
    @PostMapping("/{id}/adiar")
    @Transactional
    public Saida adiar(@PathVariable Long id, @RequestBody Map<String, Integer> corpo) {
        var a = minha(id);
        var minutos = corpo.getOrDefault("minutos",
                a.getAlertaMin() == null ? 30 : a.getAlertaMin());
        a.setVenceEm(Instant.now().plus(minutos, ChronoUnit.MINUTES));
        a.setAtualizadaEm(Instant.now());
        return Saida.de(atividades.save(a));
    }

    @PostMapping("/{id}/concluir")
    @Transactional
    public Saida concluir(@PathVariable Long id) {
        var a = minha(id);
        a.setConcluidaEm(Instant.now());
        // Concluída não alerta mais: o vencimento sai junto, senão o alerta
        // continuaria repetindo no intervalo.
        a.setVenceEm(null);
        a.setAtualizadaEm(Instant.now());
        return Saida.de(atividades.save(a));
    }

    @PostMapping("/{id}/reabrir")
    @Transactional
    public Saida reabrir(@PathVariable Long id) {
        var a = minha(id);
        a.setConcluidaEm(null);
        if (a.getAlertaMin() != null) {
            a.setVenceEm(Instant.now().plus(a.getAlertaMin(), ChronoUnit.MINUTES));
        }
        a.setAtualizadaEm(Instant.now());
        return Saida.de(atividades.save(a));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public Map<String, String> apagar(@PathVariable Long id) {
        var a = minha(id);
        a.setApagadaEm(Instant.now());
        a.setAtualizadaEm(Instant.now());
        atividades.save(a);
        return Map.of("estado", "ok");
    }

    /**
     * Importação em lote dos JSON que o app guardava localmente.
     *
     * Existe uma vez na vida de cada máquina, e é o que impede a mudança para o
     * banco de custar o histórico de quem já usava o app.
     */
    @PostMapping("/importar")
    @Transactional
    public Map<String, Object> importar(@RequestBody List<Entrada> lote) {
        var usuarioId = Conta.id();
        var existentes = atividades.findByUsuarioIdAndApagadaEmIsNullOrderByCriadaEmDesc(usuarioId);
        int importadas = 0;
        for (var entrada : lote == null ? List.<Entrada>of() : lote) {
            if (entrada.texto() == null || entrada.texto().isBlank()) continue;
            // Texto igual criado no mesmo SEGUNDO é o mesmo registro.
            //
            // Ao segundo, e não ao milissegundo: um cliente que serialize o
            // instante sem os milissegundos criaria uma cópia de tudo — e foi
            // exatamente o que aconteceu na primeira migração. Segundo ainda
            // distingue itens de verdade e tolera diferença de formatação.
            var repetida = existentes.stream().anyMatch(a ->
                    a.getTexto().equals(entrada.texto())
                    && mesmoSegundo(a.getCriadaEm(), entrada.criadaEm()));
            if (repetida) continue;
            criar(entrada);
            importadas++;
        }
        return Map.of("importadas", importadas, "recebidas", lote == null ? 0 : lote.size());
    }

    /** Compara instantes ignorando os milissegundos. Veja o porquê em `importar`. */
    private static boolean mesmoSegundo(java.time.Instant a, java.time.Instant b) {
        if (a == null || b == null) return a == b;
        return a.getEpochSecond() == b.getEpochSecond();
    }

    private void aplicar(Atividade a, Entrada e) {
        if (e.texto() != null) a.setTexto(e.texto());
        if (e.tags() != null) a.setTags(e.tags().toArray(String[]::new));
        if (e.alertaMin() != null) a.setAlertaMin(e.alertaMin());
        if (e.venceEm() != null) a.setVenceEm(e.venceEm());
    }

    private Atividade minha(Long id) {
        return atividades.findById(id)
                .filter(a -> a.getUsuarioId().equals(Conta.id()))
                .orElseThrow(() -> ErroDeUso.naoEncontrado("Atividade não encontrada."));
    }
}
