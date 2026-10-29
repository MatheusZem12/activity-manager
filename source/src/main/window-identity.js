/**
 * Window identity for the compositor — the single source of truth.
 *
 * The `class` (set by app.setName) and the overlay window titles show up in
 * electron.js (when creating the windows) **and** in shortcut-manager.js
 * (when generating the Hyprland window rules). If they differ by one character,
 * float/pin/stay_focused silently stops matching. That is why they live here,
 * in one place, imported by both.
 */
module.exports = {
  WM_CLASS: 'activity-manager',
  QUICK_WINDOW_TITLE: 'New activity',
  CLIP_WINDOW_TITLE: 'New text',
  PANEL_WINDOW_TITLE: 'Activities'
};
