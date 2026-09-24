import type { GameContext } from '../game/context';

/** STUB — replaced by the flow module (RGS client, book player, FSM, replay, resume). */
export class FlowController {
  constructor(private ctx: GameContext) {}
  async start(): Promise<void> {
    void this.ctx;
  }
}
