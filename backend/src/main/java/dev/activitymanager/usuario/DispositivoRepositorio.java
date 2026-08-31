package dev.activitymanager.usuario;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DispositivoRepositorio extends JpaRepository<Dispositivo, Long> {
    Optional<Dispositivo> findByUsuarioIdAndNome(Long usuarioId, String nome);
}
