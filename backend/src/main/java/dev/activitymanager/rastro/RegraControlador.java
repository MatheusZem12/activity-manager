package dev.activitymanager.rastro;

import dev.activitymanager.comum.ErroDeUso;
import dev.activitymanager.seguranca.Conta;
import java.time.Instant;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * As regras do usuário: classe de janela e trecho de título → categoria e projeto.
 *
 * Vale a pena ter isto antes da IA por dois motivos. É de graça — nenhuma
 * chamada a modelo nenhum. E é determinístico: `202602` no título de uma janela
 * do Teams é faculdade, sempre, e nenhum modelo pequeno vai discordar disso às
 * três da manhã.
 */
@RestController
@RequestMapping("/api/regras")
public class RegraControlador {

    public record Entrada(Integer ordem, String wmClass, String tituloRegex,
                          Long categoriaId, String projeto) {}

    public record Saida(Long id, int ordem, String wmClass, String tituloRegex,
                        Long categoriaId, String projeto) {
        static Saida de(Regra r) {
            return new Saida(r.getId(), r.getOrdem(), r.getWmClass(), r.getTituloRegex(),
                             r.getCategoriaId(), r.getProjeto());
        }
    }

    private final RegraRepositorio regras;
    private final ReclassificadorServico reclassificador;

    public RegraControlador(RegraRepositorio regras, ReclassificadorServico reclassificador) {
        this.regras = regras;
        this.reclassificador = reclassificador;
    }

    @GetMapping
    public Map<String, Object> listar() {
        var lista = regras.findByUsuarioIdAndApagadaEmIsNullOrderByOrdemAsc(Conta.id());
        return Map.of("regras", lista.stream().map(Saida::de).toList());
    }

    @PostMapping
    @Transactional
    public Saida criar(@RequestBody Entrada entrada) {
        var usuarioId = Conta.id();
        var r = new Regra();
        r.setUsuarioId(usuarioId);
        aplicar(r, entrada);
        var salva = regras.save(r);
        // Regra nova vale para trás. É a razão de a regra morar aqui e não no
        // coletor: os fatos estão guardados, então dá para reprocessar.
        reclassificador.reprocessar(usuarioId);
        return Saida.de(salva);
    }

    @PatchMapping("/{id}")
    @Transactional
    public Saida alterar(@PathVariable Long id, @RequestBody Entrada entrada) {
        var usuarioId = Conta.id();
        var r = regras.findById(id)
                .filter(x -> x.getUsuarioId().equals(usuarioId))
                .orElseThrow(() -> ErroDeUso.naoEncontrado("Regra não encontrada."));
        aplicar(r, entrada);
        var salva = regras.save(r);
        reclassificador.reprocessar(usuarioId);
        return Saida.de(salva);
    }

    @DeleteMapping("/{id}")
    @Transactional
    public Map<String, String> apagar(@PathVariable Long id) {
        var usuarioId = Conta.id();
        regras.findById(id).filter(x -> x.getUsuarioId().equals(usuarioId)).ifPresent(r -> {
            r.setApagadaEm(Instant.now());
            regras.save(r);
        });
        reclassificador.reprocessar(usuarioId);
        return Map.of("estado", "ok");
    }

    private void aplicar(Regra r, Entrada e) {
        if (e.ordem() != null) r.setOrdem(e.ordem());
        r.setWmClass(vazioComoNulo(e.wmClass()));
        r.setTituloRegex(vazioComoNulo(e.tituloRegex()));
        r.setCategoriaId(e.categoriaId());
        r.setProjeto(vazioComoNulo(e.projeto()));

        if (r.getWmClass() == null && r.getTituloRegex() == null) {
            throw ErroDeUso.pedidoInvalido("A regra precisa de uma classe de janela ou de um trecho de título.");
        }
        // Regex quebrada é recusada aqui, e não descoberta em silêncio na
        // próxima classificação.
        if (r.getTituloRegex() != null) {
            try {
                Pattern.compile(r.getTituloRegex());
            } catch (PatternSyntaxException ex) {
                throw ErroDeUso.pedidoInvalido("Expressão inválida: " + ex.getDescription());
            }
        }
    }

    private String vazioComoNulo(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
