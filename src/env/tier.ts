/**
 * Device quality tier. Budgets that depend on it:
 *   low : DPR cap 1.5, mascot RT 341x512 MSAA2 @30fps, <=400 particles, <=1 live filter
 *   high: DPR cap 2,   mascot RT 512x768 MSAA4 @60fps, <=1000 particles, <=3 live filters
 * Override with ?tier=low|high.
 */
export type QualityTier = 'low' | 'high';

export interface TierBudget {
  maxParticles: number;
  maxFilters: number;
  mascotRT: { w: number; h: number; samples: number; fps: number };
  idleShaders: boolean;
}

export const TIER_BUDGETS: Record<QualityTier, TierBudget> = {
  low: { maxParticles: 400, maxFilters: 1, mascotRT: { w: 341, h: 512, samples: 2, fps: 30 }, idleShaders: false },
  high: { maxParticles: 1000, maxFilters: 3, mascotRT: { w: 512, h: 768, samples: 4, fps: 60 }, idleShaders: true },
};

export const detectTier = (): QualityTier => {
  const q = new URLSearchParams(location.search).get('tier');
  if (q === 'low' || q === 'high') return q;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return 'low';
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent);
  if (isIOS && Math.min(screen.width, screen.height) <= 375) return 'low';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'low';
    if ((gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) < 4096) return 'low';
  } catch {
    return 'low';
  }
  return 'high';
};
