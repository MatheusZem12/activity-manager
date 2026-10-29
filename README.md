# Activity Manager

A local desktop service with **two features in one interface**:

- **Activities** — jot down what you need to do, get alerts in the corner of the screen and see how long it took to get done.
- **Clipboard** — keep short texts you reuse (commands, repeated messages, drafts) and put them back on the clipboard with one click.

Everything is saved on your machine: no sign-in, no cloud and no database.

The app lives in the tray. Its panel is a regular window (Hyprland handles its position, size and focus), with the two features as tabs, plus two small capture windows that pop up over whatever you are doing.

> **It doesn't monitor the system clipboard.** Only texts you create by hand exist.

> This app absorbed the old `clipboard-manager` project, which used to be a separate service. One service, one tray icon, one Hyprland config file.

## Technologies

- Electron
- HTML/CSS/JavaScript
- Local JSON persistence
- Native operating system notifications

## Features

### Shared

- **One panel** with the **Activities**, **Clipboard** and **Settings** tabs. Closing it (the **×** in the header or the tray) only hides it — it reopens instantly.
- **Three global shortcuts**, set inside the app — **the service registers them in the graphical environment itself**, you edit no config file:
  - `Ctrl+Alt+A` — a quick window to jot down an **activity**;
  - `Ctrl+Alt+C` — a quick window to save a **text**;
  - `Ctrl+Alt+P` — opens/focuses the **panel**.
- **Tag autocomplete**: when you type `#`, tags already in use show up as suggestions — `Tab` accepts the first. Activities and texts have separate tag sets.
- **Search and filter** on each tab: a search field (shortcut `/`) and tag chips; clicking a tag on a card filters too.
- **System tray**: the app keeps running with the panel closed.
- **Start with the system** (optional).

### Activities

- **Simple syntax**: type the activity name, use `#tag` to categorize and `!N` to set the alert.
  - Example: `math homework #college #exam !30`
  - The time takes minutes and hours: `!30`, `!45m`, `!2h`, `!1h30`.
  - If the time is left out, the configured default applies.
- **Live preview**: while you type, the app shows how the text will be read (text, tags and alert time).
- **Inline editing**: the pencil on the card opens the text for editing (it takes `#tag` and `!N`); editing without `!N` keeps the current alert.
- **Snooze and reopen**: the snooze button reschedules the alert; done activities can be reopened.
- **Native alerts** show up in the corner of the screen when the time comes (with an optional chime) — and **repeat at the same interval** (`!N`) until you mark the activity done, instead of warning only once.
- **Mark it done** and see how long it took since it was created.
- A configurable **character limit** to keep activities short and to the point.

### Clipboard

- **Quick capture**: an (optional) title + content. Use `#tag` in the title to categorize.
  - `Enter` in the title focuses the content; `Enter` in the content saves; `Shift+Enter` adds a new line; `Ctrl+Enter` saves from any field; `Esc` closes.
  - The content is stored **exactly as typed** (byte for byte) — it is what gets pasted.
- **Copy** puts the content on the system clipboard and counts how many times each text has been used.
- Sorting by **Recent** or **Most copied**.
- **Inline editing and deletion**, with the same `#tag` autocomplete on the title.
- If the title is empty, the card shows the content's 1st line instead.

## Project layout

```
source/
├── electron.js                        # Entry point: windows, tray, IPC, notifications
├── preload.js                         # Safe bridge between main and renderer
├── bin/
│   ├── am-trigger.sh                  # What the shortcuts run: wakes the service
│   └── make-notification-sound.js     # Generates the alert chime (assets/notification.wav)
├── assets/                            # Icons (icon.svg/icon.png + tray-icon.png) and the chime
├── package.json
└── src/
    ├── shared/
    │   ├── activity-parser.js         # Parses text, #tags and !time (main + renderer)
    │   └── entry-parser.js            # Extracts #tags from a text's title (main + renderer)
    ├── main/
    │   ├── window-identity.js         # Window class + titles (single source)
    │   ├── scheduler.js               # Alert timer
    │   ├── sound.js                   # Plays the chime at its own volume
    │   ├── shortcut-manager.js        # Registers shortcuts and window rules in the graphical environment
    │   ├── hypr.js                    # Talks to Hyprland through hyprctl
    │   ├── trigger-server.js          # Local port the shortcuts hit
    │   └── storage/
    │       ├── activity-store.js      # Activity persistence
    │       ├── entry-store.js         # Clipboard text persistence
    │       └── config-store.js        # User settings
    └── renderer/
        ├── index.html
        ├── styles.css
        └── app.js                     # Interface (panel, tabs, capture windows)
```

