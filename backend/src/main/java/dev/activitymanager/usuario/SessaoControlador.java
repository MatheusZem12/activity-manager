package dev.activitymanager.usuario;

import dev.activitymanager.comum.Config;
import dev.activitymanager.comum.ErroDeUso;
import dev.activitymanager.rastro.CategoriaServico;
import dev.activitymanager.seguranca.JwtServico;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * Entrar e criar conta, na mesma rota.
 *
 * Sem tela de cadastro separada: e-mail que não existe e convite correto criam
 * a conta; e-mail que existe entra. São poucas contas — um fluxo de registro
 * completo seria cerimônia para dois usuários.
 */
@RestController
@RequestMapping("/api/sessao")
public class SessaoControlador {

    public record Pedido(@Email @NotBlank String email,
                         @NotBlank String senha,
                         String convite) {}

    private final UsuarioRepositorio usuarios;
    private final PasswordEncoder codificador;
    private final JwtServico jwt;
    private final CategoriaServico categorias;
    private final Config config;

    public SessaoControlador(UsuarioRepositorio usuarios, PasswordEncoder codificador,
                             JwtServico jwt, CategoriaServico categorias, Config config) {
        this.usuarios = usuarios;
        this.codificador = codificador;
        this.jwt = jwt;
        this.categorias = categorias;
        this.config = config;
    }

    @PostMapping
    @Transactional
    public Map<String, Object> entrar(@Valid @RequestBody Pedido pedido) {
        var existente = usuarios.findByEmail(pedido.email().trim().toLowerCase());

        if (existente.isPresent()) {
            var usuario = existente.get();
            if (!codificador.matches(pedido.senha(), usuario.getSenhaHash())) {
                throw new ErroDeUso(HttpStatus.UNAUTHORIZED, "E-mail ou senha incorretos.");
            }
            return Map.of("token", jwt.emitir(usuario.getId()), "email", usuario.getEmail());
        }

        // Conta nova: convite obrigatório. Sem isso um servidor exposto na
        // internet vira cadastro aberto.
        var convite = config.registro().convite();
        if (convite == null || convite.isBlank() || !convite.equals(pedido.convite())) {
            throw new ErroDeUso(HttpStatus.FORBIDDEN, "Convite ausente ou inválido.");
        }
        if (usuarios.count() >= config.registro().maximoContas()) {
            throw new ErroDeUso(HttpStatus.FORBIDDEN, "Limite de contas atingido neste servidor.");
        }

        var usuario = new Usuario();
        usuario.setEmail(pedido.email().trim().toLowerCase());
        usuario.setSenhaHash(codificador.encode(pedido.senha()));
        usuarios.save(usuario);

        // Conta sem categoria nenhuma não classifica nada. O padrão é editável
        // — nomes, descrições e cores são do usuário desde o primeiro dia.
        categorias.semearPadrao(usuario.getId());

        return Map.of("token", jwt.emitir(usuario.getId()), "email", usuario.getEmail());
    }
}
