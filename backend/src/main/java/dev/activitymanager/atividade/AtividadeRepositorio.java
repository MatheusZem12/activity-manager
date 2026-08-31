package dev.activitymanager.atividade;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AtividadeRepositorio extends JpaRepository<Atividade, Long> {
    List<Atividade> findByUsuarioIdAndApagadaEmIsNullOrderByCriadaEmDesc(Long usuarioId);
}
