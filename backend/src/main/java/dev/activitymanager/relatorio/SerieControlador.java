package dev.activitymanager.relatorio;

import dev.activitymanager.rastro.Categoria;
import dev.activitymanager.rastro.CategoriaServico;
import dev.activitymanager.rastro.Segmento;
import dev.activitymanager.rastro.SegmentoRepositorio;
import dev.activitymanager.seguranca.Conta;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

/**
 * A mesma agregação do relatório, mas por dia.
 *
 * Um total do dia responde "onde foi o meu tempo hoje". A série responde outra
 * pergunta, que é a que faz alguém mudar de hábito: "estou estudando mais ou
 * menos que na semana passada". Uma barra sozinha não tem como dizer isso.
 *
 * O corte do dia é pelo fuso do cliente, e não UTC. Segmento das 22h de um dia
 * cairia no dia seguinte se agrupado em UTC, e o relatório mostraria madrugadas
 * de trabalho que nunca aconteceram.
 */
@RestController
@RequestMapping("/api/relatorio/serie")
public class SerieControlador {

    /** Um dia, e quanto tempo por categoria nele. */
    public record Dia(String data, Map<String, Long> categorias, long ocioso, long naoClassificado) {}

    private final SegmentoRepositorio segmentos;
    private final CategoriaServico categorias;

    public SerieControlador(SegmentoRepositorio segmentos, CategoriaServico categorias) {
        this.segmentos = segmentos;
        this.categorias = categorias;
    }

    @GetMapping
    public Map<String, Object> serie(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant de,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant ate,
            @RequestParam(defaultValue = "UTC") String fuso) {

        var usuarioId = Conta.id();
        var zona = zonaValida(fuso);
        var lista = segmentos.findByUsuarioIdAndInicioBetweenOrderByInicioAsc(usuarioId, de, ate);

        Map<Long, Categoria> porId = new LinkedHashMap<>();
        for (var c : categorias.listar(usuarioId)) porId.put(c.getId(), c);

        // LinkedHashMap com todos os dias semeados: dia sem uso é informação —
        // um buraco no gráfico diz "não usei o computador", e pular o dia diria
        // outra coisa (que a semana foi mais curta).
        Map<LocalDate, Dia> porDia = new LinkedHashMap<>();
        var primeiro = LocalDate.ofInstant(de, zona);
        var ultimo = LocalDate.ofInstant(ate.minusSeconds(1), zona);
        for (var d = primeiro; !d.isAfter(ultimo); d = d.plusDays(1)) {
            porDia.put(d, new Dia(d.toString(), new LinkedHashMap<>(), 0, 0));
        }

        Map<LocalDate, long[]> extras = new LinkedHashMap<>();   // [ocioso, naoClassificado]

        for (Segmento s : lista) {
            var dia = LocalDate.ofInstant(s.getInicio(), zona);
            var registro = porDia.get(dia);
            if (registro == null) continue;
            var extra = extras.computeIfAbsent(dia, k -> new long[2]);

            if (s.isOcioso()) {
                extra[0] += s.getSegundos();
            } else if (s.getCategoriaId() == null) {
                extra[1] += s.getSegundos();
            } else {
                var c = porId.get(s.getCategoriaId());
                if (c != null) registro.categorias().merge(c.getChave(), (long) s.getSegundos(), Long::sum);
            }
        }

        List<Dia> saida = new ArrayList<>();
        for (var e : porDia.entrySet()) {
            var extra = extras.getOrDefault(e.getKey(), new long[2]);
            saida.add(new Dia(e.getValue().data(), e.getValue().categorias(), extra[0], extra[1]));
        }

        return Map.of(
                "dias", saida,
                "categorias", categorias.listar(usuarioId).stream()
                        .map(c -> Map.of("chave", c.getChave(), "nome", c.getNome(), "cor", c.getCor()))
                        .toList());
    }

    /** Fuso inválido vira UTC em vez de derrubar o relatório inteiro. */
    private ZoneId zonaValida(String fuso) {
        try {
            return ZoneId.of(fuso);
        } catch (Exception e) {
            return ZoneId.of("UTC");
        }
    }
}
