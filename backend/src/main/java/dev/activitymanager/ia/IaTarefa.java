package dev.activitymanager.ia;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Uma pergunta pronta, esperando quem a execute.
 *
 * Existe só para o provedor `local`: o servidor monta o prompt e o schema — que
 * é a parte que é regra de negócio — mas não alcança o ollama nem o `claude` da
 * sua máquina. Então guarda o pedido aqui, e o dispositivo pergunta o que há
 * para rodar.
 *
 * O dispositivo recebe texto e schema, e devolve JSON. Ele não sabe o que está
 * classificando nem por quê: é executor, não decisor.
 */
@Entity
@Table(name = "ia_tarefa")
public class IaTarefa {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "usuario_id", nullable = false) private Long usuarioId;
    @Column(nullable = false) private String prompt;
    @Column(nullable = false) private String esquema;

    /** As chaves de cache, na mesma ordem em que aparecem no prompt. */
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]", nullable = false)
    private String[] chaves = new String[0];

    @Column(nullable = false) private String estado = "pendente";
    @Column(name = "reservada_por") private Long reservadaPor;
    @Column(name = "reservada_ate") private Instant reservadaAte;
    @Column(name = "criada_em", nullable = false) private Instant criadaEm = Instant.now();

    public Long getId() { return id; }
    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public String getPrompt() { return prompt; }
    public void setPrompt(String v) { this.prompt = v; }
    public String getEsquema() { return esquema; }
    public void setEsquema(String v) { this.esquema = v; }
    public String[] getChaves() { return chaves; }
    public void setChaves(String[] v) { this.chaves = v == null ? new String[0] : v; }
    public String getEstado() { return estado; }
    public void setEstado(String v) { this.estado = v; }
    public Long getReservadaPor() { return reservadaPor; }
    public void setReservadaPor(Long v) { this.reservadaPor = v; }
    public Instant getReservadaAte() { return reservadaAte; }
    public void setReservadaAte(Instant v) { this.reservadaAte = v; }
    public Instant getCriadaEm() { return criadaEm; }
}
