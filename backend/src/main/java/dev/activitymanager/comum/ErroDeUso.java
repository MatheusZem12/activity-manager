package dev.activitymanager.comum;

import org.springframework.http.HttpStatus;

/** Erro que o cliente causou e pode corrigir — vira resposta, não stack trace. */
public class ErroDeUso extends RuntimeException {

    private final HttpStatus status;

    public ErroDeUso(HttpStatus status, String mensagem) {
        super(mensagem);
        this.status = status;
    }

    public static ErroDeUso pedidoInvalido(String mensagem) {
        return new ErroDeUso(HttpStatus.BAD_REQUEST, mensagem);
    }

    public static ErroDeUso naoEncontrado(String mensagem) {
        return new ErroDeUso(HttpStatus.NOT_FOUND, mensagem);
    }

    public HttpStatus status() {
        return status;
    }
}
