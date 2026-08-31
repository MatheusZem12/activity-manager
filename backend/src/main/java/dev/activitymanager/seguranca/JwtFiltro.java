package dev.activitymanager.seguranca;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class JwtFiltro extends OncePerRequestFilter {

    private final JwtServico jwt;

    public JwtFiltro(JwtServico jwt) {
        this.jwt = jwt;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        var cabecalho = req.getHeader("Authorization");
        if (cabecalho != null && cabecalho.startsWith("Bearer ")) {
            var usuarioId = jwt.ler(cabecalho.substring(7));
            if (usuarioId != null) {
                var auth = new UsernamePasswordAuthenticationToken(usuarioId, null, List.of());
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }
        chain.doFilter(req, res);
    }
}
