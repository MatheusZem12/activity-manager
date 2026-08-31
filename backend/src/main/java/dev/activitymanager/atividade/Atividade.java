package dev.activitymanager.atividade;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Uma atividade.
 *
 * `alertaMin` e `venceEm` são coisas diferentes de propósito: o primeiro é o
 * intervalo (`!30` no texto), o segundo é quando o próximo alerta toca. Adiar
 * mexe só no segundo — e é o intervalo que faz o alerta repetir até você
 * concluir, em vez de avisar uma vez e sumir.
 */
@Entity
@Table(name = "atividade")
public class Atividade {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "usuario_id", nullable = false) private Long usuarioId;
    @Column(nullable = false) private String texto;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]", nullable = false)
    private String[] tags = new String[0];

    @Column(name = "alerta_min") private Integer alertaMin;
    @Column(name = "vence_em") private Instant venceEm;
    @Column(name = "criada_em", nullable = false) private Instant criadaEm = Instant.now();
    @Column(name = "concluida_em") private Instant concluidaEm;

    /** Lápide, nunca DELETE físico: senão um dispositivo offline ressuscita o que outro apagou. */
    @Column(name = "apagada_em") private Instant apagadaEm;
    @Column(name = "atualizada_em", nullable = false) private Instant atualizadaEm = Instant.now();

    public Long getId() { return id; }
    public void setId(Long v) { this.id = v; }
    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public String getTexto() { return texto; }
    public void setTexto(String v) { this.texto = v; }
    public String[] getTags() { return tags; }
    public void setTags(String[] v) { this.tags = v == null ? new String[0] : v; }
    public Integer getAlertaMin() { return alertaMin; }
    public void setAlertaMin(Integer v) { this.alertaMin = v; }
    public Instant getVenceEm() { return venceEm; }
    public void setVenceEm(Instant v) { this.venceEm = v; }
    public Instant getCriadaEm() { return criadaEm; }
    public void setCriadaEm(Instant v) { this.criadaEm = v; }
    public Instant getConcluidaEm() { return concluidaEm; }
    public void setConcluidaEm(Instant v) { this.concluidaEm = v; }
    public Instant getApagadaEm() { return apagadaEm; }
    public void setApagadaEm(Instant v) { this.apagadaEm = v; }
    public Instant getAtualizadaEm() { return atualizadaEm; }
    public void setAtualizadaEm(Instant v) { this.atualizadaEm = v; }
}
