package dev.activitymanager.rastro;

import java.util.List;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * A regra de negócio do rastreio, e o único lugar onde ela vive.
 *
 * O dispositivo manda fatos; aqui eles viram significado, em quatro degraus, do
 * mais barato para o mais caro:
 *
 *   1. ocioso    travado e sem mídia — a regra que o dispositivo NÃO aplica
 *   2. regra     classe e título do usuário resolvem, de graça
 *   3. cache     esse título já foi classificado nesta versão de categorias
 *   4. pendente  sobrou: vai para a fila de IA
 *
 * Estar aqui, e não no coletor, é o que permite mudar qualquer um desses
 * degraus e reprocessar o histórico inteiro — os fatos continuam guardados.
 */
@Service
public class ClassificadorServico {

    private static final Logger log = LoggerFactory.getLogger(ClassificadorServico.class);

    private final RegraRepositorio regras;
    private final ClassificacaoRepositorio classificacoes;
    private final CategoriaServico categoriaServico;

    public ClassificadorServico(RegraRepositorio regras,
                                ClassificacaoRepositorio classificacoes,
                                CategoriaServico categoriaServico) {
        this.regras = regras;
        this.classificacoes = classificacoes;
        this.categoriaServico = categoriaServico;
    }

    /** O contexto de um usuário, carregado uma vez por lote em vez de por segmento. */
    public record Contexto(List<Regra> regras, int versao) {}

    public Contexto contexto(Long usuarioId) {
        return new Contexto(
                regras.findByUsuarioIdAndApagadaEmIsNullOrderByOrdemAsc(usuarioId),
                categoriaServico.versao(usuarioId));
    }

    /** A chave do cache: mesma classe e mesmo título são a mesma pergunta. */
    public static String chave(Segmento s) {
        var classe = s.getWmClass() == null ? "" : s.getWmClass();
        var titulo = s.getTitulo() == null ? "" : s.getTitulo();
        return classe + " :: " + titulo;
    }

    public void classificar(Segmento s, Contexto ctx) {
        // 1. Ociosidade. As premissas (`travado`, `midia`) ficam guardadas, então
        //    mudar esta linha amanhã reprocessa o passado.
        s.setOcioso(s.isTravado() && !s.isMidia());
        if (s.isOcioso()) {
            s.setOrigem("ocioso");
            s.setCategoriaId(null);
            return;
        }

        s.setProjeto(Projetos.de(s.getWmClass(), s.getTitulo()));

        // 2. Regras do usuário: vence a de menor ordem que casar.
        for (var r : ctx.regras()) {
            if (!casa(r, s)) continue;
            s.setCategoriaId(r.getCategoriaId());
            if (r.getProjeto() != null && !r.getProjeto().isBlank()) {
                s.setProjeto(r.getProjeto());
            }
            s.setOrigem("regra");
            return;
        }

        // 3. Cache — mas só se foi decidido sob as categorias atuais.
        var emCache = classificacoes.findByUsuarioIdAndChave(s.getUsuarioId(), chave(s));
        if (emCache.isPresent() && emCache.get().getVersao() == ctx.versao()) {
            s.setCategoriaId(emCache.get().getCategoriaId());
            s.setOrigem("cache");
            return;
        }

        // 4. Sobrou para a IA.
        s.setOrigem("pendente");
    }

    private boolean casa(Regra r, Segmento s) {
        var temClasse = r.getWmClass() != null && !r.getWmClass().isBlank();
        var temTitulo = r.getTituloRegex() != null && !r.getTituloRegex().isBlank();

        // Regra sem critério nenhum casaria com tudo, e uma linha em branco na
        // tela viraria "todo o seu dia é lazer".
        if (!temClasse && !temTitulo) return false;

        if (temClasse) {
            if (s.getWmClass() == null || !s.getWmClass().equalsIgnoreCase(r.getWmClass())) return false;
        }
        if (temTitulo) {
            if (s.getTitulo() == null) return false;
            try {
                var achou = Pattern.compile(r.getTituloRegex(), Pattern.CASE_INSENSITIVE)
                        .matcher(s.getTitulo()).find();
                if (!achou) return false;
            } catch (PatternSyntaxException e) {
                // Regex escrita à mão numa tela é regex que quebra. Uma regra
                // inválida é ignorada e não derruba a classificação do lote.
                log.warn("regra {} tem regex inválida: {}", r.getId(), e.getMessage());
                return false;
            }
        }
        return true;
    }
}
