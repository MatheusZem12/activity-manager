package dev.activitymanager.rastro;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoriaRepositorio extends JpaRepository<Categoria, Long> {
    List<Categoria> findByUsuarioIdAndApagadaEmIsNullOrderByOrdemAsc(Long usuarioId);
    Optional<Categoria> findByUsuarioIdAndChave(Long usuarioId, String chave);
}
