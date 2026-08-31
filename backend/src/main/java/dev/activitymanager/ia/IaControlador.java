package dev.activitymanager.ia;

import dev.activitymanager.comum.Config;
import dev.activitymanager.seguranca.Conta;
import dev.activitymanager.usuario.DispositivoRepositorio;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/**
 * A ponte com o executor.
 *
 * O dispositivo pergunta se há algo para rodar, executa com o que aquela máquina
 * tiver — o `claude` logado, um modelo no ollama, uma chave de API guardada ali
 * — e devolve.
 *
 * Sondagem de saída e não notificação de entrada, porque a máquina do usuário
 * está atrás de NAT residencial: o servidor não consegue ligar para ela. E
 * classificação é lote diário, não tem pressa.
 */
@RestController
@RequestMapping("/api/ia")
public class IaControlador {

    public record Tarefa(Long id, String prompt, String esquema, int itens) {}

    public record Resultado(Long tarefa, List<IaServico.Item> itens) {}

    private final IaServico servico;
    private final DispositivoRepositorio dispositivos;
    private final Config config;

    public IaControlador(IaServico servico, DispositivoRepositorio dispositivos, Config config) {
        this.servico = servico;
        this.dispositivos = dispositivos;
        this.config = config;
    }

    /**
     * Fecha o lote do que está pendente e cria as perguntas. Chamado pelo
     * dispositivo antes de pedir trabalho, ou por um agendador mais tarde.
     */
    @PostMapping("/enfileirar")
    public Map<String, Object> enfileirar() {
        return Map.of("tarefas", servico.enfileirar(Conta.id()));
    }

    /**
     * Pega uma tarefa para executar. Devolve 200 com corpo vazio quando não há
     * nada — fila vazia é o estado normal, não é erro.
     */
    @GetMapping("/pendentes")
    public Map<String, Object> pendentes(@RequestParam String dispositivo) {
        var usuarioId = Conta.id();
        var registro = dispositivos.findByUsuarioIdAndNome(usuarioId, dispositivo);
        if (registro.isEmpty()) {
            return Map.of("tarefa", Map.of());
        }

        var reservada = servico.reservar(usuarioId, registro.get().getId());
        var resposta = new HashMap<String, Object>();
        resposta.put("reservaMinutos", config.ia().reservaMinutos());
        resposta.put("tarefa", reservada
                .map(t -> (Object) new Tarefa(t.getId(), t.getPrompt(), t.getEsquema(), t.getChaves().length))
                .orElse(Map.of()));
        return resposta;
    }

    /** A resposta do modelo. O servidor valida tudo antes de acreditar. */
    @PostMapping("/resultado")
    public Map<String, Object> resultado(@RequestBody Resultado corpo) {
        return Map.of("aplicados", servico.concluir(Conta.id(), corpo.tarefa(), corpo.itens()));
    }
}
