package dev.activitymanager.rastro;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SegmentoRepositorio extends JpaRepository<Segmento, Long> {

    boolean existsByUsuarioIdAndDispositivoIdAndInicio(Long usuarioId, Long dispositivoId, Instant inicio);

    List<Segmento> findByUsuarioIdAndInicioBetweenOrderByInicioAsc(Long usuarioId, Instant de, Instant ate);

    List<Segmento> findByUsuarioIdOrderByInicioAsc(Long usuarioId);

    /** Os que nem regra nem cache resolveram — a matéria-prima da fila de IA. */
    @Query("""
        select s from Segmento s
         where s.usuarioId = :usuarioId and s.origem = 'pendente' and s.ocioso = false
           and s.titulo is not null
         order by s.inicio desc""")
    List<Segmento> pendentes(@Param("usuarioId") Long usuarioId);
}
