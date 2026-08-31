package dev.activitymanager.comum;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Tudo que muda entre a sua máquina e a VPS, num lugar só e tipado. Nada aqui
 * tem padrão perigoso: segredo sem valor faz a aplicação recusar subir, o que é
 * melhor do que subir insegura.
 */
@ConfigurationProperties(prefix = "am")
public record Config(Jwt jwt, Registro registro, Ia ia) {

    public record Jwt(String segredo, int validadeDias) {}

    public record Registro(String convite, int maximoContas) {}

    /**
     * O servidor não fala com modelo nenhum, e por isso não há aqui provedor,
     * chave nem nome de modelo.
     *
     * Ele monta a pergunta e o schema — que é regra de negócio — e enfileira. A
     * chamada acontece no dispositivo, com o que aquela máquina tiver: o
     * `claude` logado, um modelo no ollama, ou a chave de API que o dono
     * guardou ali. Chave de IA num servidor compartilhado seria uma credencial
     * a mais para vazar, para rotacionar e para pagar sem saber por quem.
     *
     * @param reservaMinutos prazo da reserva de uma tarefa por um dispositivo;
     *                       vencido, a tarefa volta para a fila sozinha
     */
    public record Ia(int reservaMinutos) {}
}
