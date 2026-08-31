package dev.activitymanager.rastro;

import dev.activitymanager.seguranca.Conta;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/categorias")
public class CategoriaControlador {

    /** O que o cliente manda. Sem `id` e sem `usuarioId`: os dois vêm de fora do corpo. */
    public record Entrada(String chave, String nome, String descricao, String cor, Integer ordem) {}

    public record Saida(Long id, String chave, String nome, String descricao, String cor, int ordem) {
        static Saida de(Categoria c) {
            return new Saida(c.getId(), c.getChave(), c.getNome(), c.getDescricao(), c.getCor(), c.getOrdem());
        }
    }

    private final CategoriaServico servico;

    public CategoriaControlador(CategoriaServico servico) {
        this.servico = servico;
    }

    @GetMapping
    public Map<String, Object> listar() {
        var usuarioId = Conta.id();
        return Map.of(
                "categorias", servico.listar(usuarioId).stream().map(Saida::de).toList(),
                // A versão viaja junto: é ela que diz ao cliente se o que ele
                // guardou em cache ainda vale.
                "versao", servico.versao(usuarioId));
    }

    @PostMapping
    public Saida criar(@RequestBody Entrada entrada) {
        return Saida.de(servico.salvar(Conta.id(), null, entrada));
    }

    /**
     * O id vem do caminho, nunca do corpo — senão bastaria mandar um id qualquer
     * para editar a categoria de outra conta.
     */
    @PatchMapping("/{id}")
    public Saida alterar(@PathVariable Long id, @RequestBody Entrada entrada) {
        return Saida.de(servico.salvar(Conta.id(), id, entrada));
    }

    @DeleteMapping("/{id}")
    public Map<String, String> apagar(@PathVariable Long id) {
        servico.apagar(Conta.id(), id);
        return Map.of("estado", "ok");
    }
}
