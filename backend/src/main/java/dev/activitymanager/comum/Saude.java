package dev.activitymanager.comum;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class Saude {

    /** O healthcheck do contêiner bate aqui. Sem sessão, de propósito. */
    @GetMapping("/api/saude")
    public Map<String, String> saude() {
        return Map.of("estado", "ok");
    }
}
