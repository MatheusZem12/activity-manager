package dev.activitymanager.usuario;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Uma máquina do usuário.
 *
 * `executores` é o que ESTA máquina consegue rodar de IA — "ollama",
 * "claudecode". Não é segredo, é capacidade: o servidor consulta isso para
 * saber a quem pode entregar uma tarefa de classificação local.
 */
@Entity
@Table(name = "dispositivo")
public class Dispositivo {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "usuario_id", nullable = false)
    private Long usuarioId;

    @Column(nullable = false)
    private String nome;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]", nullable = false)
    private String[] executores = new String[0];

    @Column(name = "visto_em", nullable = false)
    private Instant vistoEm = Instant.now();

    @Column(name = "criado_em", nullable = false)
    private Instant criadoEm = Instant.now();

    public Long getId() { return id; }
    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public String getNome() { return nome; }
    public void setNome(String v) { this.nome = v; }
    public String[] getExecutores() { return executores; }
    public void setExecutores(String[] v) { this.executores = v == null ? new String[0] : v; }
    public Instant getVistoEm() { return vistoEm; }
    public void setVistoEm(Instant v) { this.vistoEm = v; }
    public Instant getCriadoEm() { return criadoEm; }
}
