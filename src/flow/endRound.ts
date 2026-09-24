import type { RgsRound } from '../rgs/types';

/**
 * When to call /wallet/end-round (web-sdk createPrimaryMachines BET_TYPE_METHODS_MAP,
 * engine FAQ "when to call end-round"):
 *
 *  - 'none'              round not active: the RGS already settled it (zero payout) —
 *                        nothing to call.
 *  - 'immediate'         single reveal with a win: end-round right after /play (in
 *                        parallel with the animation); the returned balance is HELD and
 *                        shown only when the presentation ends.
 *  - 'afterPresentation' multi-reveal (bonus) with a win: POST /bet/event with the reveal
 *                        index on every reveal so a reload resumes mid-bonus, then
 *                        end-round after the presentation.
 */
export type EndRoundPolicy = 'none' | 'immediate' | 'afterPresentation';

export const endRoundPolicy = (round: Pick<RgsRound, 'active'>, revealCount: number): EndRoundPolicy => {
  if (!round.active) return 'none';
  return revealCount > 1 ? 'afterPresentation' : 'immediate';
};

/** Array position to resume from, given the recorded /bet/event value (a reveal's book index). */
export const resumePosition = (events: ReadonlyArray<{ index: number; type: string }>, recorded: string | null | undefined): number => {
  if (recorded === null || recorded === undefined || recorded === '') return 0;
  const idx = Number(recorded);
  if (!Number.isFinite(idx) || idx <= 0) return 0;
  const byIndex = events.findIndex((e) => e.index === idx);
  const pos = byIndex >= 0 ? byIndex : Math.min(events.length - 1, Math.floor(idx));
  // always restart at a reveal so the player sees the whole (free)spin again
  for (let p = pos; p >= 0; p--) if (events[p].type === 'reveal') return p;
  return 0;
};
