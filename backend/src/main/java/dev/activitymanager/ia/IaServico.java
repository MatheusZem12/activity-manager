package dev.activitymanager.ia;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.activitymanager.comum.Config;
import dev.activitymanager.rastro.Categoria;
import dev.activitymanager.rastro.CategoriaServico;
import dev.activitymanager.rastro.Classificacao;
import dev.activitymanager.rastro.ClassificadorServico;
import dev.activitymanager.rastro.CategoriaRepositorio;
import dev.activitymanager.rastro.ClassificacaoRepositorio;
import dev.activitymanager.rastro.SegmentoRepositorio;
import dev.activitymanager.rastro.Segmento;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * O que perguntar ao modelo, e o que fazer com a resposta.
 *
 * Tudo o que é decisão está aqui: quais títulos ainda precisam ser
 * classificados, como o prompt é escrito a partir das categorias do usuário,
 * qual o formato obrigatório da resposta, e o que fazer com ela. O que NÃO está
 * aqui é a chamada ao modelo quando ele é local — essa é a única parte que
 * precisa acontecer na máquina do usuário.
 */
@Service
public class IaServico {

    private static final Logger log = LoggerFactory.getLogger(IaServico.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    /** Quantos títulos por pergunta. Lote grande economiza; grande demais confunde. */
    private static final int TAMANHO_DO_LOTE = 40;

    private final SegmentoRepositorio segmentos;
    private final ClassificacaoRepositorio classificacoes;
    private final IaTarefaRepositorio tarefas;
    private final CategoriaServico categoriaServico;
    private final Config config;

    public IaServico(SegmentoRepositorio segmentos,
                     ClassificacaoRepositorio classificacoes,
                     IaTarefaRepositorio tarefas,
                     CategoriaServico categoriaServico,
                     Config config) {
        this.segmentos = segmentos;
        this.classificacoes = classificacoes;
        this.tarefas = tarefas;
        this.categoriaServico = categoriaServico;
        this.config = config;
    }

    // ------------------------------------------------------------- perguntar

    /**
     * Junta o que está pendente e cria as tarefas.
     *
     * Um título só entra uma vez, mesmo aparecendo em cinquenta segmentos — é o
     * que faz o custo cair de milhares de perguntas por dia para dezenas.
     */
    @Transactional
    public int enfileirar(Long usuarioId) {
        var pendentes = segmentos.pendentes(usuarioId);
        if (pendentes.isEmpty()) return 0;

        var categorias = categoriaServico.listar(usuarioId);
        if (categorias.isEmpty()) return 0;

        // O que já está na fila não volta para ela. Sem isto, chamar `enfileirar`
        // duas vezes cria duas perguntas idênticas — e o modelo é cobrado (ou o
        // seu processador ocupado) duas vezes pela mesma resposta.
        var jaPerguntado = new HashSet<String>();
        for (var t : tarefas.findByUsuarioIdAndEstadoNot(usuarioId, "concluida")) {
            jaPerguntado.addAll(List.of(t.getChaves()));
        }

        // LinkedHashMap: a ordem do prompt tem que casar com a ordem das chaves,
        // porque a resposta vem por índice.
        Map<String, Segmento> distintos = new LinkedHashMap<>();
        for (var s : pendentes) {
            var chave = ClassificadorServico.chave(s);
            if (jaPerguntado.contains(chave)) continue;
            distintos.putIfAbsent(chave, s);
        }
        if (distintos.isEmpty()) return 0;

        var chaves = new ArrayList<>(distintos.keySet());
        int criadas = 0;

        for (int i = 0; i < chaves.size(); i += TAMANHO_DO_LOTE) {
            var fatia = chaves.subList(i, Math.min(i + TAMANHO_DO_LOTE, chaves.size()));
            var tarefa = new IaTarefa();
            tarefa.setUsuarioId(usuarioId);
            tarefa.setPrompt(prompt(categorias, fatia.stream().map(distintos::get).toList()));
            tarefa.setEsquema(esquema(categorias));
            tarefa.setChaves(fatia.toArray(String[]::new));
            tarefas.save(tarefa);
            criadas++;
        }
        return criadas;
    }

    /**
     * O prompt, montado a partir das categorias do usuário.
     *
     * A `descricao` de cada categoria é o que faz o trabalho: sem ela o modelo
     * classifica pela ideia dele de "estudo"; com ela, classifica pela do dono
     * da conta.
     */
    private String prompt(List<Categoria> categorias, List<Segmento> amostras) {
        var texto = new StringBuilder();
        texto.append("Você classifica atividades de computador nas categorias definidas por esta pessoa.\n\n");
        texto.append("CATEGORIAS:\n");
        for (var c : categorias) {
            texto.append("- ").append(c.getChave()).append(": ").append(c.getNome());
            if (!c.getDescricao().isBlank()) texto.append(" — ").append(c.getDescricao());
            texto.append('\n');
        }
        texto.append("- nao_classificado: nenhuma das acima serve, ou não há informação suficiente.\n\n");
        texto.append("""
                Cada item abaixo é uma janela que esteve em foco: a classe do aplicativo e o \
                título da janela. Decida a categoria de cada um pelo índice.

                Use nao_classificado sem hesitar quando for o caso. Forçar um encaixe ruim \
                produz um relatório que parece certo e está errado, o que é pior do que um \
                buraco visível.

                Marque confianca como baixa quando o título for genérico ou ambíguo — esses \
                vão para revisão humana em vez de serem aplicados direto.

                ITENS:
                """);
        for (int i = 0; i < amostras.size(); i++) {
            var s = amostras.get(i);
            texto.append(i).append(". [").append(s.getWmClass() == null ? "?" : s.getWmClass()).append("] ")
                 .append(s.getTitulo() == null ? "" : s.getTitulo()).append('\n');
        }
        return texto.toString();
    }

    /**
     * O schema, com o enum montado a partir das chaves do usuário.
     *
     * É o enum — e não instrução em prosa — que garante que o modelo não invente
     * categoria. Prosa ele às vezes ignora; enum de saída estruturada, não.
     */
    private String esquema(List<Categoria> categorias) {
        var chaves = new ArrayList<String>();
        for (var c : categorias) chaves.add(c.getChave());
        chaves.add("nao_classificado");

        var item = Map.of(
                "type", "object",
                "properties", Map.of(
                        "i", Map.of("type", "integer"),
                        "categoria", Map.of("type", "string", "enum", chaves),
                        "confianca", Map.of("type", "string", "enum", List.of("alta", "media", "baixa"))),
                "required", List.of("i", "categoria", "confianca"),
                "additionalProperties", false);

        var raiz = Map.of(
                "type", "object",
                "properties", Map.of("itens", Map.of("type", "array", "items", item)),
                "required", List.of("itens"),
                "additionalProperties", false);

        try {
            return JSON.writeValueAsString(raiz);
        } catch (Exception e) {
            throw new IllegalStateException("não consegui montar o schema", e);
        }
    }

    // -------------------------------------------------------------- executar

    /**
     * Entrega uma tarefa a um dispositivo, por prazo determinado.
     *
     * A reserva é o que impede dois desktops ligados de rodarem a mesma coisa —
     * e o prazo é o que faz a tarefa voltar sozinha para a fila quando a máquina
     * que a pegou desliga no meio.
     */
    @Transactional
    public Optional<IaTarefa> reservar(Long usuarioId, Long dispositivoId) {
        var agora = Instant.now();
        var disponiveis = tarefas.disponiveis(usuarioId, agora);
        if (disponiveis.isEmpty()) return Optional.empty();

        var tarefa = disponiveis.get(0);
        tarefa.setEstado("reservada");
        tarefa.setReservadaPor(dispositivoId);
        tarefa.setReservadaAte(agora.plus(config.ia().reservaMinutos(), ChronoUnit.MINUTES));
        return Optional.of(tarefas.save(tarefa));
    }

    // -------------------------------------------------------------- concluir

    public record Item(Integer i, String categoria, String confianca) {}

    /**
     * A resposta chega, e o servidor decide o que ela vale.
     *
     * Índice fora da faixa, categoria que não existe, confiança inventada: tudo
     * é descartado aqui. O dispositivo executou uma chamada — não ganhou direito
     * de escrever no banco o que quiser.
     */
    @Transactional
    public int concluir(Long usuarioId, Long tarefaId, List<Item> itens) {
        var tarefa = tarefas.findById(tarefaId)
                .filter(t -> t.getUsuarioId().equals(usuarioId))
                .orElseThrow(() -> dev.activitymanager.comum.ErroDeUso.naoEncontrado("Tarefa não encontrada."));

        Map<String, Categoria> porChave = new LinkedHashMap<>();
        for (var c : categoriaServico.listar(usuarioId)) porChave.put(c.getChave(), c);
        var versao = categoriaServico.versao(usuarioId);
        var chaves = tarefa.getChaves();

        int aplicados = 0;
        for (var item : itens == null ? List.<Item>of() : itens) {
            if (item.i() == null || item.i() < 0 || item.i() >= chaves.length) {
                log.warn("resposta com índice fora da faixa: {}", item.i());
                continue;
            }
            // `nao_classificado` é resposta legítima: fica em cache como "já
            // perguntei e não dá", para não perguntar de novo amanhã.
            var categoria = porChave.get(item.categoria());
            if (categoria == null && !"nao_classificado".equals(item.categoria())) {
                log.warn("resposta com categoria inexistente: {}", item.categoria());
                continue;
            }

            var chave = chaves[item.i()];
            var registro = classificacoes.findByUsuarioIdAndChave(usuarioId, chave)
                    .orElseGet(Classificacao::new);
            registro.setUsuarioId(usuarioId);
            registro.setChave(chave);
            registro.setCategoriaId(categoria == null ? null : categoria.getId());
            registro.setConfianca(normalizar(item.confianca()));
            registro.setVersao(versao);
            classificacoes.save(registro);
            aplicados++;
        }

        tarefa.setEstado("concluida");
        tarefas.save(tarefa);

        // Só depois de o cache estar escrito é que os segmentos são reavaliados:
        // assim uma resposta parcial não deixa metade aplicada e metade não.
        aplicarNosSegmentos(usuarioId);
        return aplicados;
    }

    private String normalizar(String confianca) {
        if (confianca == null) return "media";
        return switch (confianca.toLowerCase()) {
            case "alta", "media", "baixa" -> confianca.toLowerCase();
            default -> "media";
        };
    }

    /**
     * Aplica o cache aos segmentos que ainda estão pendentes.
     *
     * Confiança baixa NÃO é aplicada: vai para revisão na tela. Um palpite fraco
     * escrito como fato é exatamente o dado que estraga um relatório em silêncio.
     */
    @Transactional
    public int aplicarNosSegmentos(Long usuarioId) {
        var versao = categoriaServico.versao(usuarioId);
        int tocados = 0;
        for (var s : segmentos.pendentes(usuarioId)) {
            var registro = classificacoes.findByUsuarioIdAndChave(usuarioId, ClassificadorServico.chave(s));
            if (registro.isEmpty()) continue;
            var c = registro.get();
            if (c.getVersao() != versao) continue;
            if ("baixa".equals(c.getConfianca())) continue;
            s.setCategoriaId(c.getCategoriaId());
            s.setOrigem(c.getCategoriaId() == null ? "sem_categoria" : "ia");
            segmentos.save(s);
            tocados++;
        }
        return tocados;
    }
}
