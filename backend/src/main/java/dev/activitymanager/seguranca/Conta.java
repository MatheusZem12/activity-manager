package dev.activitymanager.seguranca;

import dev.activitymanager.comum.ErroDeUso;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;

/** Quem está pedindo. O id sai do token, nunca do corpo da requisição. */
public final class Conta {

    private Conta() {}

    public static long id() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Long id)) {
            throw new ErroDeUso(HttpStatus.UNAUTHORIZED, "Sessão ausente ou expirada.");
        }
        return id;
    }
}
