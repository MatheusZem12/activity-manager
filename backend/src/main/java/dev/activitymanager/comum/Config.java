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
     * @param provedor      `anthropic`, `openai`, `gemini` — o servidor chama.
     *                      `local` — o servidor enfileira e um dispositivo do
     *                      usuário executa no ollama ou no claude da máquina.
     * @param reservaMinutos prazo da reserva de uma tarefa por um dispositivo;
     *                      vencido, a tarefa volta para a fila sozinha
     */
    public record Ia(String provedor, String chave, String modelo,
                     int tempoLimiteSegundos, int reservaMinutos) {}
}
