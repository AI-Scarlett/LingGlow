/*
 * Portions ported from freestylefly/codex-themes @45dbc55
 * (MIT, Copyright (c) 2026 canghe), which in turn ports
 * Fei-Away/Codex-Dream-Skin (MIT, Copyright (c) 2026 Codex Dream Skin Studio
 * contributors). See THIRD_PARTY_NOTICES.md.
 *
 * Reworked from upstream electron/engine/home-detection.ts:17-25. The
 * `visibleThemeHome` signal is dropped: LingGlow never builds its own home
 * surface, so the only positive signals are the native game-source header and
 * the native suggestion list.
 */

/**
 * Pure home-surface classifier shared with the injected renderer payload.
 *
 * Codex keeps some route DOM mounted while navigating, so a present-but-hidden
 * home icon is not proof that the home screen is the active surface. Negative
 * signals are evaluated first: a surface that is outside the shell, detached,
 * unrendered, or already showing conversation/task content is never home.
 *
 * @param {{
 *   withinShell: boolean,
 *   connected: boolean,
 *   rendered: boolean,
 *   visibleGameSource: boolean,
 *   visibleSuggestions: boolean,
 *   visibleTaskContent: boolean,
 * }} signals
 * @returns {boolean}
 */
export function isActiveHomeSurface(signals) {
  if (!signals || typeof signals !== 'object') return false;
  if (!signals.withinShell || !signals.connected || !signals.rendered) return false;
  if (signals.visibleTaskContent) return false;
  return Boolean(signals.visibleGameSource || signals.visibleSuggestions);
}
