package dev.activitymanager.rastro;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Classe de janela e/ou trecho do título → categoria e projeto.
 *
 * Resolve a maior parte dos segmentos sem IA nenhuma, e de graça. Vence a de
 * menor `ordem` que casar.
 */
@Entity
@Table(name = "regra")
public class Regra {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "usuario_id", nullable = false) private Long usuarioId;
    @Column(nullable = false) private int ordem = 0;
    @Column(name = "wm_class") private String wmClass;
    @Column(name = "titulo_regex") private String tituloRegex;
    @Column(name = "categoria_id") private Long categoriaId;
    private String projeto;
    @Column(name = "apagada_em") private Instant apagadaEm;
    @Column(name = "atualizada_em", nullable = false) private Instant atualizadaEm = Instant.now();

    public Long getId() { return id; }
    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public int getOrdem() { return ordem; }
    public void setOrdem(int v) { this.ordem = v; }
    public String getWmClass() { return wmClass; }
    public void setWmClass(String v) { this.wmClass = v; }
    public String getTituloRegex() { return tituloRegex; }
    public void setTituloRegex(String v) { this.tituloRegex = v; }
    public Long getCategoriaId() { return categoriaId; }
    public void setCategoriaId(Long v) { this.categoriaId = v; }
    public String getProjeto() { return projeto; }
    public void setProjeto(String v) { this.projeto = v; }
    public Instant getApagadaEm() { return apagadaEm; }
    public void setApagadaEm(Instant v) { this.apagadaEm = v; }
    public Instant getAtualizadaEm() { return atualizadaEm; }
    public void setAtualizadaEm(Instant v) { this.atualizadaEm = v; }
}