## Running

```bash
cd source
npm install
npm start        # or ./start.sh (at the project root)
```

Manual triggers (normally fired by the global shortcuts or the tray):

```bash
source/bin/am-trigger.sh quick   # opens the quick activity window
source/bin/am-trigger.sh clip    # opens the quick text window (clipboard)
source/bin/am-trigger.sh panel   # opens the panel
```

### Install as a desktop app (Linux)

To create a launcher in the applications menu, with an icon, pointing straight at the code in `source/`:

```bash
./install-desktop.sh              # installs/updates the launcher
./install-desktop.sh --uninstall  # removes it
```

## How the global shortcuts work

You set the three shortcuts under **Settings → Shortcuts** and click save. That's it. The service handles the rest.

Why this needs explaining: on Wayland, **no application can listen to the keyboard while it is not focused** — it is a protocol restriction, not an Electron bug. Only the compositor sees the keys. So instead of asking you to edit the Hyprland config by hand, the service talks to the compositor for you:

1. On save, the app writes `~/.config/hypr/activity-manager.conf` (a file it manages) with the three shortcuts, the capture window rules and the autostart, and makes sure your `hyprland.conf` sources it — only once.
2. Then it runs `hyprctl reload`. The shortcuts apply right away, with no restart.
3. When you press a shortcut, Hyprland runs `source/bin/am-trigger.sh quick` (or `clip`/`panel`), which sends one line to the already running service through a loopback port. The window opens in ~50 ms, without starting a new Electron.

If the service is down when you use a shortcut, the script starts the app — and it stays in the tray from then on.

The capture windows float centered and hold keyboard focus while open (the `stay_focused` rule, the same one launchers use). Without it Hyprland would hand focus back to the window under the cursor and they would close before you typed. They close with **Esc** and save with **Enter**; losing focus closes them unless you have already typed something.

The panel gets no window rule at all: it is a normal window, and the compositor handles it better than any rule could. (Position rules fail silently on Hyprland — `hyprctl` answers `ok` and nothing moves.)

Before saving, the settings screen warns you if the chosen combination **already belongs to another shortcut** (on Omarchy, for example, `Super+Shift+A` is ChatGPT). Saving overrides the old shortcut while Activity Manager is installed; `./install-desktop.sh --uninstall` undoes everything (and backs up `hyprland.conf`).

**X11 / other environments:** Electron registers the shortcuts on its own, with none of this. On Wayland compositors other than Hyprland, the settings show the commands (`am-trigger.sh quick` / `am-trigger.sh clip` / `am-trigger.sh panel`) for you to bind to keys in your environment.

## Data and privacy

Everything is saved locally in Electron's user data folder (`~/.config/activity-manager/`):

- `activities.json`: the activity list.
- `entries.json`: the saved clipboard texts.
- `config.json`: the user's preferences.

No data is sent to the internet — the only network used is the loopback (`127.0.0.1`) of the local triggers. To back up or move to another computer, copy those three files (with the service stopped, otherwise the app writes over them when it quits).

### Migrating from the old clipboard-manager

The texts lived in `~/.config/clipboard-manager/entries.json`. The format is identical to the one this app uses, so migrating means copying the file (with the service stopped, otherwise the app writes over it when it quits):

```bash
cp ~/.config/clipboard-manager/entries.json ~/.config/activity-manager/entries.json
```
