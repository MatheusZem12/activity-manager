package dev.activitymanager.rastro;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Um trecho contínuo em que nada mudou.
 *
 * Os campos vêm em dois blocos, e a separação é o coração do desenho:
 *
 *   FATOS      — `travado`, `midia`, `wmClass`, `titulo`. O dispositivo observa
 *                e reporta; não conclui nada.
 *   SIGNIFICADO — `ocioso`, `categoriaId`, `projeto`. Derivado aqui.
 *
 * Guardar os fatos é o que permite mudar a regra depois e reprocessar o
 * histórico inteiro. Se o dispositivo já mandasse "ocioso: true", a premissa
 * teria sido jogada fora e nenhuma mudança de regra alcançaria o passado.
 */
@Entity
@Table(name = "segmento")
public class Segmento {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "usuario_id", nullable = false) private Long usuarioId;
    @Column(name = "dispositivo_id") private Long dispositivoId;
    @Column(nullable = false) private Instant inicio;
    @Column(nullable = false) private Instant fim;
    @Column(nullable = false) private int segundos;

    @Column(name = "wm_class") private String wmClass;
    private String titulo;
    @Column(nullable = false) private boolean travado;
    @Column(nullable = false) private boolean midia;

    @Column(nullable = false) private boolean ocioso;
    @Column(name = "categoria_id") private Long categoriaId;
    private String projeto;
    @Column(nullable = false) private String origem = "pendente";

    @Column(name = "criado_em", nullable = false) private Instant criadoEm = Instant.now();

    public Long getId() { return id; }
    public Long getUsuarioId() { return usuarioId; }
    public void setUsuarioId(Long v) { this.usuarioId = v; }
    public Long getDispositivoId() { return dispositivoId; }
    public void setDispositivoId(Long v) { this.dispositivoId = v; }
    public Instant getInicio() { return inicio; }
    public void setInicio(Instant v) { this.inicio = v; }
    public Instant getFim() { return fim; }
    public void setFim(Instant v) { this.fim = v; }
    public int getSegundos() { return segundos; }
    public void setSegundos(int v) { this.segundos = v; }
    public String getWmClass() { return wmClass; }
    public void setWmClass(String v) { this.wmClass = v; }
    public String getTitulo() { return titulo; }
    public void setTitulo(String v) { this.titulo = v; }
    public boolean isTravado() { return travado; }
    public void setTravado(boolean v) { this.travado = v; }
    public boolean isMidia() { return midia; }
    public void setMidia(boolean v) { this.midia = v; }
    public boolean isOcioso() { return ocioso; }
    public void setOcioso(boolean v) { this.ocioso = v; }
    public Long getCategoriaId() { return categoriaId; }
    public void setCategoriaId(Long v) { this.categoriaId = v; }
    public String getProjeto() { return projeto; }
    public void setProjeto(String v) { this.projeto = v; }
    public String getOrigem() { return origem; }
    public void setOrigem(String v) { this.origem = v; }
}
