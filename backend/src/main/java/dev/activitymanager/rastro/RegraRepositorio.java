package dev.activitymanager.rastro;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RegraRepositorio extends JpaRepository<Regra, Long> {
    List<Regra> findByUsuarioIdAndApagadaEmIsNullOrderByOrdemAsc(Long usuarioId);
}
