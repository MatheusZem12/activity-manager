package dev.activitymanager.ia;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface IaTarefaRepositorio extends JpaRepository<IaTarefa, Long> {

    /**
     * O que está livre para ser executado: nunca reservado, ou reservado por
     * alguém que sumiu antes do prazo vencer.
     */
    @Query("""
        select t from IaTarefa t
         where t.usuarioId = :usuarioId
           and (t.estado = 'pendente'
                or (t.estado = 'reservada' and t.reservadaAte < :agora))
         order by t.criadaEm asc""")
    List<IaTarefa> disponiveis(@Param("usuarioId") Long usuarioId, @Param("agora") Instant agora);

    /** Tudo que ainda não foi respondido — para não perguntar duas vezes a mesma coisa. */
    List<IaTarefa> findByUsuarioIdAndEstadoNot(Long usuarioId, String estado);
}
