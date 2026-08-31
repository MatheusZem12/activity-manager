package dev.activitymanager.texto;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TextoRepositorio extends JpaRepository<Texto, Long> {
    List<Texto> findByUsuarioIdAndApagadoEmIsNullOrderByCriadoEmDesc(Long usuarioId);
}
