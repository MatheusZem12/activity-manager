package dev.activitymanager.texto;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Um texto do clipboard.
 *
 * O `conteudo` é guardado **literalmente**, byte a byte: nunca trim, nunca
 * normalização de quebra de linha. É exatamente o que vai para o clipboard, e
 * qualquer "limpeza" aqui muda o que a pessoa cola.
 */
@Entity
@Table(name = "texto")
public class Texto {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "usuario_id", nullable = false) private Long usuarioId;
    @Column(nullable = false) private String titulo = "";
    @Column(nullable = false) private String conteudo;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]", nullable = false)
    private String[] tags = new String[0];

    @Column(nullable = false) private int copias = 0;
    @Column(name = "copiado_em") private Instant copiadoEm;
    @Column(name = "criado_em", nullable = false) private Instant criadoEm = Instant.now();
    @Column(name = "apagado_em") private Instant apagadoEm;
    @Column(name = "atualizado_em", nullable = false) private Instant atualizadoEm = Instant.now();

    public Long getId() { return id; }
    public void setId(Long v) { this.id = v; }
    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public String getTitulo() { return titulo; }
    public void setTitulo(String v) { this.titulo = v == null ? "" : v; }
    public String getConteudo() { return conteudo; }
    public void setConteudo(String v) { this.conteudo = v; }
    public String[] getTags() { return tags; }
    public void setTags(String[] v) { this.tags = v == null ? new String[0] : v; }
    public int getCopias() { return copias; }
    public void setCopias(int v) { this.copias = v; }
    public Instant getCopiadoEm() { return copiadoEm; }
    public void setCopiadoEm(Instant v) { this.copiadoEm = v; }
    public Instant getCriadoEm() { return criadoEm; }
    public void setCriadoEm(Instant v) { this.criadoEm = v; }
    public Instant getApagadoEm() { return apagadoEm; }
    public void setApagadoEm(Instant v) { this.apagadoEm = v; }
    public Instant getAtualizadoEm() { return atualizadoEm; }
    public void setAtualizadoEm(Instant v) { this.atualizadoEm = v; }
}
