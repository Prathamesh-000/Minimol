/** Conservative policy: manual signaling may wait; active inference never resumes uncertain KV state. */
export class LifecycleGuard {
  lastEvent = 'created';
  recovery = 'Foreground required for an active pair';
  #wall = Date.now();
  #mono = performance.now();
  constructor(private active: () => boolean, private invalidate: (reason: string) => void, readonly maxGapMs = 10000) {}
  reset(wall = Date.now(), mono = performance.now()): void { this.#wall = wall; this.#mono = mono; }
  check(wall = Date.now(), mono = performance.now()): boolean {
    const gap = Math.max(wall - this.#wall, mono - this.#mono); this.reset(wall, mono);
    if (this.active() && gap > this.maxGapMs) { this.fail(`Execution paused for ${Math.round(gap)} ms; session state is uncertain`); return false; }
    return true;
  }
  transition(event: string): void {
    this.lastEvent = event;
    if (['hidden','freeze','pagehide'].includes(event) && this.active()) this.fail(`Page ${event}; active inference cannot safely continue while suspended`);
    else this.check();
  }
  private fail(reason: string) { this.recovery = 'Session discarded. Keep both screens awake, Load / retry on BOTH phones, exchange a NEW offer/answer.'; this.invalidate(reason + '. ' + this.recovery); }
}
export function bindLifecycle(guard: LifecycleGuard, doc: Document, win: Window): () => void {
  const visibility = () => guard.transition(doc.hidden ? 'hidden' : 'visible');
  const freeze = () => guard.transition('freeze'), resume = () => guard.transition('resume');
  const hide = () => guard.transition('pagehide'), show = () => guard.transition('pageshow');
  doc.addEventListener('visibilitychange', visibility); doc.addEventListener('freeze', freeze); doc.addEventListener('resume', resume);
  win.addEventListener('pagehide', hide); win.addEventListener('pageshow', show);
  return () => { doc.removeEventListener('visibilitychange', visibility); doc.removeEventListener('freeze', freeze); doc.removeEventListener('resume', resume); win.removeEventListener('pagehide', hide); win.removeEventListener('pageshow', show); };
}
