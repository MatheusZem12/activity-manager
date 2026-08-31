package dev.activitymanager.rastro;

import jakarta.persistence.*;
import java.time.Instant;

/** O cache: um título só é classificado uma vez, sob uma versão de categorias. */
@Entity
@Table(name = "classificacao")
public class Classificacao {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "usuario_id", nullable = false) private Long usuarioId;
    @Column(nullable = false) private String chave;
    @Column(name = "categoria_id") private Long categoriaId;
    @Column(nullable = false) private String confianca = "alta";
    @Column(nullable = false) private int versao = 1;
    @Column(name = "criada_em", nullable = false) private Instant criadaEm = Instant.now();

    public Long getId() { return id; }
    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public String getChave() { return chave; }
    public void setChave(String v) { this.chave = v; }
    public Long getCategoriaId() { return categoriaId; }
    public void setCategoriaId(Long v) { this.categoriaId = v; }
    public String getConfianca() { return confianca; }
    public void setConfianca(String v) { this.confianca = v; }
    public int getVersao() { return versao; }
    public void setVersao(int v) { this.versao = v; }
}
