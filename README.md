# Activity Manager

Serviço desktop local com **dois recursos numa interface só**:

- **Atividades** — anote o que precisa fazer, receba alertas no canto da tela e acompanhe quanto tempo levou para resolver.
- **Clipboard** — salve textos curtos que você reusa (comandos, mensagens repetidas, rascunhos) e recoloque-os no clipboard com um clique.

Tudo fica salvo na sua máquina, sem login, sem nuvem e sem banco de dados.

O app não tem uma janela "normal": ele vive na bandeja e some/aparece como um painel encostado na borda da tela (igual a um lançador), em vez de abrir uma janela centralizada de tamanho fixo. Dentro do painel, os dois recursos são abas.

> **Não monitora o clipboard do sistema.** Só existem textos criados manualmente por você.

> Este app absorveu o antigo projeto `clipboard-manager`, que era um serviço separado. Um serviço só, uma bandeja só, um arquivo de config do Hyprland só.

## Tecnologias

- Electron
- HTML/CSS/JavaScript
- Persistência local em JSON
- Notificações nativas do sistema operacional

## Funcionalidades

### Comuns

- **Painel único**: em vez de uma janela "normal", o app aparece como um painel sem moldura, sempre por cima, encostado na borda da tela (direita por padrão — configurável em **Configurações → Lado do painel**), com as abas **Atividades**, **Clipboard** e **Configurações**. Fecha no **×** do cabeçalho ou pelo tray; nunca é destruído, só some — reabre na hora.
- **Três atalhos globais**, definidos dentro do app — **o próprio serviço os registra no ambiente gráfico**, você não edita arquivo de configuração nenhum:
  - `Ctrl+Alt+A` — janela rápida para anotar uma **atividade**;
  - `Ctrl+Alt+C` — janela rápida para salvar um **texto**;
  - `Ctrl+Alt+P` — abre/foca o **painel lateral**.
- **Autocomplete de tags**: ao digitar `#`, as tags já usadas aparecem como sugestão — `Tab` aceita a primeira. Atividades e textos têm conjuntos de tags independentes.
- **Busca e filtro** em cada aba: campo de busca (atalho `/`) e chips de tag; clicar na tag de um card também filtra.
- **Bandeja do sistema** (system tray): o app continua rodando mesmo com o painel fechado.
- **Inicia junto com o sistema** (opcional).
- **Backup local**: um único JSON com atividades **e** textos. Backups antigos (só atividades) continuam sendo aceitos na importação — nesse caso os textos salvos ficam intactos.

### Atividades

- **Sintaxe simples**: digite o nome da atividade, use `#tag` para categorizar e `!N` para definir o alerta.
  - Exemplo: `atividade de matemática #faculdade #prova !30`
  - Tempo aceita minutos e horas: `!30`, `!45m`, `!2h`, `!1h30`.
  - Se o tempo for omitido, usa o padrão configurado.
- **Preview ao vivo**: enquanto você digita, o app mostra como o texto será interpretado (texto, tags e tempo do alerta).
- **Edição inline**: o lápis no card abre o texto para editar (aceita `#tag` e `!N`); editar sem `!N` preserva o alerta atual.
- **Adiar e reabrir**: botão de adiar reagenda o alerta; atividades concluídas podem ser reabertas.
- **Alertas nativos** aparecem no canto da tela quando o tempo chega (com um chime opcional) — e **repetem no mesmo intervalo** (`!N`) até você concluir a atividade, em vez de avisar uma vez só.
- **Marque como concluída** e veja o tempo que levou desde a criação.
- **Limite de caracteres** configurável para manter as atividades curtas e diretas.

### Clipboard

- **Captura rápida**: título (opcional) + conteúdo. Use `#tag` no título para categorizar.
  - `Enter` no título foca o conteúdo; `Enter` no conteúdo salva; `Shift+Enter` quebra linha; `Ctrl+Enter` salva de qualquer campo; `Esc` fecha.
  - O conteúdo é armazenado **exatamente como digitado** (byte a byte) — é o que será colado.
- **Copiar** coloca o conteúdo no clipboard do sistema e conta quantas vezes cada texto já foi usado.
- **Ordenação** por **Recentes** ou **Copiados**.
- **Edição e exclusão inline**, com o mesmo autocomplete de `#tag` do título.
- Se o título ficar vazio, o card mostra a 1ª linha do conteúdo no lugar.

## Estrutura do projeto

```
source/
├── electron.js                        # Entry point: janelas, tray, IPC, notificações
├── preload.js                         # Ponte segura entre main e renderer
├── bin/
│   └── am-trigger.sh                  # O que os atalhos executam: acordam o serviço
├── assets/                            # Ícones (icon.svg/icon.png + tray-icon.png)
├── package.json
└── src/
    ├── shared/
    │   ├── activity-parser.js         # Interpreta texto, #tags e !tempo (main + renderer)
    │   └── entry-parser.js            # Extrai #tags do título de um texto (main + renderer)
    ├── main/
    │   ├── window-identity.js         # Classe + títulos das janelas (fonte única)
    │   ├── scheduler.js               # Timer de alertas
    │   ├── shortcut-manager.js        # Registra os atalhos e as window rules no ambiente gráfico
    │   ├── hypr.js                    # Conversa com o Hyprland via hyprctl
    │   ├── trigger-server.js          # Porta local que os atalhos acionam
    │   └── storage/
    │       ├── activity-store.js      # Persistência das atividades
    │       ├── entry-store.js         # Persistência dos textos do clipboard
    │       └── config-store.js        # Configurações do usuário
    └── renderer/
        ├── index.html
        ├── styles.css
        └── app.js                     # Interface (painel, abas, janelas de captura)
```

