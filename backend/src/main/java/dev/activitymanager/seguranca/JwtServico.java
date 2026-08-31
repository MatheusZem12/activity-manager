package dev.activitymanager.seguranca;

import dev.activitymanager.comum.Config;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

@Service
public class JwtServico {

    private final SecretKey chave;
    private final int validadeDias;

    public JwtServico(Config config) {
        this.chave = Keys.hmacShaKeyFor(config.jwt().segredo().getBytes(StandardCharsets.UTF_8));
        this.validadeDias = config.jwt().validadeDias();
    }

    public String emitir(long usuarioId) {
        var agora = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(usuarioId))
                .issuedAt(Date.from(agora))
                // A validade é assada no token quando ele nasce: mudar a
                // configuração não encurta token já emitido, vale do próximo
                // login em diante.
                .expiration(Date.from(agora.plus(validadeDias, ChronoUnit.DAYS)))
                .signWith(chave)
                .compact();
    }

    /** @return o id do usuário, ou null se o token não presta. */
    public Long ler(String token) {
        try {
            var corpo = Jwts.parser().verifyWith(chave).build().parseSignedClaims(token).getPayload();
            return Long.valueOf(corpo.getSubject());
        } catch (Exception e) {
            return null;
        }
    }
}
