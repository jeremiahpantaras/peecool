/**
 * Peecool is light-only (owner decision, Phase 1). There is no theme toggle and no dark set; the
 * `ps_theme` device preference and the `courtTheme` setting are kept in storage/API for compatibility
 * but have no visual effect. Stale `ps_theme` values are removed so they cannot confuse anyone later.
 */
export function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', 'light');
  try { localStorage.removeItem('ps_theme'); } catch { /* storage may be blocked */ }
}
/** Kept so CourtPage keeps its call site; the court console uses the same light theme. */
export function useConsoleTheme(_courtTheme?: 'light' | 'dark'): void { /* light only */ }
