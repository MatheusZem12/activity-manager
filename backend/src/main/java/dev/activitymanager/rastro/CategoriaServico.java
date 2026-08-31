package dev.activitymanager.rastro;

import dev.activitymanager.comum.ErroDeUso;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoriaServico {

    /**
     * O padrão de uma conta nova. É ponto de partida, não camisa de força: nome,
     * descrição, cor e ordem são editáveis, e categoria nova é criada na tela.
     *
     * As descrições estão escritas para o modelo ler, não para enfeitar a UI —
     * são elas que vão para o prompt.
     */
    private static final String[][] PADRAO = {
        {"trabalho", "Trabalho", "#4C8DFF",
         "Código, reuniões e ferramentas do serviço."},
        {"faculdade", "Faculdade", "#B37CFF",
         "Aula, material de disciplina, entrega e prova da graduação."},
        {"estudo", "Estudo", "#3DDC84",
         "Aula, tutorial ou documentação lida com intenção de aprender. Inclui vídeo de aula, "
         + "mas não vídeo de tecnologia visto por lazer."},
        {"comunicacao", "Comunicação", "#F2B33D",
         "E-mail, mensagem e chamada, sem relação com uma tarefa específica."},
        {"lazer", "Lazer", "#FF7A7A",
         "Entretenimento: vídeo, música, jogo, rede social, leitura por prazer."}
    };

    private final CategoriaRepositorio categorias;
    private final VersaoRepositorio versoes;

    public CategoriaServico(CategoriaRepositorio categorias, VersaoRepositorio versoes) {
        this.categorias = categorias;
        this.versoes = versoes;
    }

    @Transactional
    public void semearPadrao(Long usuarioId) {
        int ordem = 0;
        for (var linha : PADRAO) {
            var c = new Categoria();
            c.setUsuarioId(usuarioId);
            c.setChave(linha[0]);
            c.setNome(linha[1]);
            c.setCor(linha[2]);
            c.setDescricao(linha[3]);
            c.setOrdem(ordem++);
            categorias.save(c);
        }
        var v = new VersaoCategorias();
        v.setUsuarioId(usuarioId);
        versoes.save(v);
    }

    public List<Categoria> listar(Long usuarioId) {
        return categorias.findByUsuarioIdAndApagadaEmIsNullOrderByOrdemAsc(usuarioId);
    }

    public int versao(Long usuarioId) {
        return versoes.findById(usuarioId).map(VersaoCategorias::getVersao).orElse(1);
    }

    /**
     * Sobe a versão. Chamado quando qualquer categoria muda, inclusive só a
     * descrição — porque é exatamente ela que muda o que o modelo decide. As
     * classificações antigas continuam no banco; só deixam de casar.
     */
    @Transactional
    public void invalidarCache(Long usuarioId) {
        var v = versoes.findById(usuarioId).orElseGet(() -> {
            var novo = new VersaoCategorias();
            novo.setUsuarioId(usuarioId);
            return novo;
        });
        v.setVersao(v.getVersao() + 1);
        versoes.save(v);
    }

    /**
     * Cria ou altera. O `id` vem separado do corpo de propósito: é o que impede
     * alguém de editar a categoria de outra conta mandando um id qualquer.
     *
     * Qualquer alteração sobe a versão — inclusive mexer só na descrição, que é
     * justamente o campo que muda o que o modelo decide.
     */
    @Transactional
    public Categoria salvar(Long usuarioId, Long id, CategoriaControlador.Entrada entrada) {
        Categoria alvo;
        if (id != null) {
            alvo = categorias.findById(id)
                    .filter(c -> c.getUsuarioId().equals(usuarioId))
                    .orElseThrow(() -> ErroDeUso.naoEncontrado("Categoria não encontrada."));
        } else {
            if (entrada.chave() == null || entrada.chave().isBlank()) {
                throw ErroDeUso.pedidoInvalido("Categoria nova precisa de uma chave.");
            }
            alvo = new Categoria();
            alvo.setUsuarioId(usuarioId);
            alvo.setChave(entrada.chave().trim().toLowerCase());
        }
        if (entrada.nome() != null) alvo.setNome(entrada.nome());
        if (entrada.descricao() != null) alvo.setDescricao(entrada.descricao());
        if (entrada.cor() != null) alvo.setCor(entrada.cor());
        if (entrada.ordem() != null) alvo.setOrdem(entrada.ordem());
        alvo.setAtualizadaEm(Instant.now());
        var salva = categorias.save(alvo);
        invalidarCache(usuarioId);
        return salva;
    }

    @Transactional
    public void apagar(Long usuarioId, Long id) {
        categorias.findById(id).filter(c -> c.getUsuarioId().equals(usuarioId)).ifPresent(c -> {
            c.setApagadaEm(Instant.now());
            categorias.save(c);
            invalidarCache(usuarioId);
        });
    }
}
