/**
 * Identidade das janelas para o compositor — fonte única da verdade.
 *
 * O `class` (definido por app.setName) e os títulos das janelas overlay
 * aparecem no electron.js (ao criar as janelas) **e** no shortcut-manager.js
 * (ao gerar as window rules do Hyprland). Se divergirem por um caractere, o
 * float/pin/stay_focused silenciosamente deixa de casar. Por isso ficam aqui,
 * num só lugar, importados pelos dois.
 */
module.exports = {
  WM_CLASS: 'activity-manager',
  QUICK_WINDOW_TITLE: 'Nova atividade',
  CLIP_WINDOW_TITLE: 'Novo texto',
  PANEL_WINDOW_TITLE: 'Atividades'
};
