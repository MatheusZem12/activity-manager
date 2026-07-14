# Activity Manager

Serviço desktop local para anotar atividades, receber alertas no canto da tela e acompanhar quanto tempo você leva para resolvê-las. Tudo fica salvo na sua máquina, sem login, sem nuvem e sem banco de dados.

## Tecnologias

- Electron
- HTML/CSS/JavaScript
- Persistência local em JSON
- Notificações nativas do sistema operacional

## Funcionalidades

- **Atalho global** (`Ctrl+Alt+A` por padrão) abre uma janela rápida para anotar uma atividade. O atalho é definido dentro do app e **o próprio serviço o registra no ambiente gráfico** — você não edita arquivo de configuração nenhum.
- **Sintaxe simples**: digite o nome da atividade, use `#tag` para categorizar e `!N` para definir o alerta.
  - Exemplo: `atividade de matemática #faculdade #prova !30`
  - Tempo aceita minutos e horas: `!30`, `!45m`, `!2h`, `!1h30`.
  - Se o tempo for omitido, usa o padrão configurado.
- **Preview ao vivo**: enquanto você digita, o app mostra como o texto será interpretado (texto, tags e tempo do alerta).
- **Autocomplete de tags**: ao digitar `#`, as tags já usadas aparecem como sugestão — `Tab` aceita a primeira.
- **Busca e filtro**: campo de busca (atalho `/`) e chips de tag para filtrar a lista; clicar na tag de um card também filtra.
- **Edição inline**: o lápis no card abre o texto para editar (aceita `#tag` e `!N`); editar sem `!N` preserva o alerta atual.
- **Adiar e reabrir**: botão de adiar reagenda o alerta da atividade; atividades concluídas podem ser reabertas.
- **Limite de caracteres** configurável para manter as atividades curtas e diretas.
- **Alertas nativos** aparecem no canto da tela quando o tempo chega.
- **Bandeja do sistema** (system tray): o app continua rodando mesmo com a janela fechada.
- **Inicia junto com o sistema** (opcional).
- **Marque atividades como concluídas** e veja o tempo que levou desde a criação.
- **Relatórios**: total, pendentes, atrasadas, concluídas (inclusive hoje), tempo médio de resolução e atividades por categoria.
- **Backup local**: exporte e importe um arquivo JSON para transferir seus dados entre máquinas.

## Estrutura do projeto

```
source/
├── electron.js                        # Entry point: janelas, tray, notificações
├── preload.js                         # Ponte segura entre main e renderer
├── bin/
│   └── am-trigger.sh                  # O que o atalho executa: acorda o serviço
├── assets/                            # Ícones (icon.svg/icon.png + tray-icon.png)
├── package.json
└── src/
    ├── shared/
    │   └── activity-parser.js         # Interpreta texto, #tags e !tempo (main + renderer)
    ├── main/
    │   ├── scheduler.js               # Timer de alertas
    │   ├── shortcut-manager.js        # Registra o atalho no ambiente gráfico
    │   ├── hypr.js                    # Conversa com o Hyprland via hyprctl
    │   ├── trigger-server.js          # Porta local que o atalho aciona
    │   └── storage/
    │       ├── activity-store.js      # Persistência das atividades
    │       └── config-store.js        # Configurações do usuário
    └── renderer/
        ├── index.html
        ├── styles.css
        └── app.js                     # Interface (dashboard, relatórios, configurações)
```

## Como rodar

```bash
cd source
npm install
npm start        # ou ./start.sh (na raiz do projeto)
```

### Instalar como app do desktop (Linux)

Para criar um atalho no menu de aplicativos, com ícone, apontando direto para o código em `source/`:

```bash
./install-desktop.sh              # instala/atualiza o atalho
./install-desktop.sh --uninstall  # remove
```

## Como o atalho global funciona

Você define o atalho em **Configurações → Atalho global** e clica em salvar. Só isso. O serviço cuida do resto.

Por que isso precisa de uma explicação: no Wayland, **nenhum aplicativo consegue escutar o teclado quando não está em foco** — é uma trava do protocolo, não um defeito do Electron. Só o compositor enxerga as teclas. Então, em vez de pedir para você editar a configuração do Hyprland na mão, o serviço fala com o compositor por você:

1. Ao salvar, o app escreve `~/.config/hypr/activity-manager.conf` (arquivo gerenciado por ele) com o seu atalho, as regras de janela e o autostart, e garante um `source` dele no seu `hyprland.conf` — uma única vez.
2. Em seguida roda `hyprctl reload`. O atalho passa a valer na hora, sem reiniciar nada.
3. Ao apertar o atalho, o Hyprland executa `source/bin/am-trigger.sh`, que manda uma linha para o serviço que já está rodando por uma porta de loopback. A janela abre em ~50 ms, sem subir um Electron novo.

Se o serviço estiver fora do ar quando você usar o atalho, o script sobe o app — e ele fica na bandeja a partir daí.

A janela rápida segura o foco do teclado enquanto está aberta (regra `stay_focused`, a mesma que os lançadores usam). Sem isso o Hyprland devolveria o foco para a janela embaixo do cursor e ela se fecharia antes de você digitar. Feche com **Esc**, salve com **Enter**.

Antes de salvar, a tela de configurações avisa se a combinação escolhida **já pertence a outro atalho** (no Omarchy, por exemplo, `Super+Shift+A` é o ChatGPT). Salvar sobrescreve o atalho antigo enquanto o Activity Manager estiver instalado; `./install-desktop.sh --uninstall` desfaz tudo (e faz backup do `hyprland.conf`).

**X11 / outros ambientes:** o Electron registra o atalho sozinho, sem precisar de nada disso. Em compositores Wayland que não sejam Hyprland, o app mostra nas configurações o comando (`source/bin/am-trigger.sh`) para você vincular a uma tecla no seu ambiente.

## Dados e privacidade

Todas as informações são salvas localmente na pasta de dados do usuário do Electron (`userData`):

- `activities.json`: lista de atividades.
- `config.json`: preferências do usuário.

Nenhum dado é enviado para a internet. Se quiser fazer backup ou migrar para outro computador, use a exportação/importação de JSON nas configurações.
