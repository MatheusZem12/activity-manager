package dev.activitymanager.comum;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class TratadorDeErros {

    private static final Logger log = LoggerFactory.getLogger(TratadorDeErros.class);

    @ExceptionHandler(ErroDeUso.class)
    public ResponseEntity<Map<String, String>> erroDeUso(ErroDeUso e) {
        return ResponseEntity.status(e.status()).body(Map.of("erro", e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> inesperado(Exception e) {
        // O cliente recebe uma frase; o detalhe fica no log do servidor, que é
        // onde ele serve para alguma coisa.
        log.error("erro inesperado", e);
        return ResponseEntity.status(500).body(Map.of("erro", "Erro interno no servidor."));
    }
}
