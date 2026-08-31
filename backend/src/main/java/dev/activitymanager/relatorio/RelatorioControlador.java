package dev.activitymanager.relatorio;

import dev.activitymanager.rastro.Categoria;
import dev.activitymanager.rastro.CategoriaServico;
import dev.activitymanager.rastro.CategoriaRepositorio;
import dev.activitymanager.rastro.ClassificacaoRepositorio;
import dev.activitymanager.rastro.SegmentoRepositorio;
import dev.activitymanager.rastro.Segmento;
import dev.activitymanager.seguranca.Conta;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

/**
 * Para onde foi o seu tempo.
 *
 * O relatório é distribuição, não nota. Um placar de produtividade vira um
 * número que se contorna nos dias ruins; "3h12 em estudo esta semana, contra
 * 1h48 na passada" é uma frase sobre a qual dá para agir.
 */
@RestController
@RequestMapping("/api/relatorio")
public class RelatorioControlador {

    public record Fatia(String chave, String nome, String cor, long segundos) {}

    private final SegmentoRepositorio segmentos;
    private final CategoriaServico categorias;

    public RelatorioControlador(SegmentoRepositorio segmentos, CategoriaServico categorias) {
        this.segmentos = segmentos;
        this.categorias = categorias;
    }

    @GetMapping
    public Map<String, Object> relatorio(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant de,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant ate) {

        var usuarioId = Conta.id();
        var lista = segmentos.findByUsuarioIdAndInicioBetweenOrderByInicioAsc(usuarioId, de, ate);

        Map<Long, Categoria> porId = new HashMap<>();
        for (var c : categorias.listar(usuarioId)) porId.put(c.getId(), c);

        Map<Long, Long> porCategoria = new LinkedHashMap<>();
        Map<String, Long> porProjeto = new LinkedHashMap<>();
        Map<String, Long> porApp = new LinkedHashMap<>();
        long ocioso = 0;
        long semCategoria = 0;

        for (Segmento s : lista) {
            if (s.isOcioso()) {
                ocioso += s.getSegundos();
                continue;
            }
            if (s.getCategoriaId() == null) {
                semCategoria += s.getSegundos();
            } else {
                porCategoria.merge(s.getCategoriaId(), (long) s.getSegundos(), Long::sum);
            }
            if (s.getProjeto() != null) {
                porProjeto.merge(s.getProjeto(), (long) s.getSegundos(), Long::sum);
            }
            if (s.getWmClass() != null) {
                porApp.merge(s.getWmClass(), (long) s.getSegundos(), Long::sum);
            }
        }

        List<Fatia> categoriasSaida = new ArrayList<>();
        porCategoria.entrySet().stream()
                .sorted(Map.Entry.<Long, Long>comparingByValue().reversed())
                .forEach(e -> {
                    var c = porId.get(e.getKey());
                    categoriasSaida.add(new Fatia(
                            c == null ? "?" : c.getChave(),
                            c == null ? "?" : c.getNome(),
                            c == null ? "#888888" : c.getCor(),
                            e.getValue()));
                });

        return Map.of(
                "de", de,
                "ate", ate,
                "categorias", categoriasSaida,
                "projetos", ordenar(porProjeto),
                "apps", ordenar(porApp),
                "ociosoSegundos", ocioso,
                // O que nem regra, nem cache, nem IA resolveram ainda. Fica
                // visível de propósito: relatório que esconde o que não sabe
                // mente por omissão.
                "naoClassificadoSegundos", semCategoria,
                "segmentos", lista.size());
    }

    private List<Map<String, Object>> ordenar(Map<String, Long> bruto) {
        return bruto.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .map(e -> Map.<String, Object>of("nome", e.getKey(), "segundos", e.getValue()))
                .toList();
    }
}
