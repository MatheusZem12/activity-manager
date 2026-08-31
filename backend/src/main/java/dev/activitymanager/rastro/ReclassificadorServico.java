package dev.activitymanager.rastro;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Roda as regras de novo sobre o que já está guardado.
 *
 * Este arquivo é a razão de existir de todo o desenho. O dispositivo guardou
 * fatos — `travado`, `midia`, classe, título — e não conclusões. Então mudar uma
 * regra, uma descrição de categoria ou a definição de ocioso não invalida o
 * passado: é só passar por cima dele de novo.
 *
 * Se o coletor tivesse mandado "ocioso: true", a premissa teria sido jogada fora
 * e nada disso seria possível.
 */
@Service
public class ReclassificadorServico {

    private static final Logger log = LoggerFactory.getLogger(ReclassificadorServico.class);

    private final SegmentoRepositorio segmentos;
    private final ClassificadorServico classificador;

    public ReclassificadorServico(SegmentoRepositorio segmentos, ClassificadorServico classificador) {
        this.segmentos = segmentos;
        this.classificador = classificador;
    }

    /**
     * Reavalia tudo que não foi decidido por uma pessoa.
     *
     * `manual` é preservado de propósito: se você corrigiu um segmento na tela,
     * uma regra nova não tem o direito de desfazer isso.
     */
    @Transactional
    public int reprocessar(Long usuarioId) {
        var ctx = classificador.contexto(usuarioId);
        var todos = segmentos.findByUsuarioIdOrderByInicioAsc(usuarioId);
        int tocados = 0;
        for (var s : todos) {
            if ("manual".equals(s.getOrigem())) continue;
            classificador.classificar(s, ctx);
            segmentos.save(s);
            tocados++;
        }
        log.info("reprocessados {} segmentos do usuário {}", tocados, usuarioId);
        return tocados;
    }
}
