package dev.activitymanager.seguranca;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SegurancaConfig {

    @Bean
    public PasswordEncoder codificador() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain cadeia(HttpSecurity http, JwtFiltro filtro) throws Exception {
        http
            // Sem cookie e sem sessão de servidor: o token vai no cabeçalho, e
            // sem cookie não há o que um site de terceiro forjar.
            .csrf(c -> c.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers("/api/saude", "/api/sessao").permitAll()
                .anyRequest().authenticated())
            .addFilterBefore(filtro, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
