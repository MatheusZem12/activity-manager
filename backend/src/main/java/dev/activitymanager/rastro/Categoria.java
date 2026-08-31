package dev.activitymanager.rastro;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Uma categoria do usuário.
 *
 * A `descricao` é o campo que faz o trabalho pesado: é ela que entra no prompt.
 * Sem ela, o modelo classifica pela ideia dele de "estudo"; com ela, classifica
 * pela sua. É a diferença entre a ferramenta ter uma opinião e ter a SUA.
 */
@Entity
@Table(name = "categoria")
public class Categoria {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "usuario_id", nullable = false) private Long usuarioId;
    @Column(nullable = false) private String chave;
    @Column(nullable = false) private String nome;
    @Column(nullable = false) private String descricao = "";
    @Column(nullable = false) private String cor = "#888888";
    @Column(nullable = false) private int ordem = 0;
    @Column(name = "apagada_em") private Instant apagadaEm;
    @Column(name = "atualizada_em", nullable = false) private Instant atualizadaEm = Instant.now();

    public Long getId() { return id; }
    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public String getChave() { return chave; }
    public void setChave(String v) { this.chave = v; }
    public String getNome() { return nome; }
    public void setNome(String v) { this.nome = v; }
    public String getDescricao() { return descricao; }
    public void setDescricao(String v) { this.descricao = v == null ? "" : v; }
    public String getCor() { return cor; }
    public void setCor(String v) { this.cor = v; }
    public int getOrdem() { return ordem; }
    public void setOrdem(int v) { this.ordem = v; }
    public Instant getApagadaEm() { return apagadaEm; }
    public void setApagadaEm(Instant v) { this.apagadaEm = v; }
    public Instant getAtualizadaEm() { return atualizadaEm; }
    public void setAtualizadaEm(Instant v) { this.atualizadaEm = v; }
}
