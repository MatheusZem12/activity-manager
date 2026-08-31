package dev.activitymanager.rastro;

import java.util.regex.Pattern;

/**
 * O nome do projeto, extraído do título da janela.
 *
 * Editor e terminal já carregam essa informação de graça — o título do VS Code
 * é `arquivo - projeto - Visual Studio Code`, e o do terminal costuma ser o
 * diretório. É o que transforma "2h no Code" em "2h no lingua".
 */
public final class Projetos {

    private Projetos() {}

    private static final Pattern VSCODE =
            Pattern.compile("^(?:.* - )?([^-]+) - Visual Studio Code$");

    private static final Pattern ULTIMO_TRECHO =
            Pattern.compile("([\\w.@+-]+)/?\\s*$");

    private static final Pattern TERMINAL =
            Pattern.compile(".*(alacritty|kitty|foot|ghostty|wezterm|term).*", Pattern.CASE_INSENSITIVE);

    public static String de(String wmClass, String titulo) {
        if (titulo == null || titulo.isBlank()) return null;

        var vscode = VSCODE.matcher(titulo);
        if (vscode.matches()) return limpar(vscode.group(1));

        // Terminal: o último trecho do caminho é o projeto. Só vale para classes
        // de terminal — em outro app um caminho no título costuma ser um arquivo
        // qualquer, não onde você está trabalhando.
        if (wmClass != null && TERMINAL.matcher(wmClass).matches() && titulo.contains("/")) {
            var trecho = ULTIMO_TRECHO.matcher(titulo);
            if (trecho.find()) return limpar(trecho.group(1));
        }
        return null;
    }

    private static String limpar(String bruto) {
        var nome = bruto == null ? "" : bruto.trim();
        return nome.isEmpty() || nome.equals("~") ? null : nome;
    }
}