## Como rodar

```bash
cd source
npm install
npm start        # ou ./start.sh (na raiz do projeto)
```

Gatilhos manuais (normalmente acionados pelos atalhos globais ou pelo tray):

```bash
source/bin/am-trigger.sh quick   # abre a janela rápida de atividade
source/bin/am-trigger.sh clip    # abre a janela rápida de texto (clipboard)
source/bin/am-trigger.sh panel   # abre o painel
```

### Instalar como app do desktop (Linux)

Para criar um atalho no menu de aplicativos, com ícone, apontando direto para o código em `source/`:

```bash
./install-desktop.sh              # instala/atualiza o atalho
./install-desktop.sh --uninstall  # remove
```

## Como os atalhos globais funcionam

Você define os três atalhos em **Configurações → Atalhos** e clica em salvar. Só isso. O serviço cuida do resto.

Por que isso precisa de uma explicação: no Wayland, **nenhum aplicativo consegue escutar o teclado quando não está em foco** — é uma trava do protocolo, não um defeito do Electron. Só o compositor enxerga as teclas. Então, em vez de pedir para você editar a configuração do Hyprland na mão, o serviço fala com o compositor por você:

1. Ao salvar, o app escreve `~/.config/hypr/activity-manager.conf` (arquivo gerenciado por ele) com os três atalhos, as regras das três janelas (atividade, texto e painel) e o autostart, e garante um `source` dele no seu `hyprland.conf` — uma única vez.
2. Em seguida roda `hyprctl reload`. Os atalhos passam a valer na hora, sem reiniciar nada.
3. Ao apertar um atalho, o Hyprland executa `source/bin/am-trigger.sh quick` (ou `clip`/`panel`), que manda uma linha para o serviço que já está rodando por uma porta de loopback. A janela abre em ~50 ms, sem subir um Electron novo.

Se o serviço estiver fora do ar quando você usar um atalho, o script sobe o app — e ele fica na bandeja a partir daí.

As janelas de captura seguram o foco do teclado enquanto estão abertas (regra `stay_focused`, a mesma que os lançadores usam). Sem isso o Hyprland devolveria o foco para a janela embaixo do cursor e elas se fechariam antes de você digitar. Fecham com **Esc**; salvam com **Enter**.

O painel é o oposto: ele leva `pin` (aparece em todos os workspaces) mas **não** leva `stay_focused`, e não fecha ao perder o foco. Ele é a interface principal do app e fica aberto — se prendesse o foco como as janelas de captura fazem, você não conseguiria digitar em mais nenhuma janela enquanto ele estivesse na tela. Ele some só quando você manda: **×** no cabeçalho ou pelo tray.

Pelo mesmo motivo o painel **não** fecha com Esc solto: uma tecla que "escapa" de uma janela que nem prende o teclado só serviria para fechá-lo sem querer enquanto você digita em outro lugar.

A borda em que o painel encosta (`Configurações → Lado do painel`) é aplicada tanto pela window rule do Hyprland quanto por geometria calculada direto no Electron, para funcionar igual em qualquer ambiente.

Antes de salvar, a tela de configurações avisa se a combinação escolhida **já pertence a outro atalho** (no Omarchy, por exemplo, `Super+Shift+A` é o ChatGPT). Salvar sobrescreve o atalho antigo enquanto o Activity Manager estiver instalado; `./install-desktop.sh --uninstall` desfaz tudo (e faz backup do `hyprland.conf`).

**X11 / outros ambientes:** o Electron registra os atalhos sozinho, sem precisar de nada disso. Em compositores Wayland que não sejam Hyprland, o app mostra nas configurações os comandos (`am-trigger.sh quick` / `am-trigger.sh clip` / `am-trigger.sh panel`) para você vincular a teclas no seu ambiente.

## Dados e privacidade

Todas as informações são salvas localmente na pasta de dados do usuário do Electron (`~/.config/activity-manager/`):

- `activities.json`: lista de atividades.
- `entries.json`: textos salvos do clipboard.
- `config.json`: preferências do usuário.

Nenhum dado é enviado para a internet — a única rede usada é o loopback (`127.0.0.1`) dos gatilhos locais. Se quiser fazer backup ou migrar para outro computador, use a exportação/importação de JSON nas configurações.

### Migração do antigo clipboard-manager

Os textos ficavam em `~/.config/clipboard-manager/entries.json`. O formato é idêntico ao que este app usa, então migrar é copiar o arquivo (com o serviço parado, senão o app reescreve por cima ao sair):

```bash
cp ~/.config/clipboard-manager/entries.json ~/.config/activity-manager/entries.json
```
