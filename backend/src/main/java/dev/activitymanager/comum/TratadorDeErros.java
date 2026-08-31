package dev.activitymanager.comum;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class TratadorDeErros {

    private static final Logger log = LoggerFactory.getLogger(TratadorDeErros.class);

    @ExceptionHandler(ErroDeUso.class)
    public ResponseEntity<Map<String, String>> erroDeUso(ErroDeUso e) {
        return ResponseEntity.status(e.status()).body(Map.of("erro", e.getMessage()));
    }

    /**
     * Deixa passar o que o próprio Spring já classificou.
     *
     * Sem isto, o `@ExceptionHandler(Exception.class)` abaixo engolia os 404 e
     * 405 do roteamento e devolvia 500 — e aí uma rota que não existe fica
     * indistinguível de um bug no servidor. Custou uma investigação: o app
     * chamava um endpoint que ainda não tinha subido, e a resposta dizia "Erro
     * interno no servidor" em vez de "não achei".
     */
    @ExceptionHandler(ErrorResponseException.class)
    public ResponseEntity<Map<String, String>> jaClassificado(ErrorResponseException e) {
        var status = e.getStatusCode();
        var mensagem = status.value() == 404
                ? "Rota não encontrada — o servidor pode estar numa versão anterior à do app."
                : e.getBody().getTitle();
        return ResponseEntity.status(status).body(Map.of("erro", mensagem));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> inesperado(Exception e) {
        // O cliente recebe uma frase; o detalhe fica no log do servidor, que é
        // onde ele serve para alguma coisa.
        log.error("erro inesperado", e);
        return ResponseEntity.status(500).body(Map.of("erro", "Erro interno no servidor."));
    }
}
