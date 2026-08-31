package dev.activitymanager.rastro;

import jakarta.persistence.*;

/**
 * Quantas vezes as categorias deste usuário já mudaram.
 *
 * Cada classificação em cache guarda a versão sob a qual foi feita. Mudou a
 * descrição de "estudo"? A versão sobe, e as entradas antigas deixam de valer —
 * sem apagar nada, e sem reclassificar o histórico inteiro de uma vez.
 */
@Entity
@Table(name = "versao_categorias")
public class VersaoCategorias {

    @Id
    @Column(name = "usuario_id")
    private Long usuarioId;

    @Column(nullable = false)
    private int versao = 1;

    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public int getVersao() { return versao; }
    public void setVersao(int v) { this.versao = v; }
}
