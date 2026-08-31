package dev.activitymanager.rastro;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ClassificacaoRepositorio extends JpaRepository<Classificacao, Long> {
    Optional<Classificacao> findByUsuarioIdAndChave(Long usuarioId, String chave);
}
