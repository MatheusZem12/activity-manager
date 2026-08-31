package dev.activitymanager.texto;

import dev.activitymanager.comum.ErroDeUso;
import dev.activitymanager.seguranca.Conta;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * Os textos do clipboard, agora no banco.
 *
 * A regra que não pode ser quebrada aqui: o `conteudo` é gravado **literalmente**.
 * Nada de trim, nada de normalizar quebra de linha, nada de "limpar espaços" —
 * é exatamente isso que vai para o clipboard, e uma limpeza bem-intencionada
 * muda o que a pessoa cola.
 */
@RestController
@RequestMapping("/api/textos")
public class TextoControlador {

    public record Entrada(String titulo, String conteudo, List<String> tags,
                          Integer copias, Instant copiadoEm, Instant criadoEm) {}

    public record Saida(Long id, String titulo, String conteudo, List<String> tags,
                        int copias, Instant copiadoEm, Instant criadoEm) {
        static Saida de(Texto t) {
            return new Saida(t.getId(), t.getTitulo(), t.getConteudo(), List.of(t.getTags()),
                             t.getCopias(), t.getCopiadoEm(), t.getCriadoEm());
        }
    }

    private final TextoRepositorio textos;

    public TextoControlador(TextoRepositorio textos) {
        this.textos = textos;
    }

    @GetMapping
    public Map<String, Object> listar() {
        return Map.of("textos",
                textos.findByUsuarioIdAndApagadoEmIsNullOrderByCriadoEmDesc(Conta.id())
                        .stream().map(Saida::de).toList());
    }

    @PostMapping
    @Transactional
    public Saida criar(@RequestBody Entrada entrada) {
        if (entrada.conteudo() == null || entrada.conteudo().isEmpty()) {
            throw ErroDeUso.pedidoInvalido("O texto precisa de conteúdo.");
        }
        var t = new Texto();
        t.setUsuarioId(Conta.id());
        t.setCriadoEm(entrada.criadoEm() != null ? entrada.criadoEm() : Instant.now());
        aplicar(t, entrada);
        return Saida.de(textos.save(t));
    }

    @PatchMapping("/{id}")
    @Transactional
    public Saida alterar(@PathVariable Long id, @RequestBody Entrada entrada) {
        var t = meu(id);
        aplicar(t, entrada);
        t.setAtualizadoEm(Instant.now());
        return Saida.de(textos.save(t));
    }

    /**
     * Registra que o texto foi copiado.
     *
     * A cópia em si acontece no dispositivo — é o clipboard do sistema, e o
     * servidor não alcança isso. O que é registrado aqui é o contador, que
     * alimenta a ordenação por "Copiados".
     */
    @PostMapping("/{id}/copiar")
    @Transactional
    public Saida copiar(@PathVariable Long id) {
        var t = meu(id);
        t.setCopias(t.getCopias() + 1);
        t.setCopiadoEm(Instant.now());
        t.setAtualizadoEm(Instant.now());
        return Saida.de(textos.save(t));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public Map<String, String> apagar(@PathVariable Long id) {
        var t = meu(id);
        t.setApagadoEm(Instant.now());
        t.setAtualizadoEm(Instant.now());
        textos.save(t);
        return Map.of("estado", "ok");
    }

    /** Importação em lote do `entries.json` que o app guardava localmente. */
    @PostMapping("/importar")
    @Transactional
    public Map<String, Object> importar(@RequestBody List<Entrada> lote) {
        var existentes = textos.findByUsuarioIdAndApagadoEmIsNullOrderByCriadoEmDesc(Conta.id());
        int importados = 0;
        for (var entrada : lote == null ? List.<Entrada>of() : lote) {
            if (entrada.conteudo() == null || entrada.conteudo().isEmpty()) continue;
            // Ao segundo, não ao milissegundo: um cliente que serialize sem os
            // milissegundos duplicaria o acervo inteiro.
            var repetido = existentes.stream().anyMatch(t ->
                    t.getConteudo().equals(entrada.conteudo())
                    && mesmoSegundo(t.getCriadoEm(), entrada.criadoEm()));
            if (repetido) continue;
            criar(entrada);
            importados++;
        }
        return Map.of("importados", importados, "recebidos", lote == null ? 0 : lote.size());
    }

    private static boolean mesmoSegundo(Instant a, Instant b) {
        if (a == null || b == null) return a == b;
        return a.getEpochSecond() == b.getEpochSecond();
    }

    private void aplicar(Texto t, Entrada e) {
        if (e.titulo() != null) t.setTitulo(e.titulo());
        // `!= null` e não `isBlank`: conteúdo que é só espaço em branco é
        // conteúdo válido — alguém salvou um trecho indentado de propósito.
        if (e.conteudo() != null) t.setConteudo(e.conteudo());
        if (e.tags() != null) t.setTags(e.tags().toArray(String[]::new));
        if (e.copias() != null) t.setCopias(e.copias());
        if (e.copiadoEm() != null) t.setCopiadoEm(e.copiadoEm());
    }

    private Texto meu(Long id) {
        return textos.findById(id)
                .filter(t -> t.getUsuarioId().equals(Conta.id()))
                .orElseThrow(() -> ErroDeUso.naoEncontrado("Texto não encontrado."));
    }
}
