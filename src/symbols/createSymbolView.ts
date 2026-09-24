import { Container, Sprite } from 'pixi.js';
import { getSymbolDef } from '../config/game';
import type { GameContext } from '../game/context';
import type { LandOptions, SymbolState, SymbolView } from './types';

/**
 * Factory used by the Board. STUB IMPLEMENTATION (static sprite, no animation) —
 * the symbols module replaces the body of `createSymbolView` with the full AAA
 * implementation while keeping this exact signature.
 */
export const createSymbolView = (ctx: GameContext, id: string): SymbolView => new StubSymbolView(ctx, id);

class StubSymbolView implements SymbolView {
  readonly view = new Container({ label: 'symbol' });
  private sprite: Sprite;
  private _id: string;
  private _state: SymbolState = 'static';

  constructor(
    private ctx: GameContext,
    id: string,
  ) {
    this._id = id;
    this.sprite = new Sprite(ctx.art.symbol(id));
    this.sprite.anchor.set(0.5);
    this.view.addChild(this.sprite);
    this.applyDef();
  }

  get id(): string {
    return this._id;
  }
  get state(): SymbolState {
    return this._state;
  }

  private applyDef(): void {
    const def = getSymbolDef(this._id);
    const cell = this.ctx.layout.cell;
    const canvas = this.ctx.art.symbolCanvas;
    this.sprite.scale.set((cell * 1.2) / canvas / (this.sprite.texture.width / canvas));
    this.sprite.angle = def.restAngle;
  }

  setSymbol(id: string): void {
    this._id = id;
    this.sprite.texture = this.ctx.art.symbol(id);
    this.applyDef();
    this._state = 'static';
  }
  setBlur(): void {}
  async land(_opts: LandOptions): Promise<void> {
    this._state = 'static';
  }
  setAnticipation(): void {}
  setDim(on: boolean): void {
    this.sprite.tint = on ? 0x5a5a5a : 0xffffff;
  }
  async win(): Promise<void> {
    this._state = 'postWin';
  }
  async explode(): Promise<void> {
    this.view.visible = false;
    this._state = 'hidden';
  }
  idleAccent(): void {}
  reset(): void {
    this.view.visible = true;
    this.sprite.tint = 0xffffff;
    this._state = 'static';
  }
  setElevated(on: boolean): void {
    if (on) this.ctx.layers.winLayer.attach(this.view);
    else this.ctx.layers.winLayer.detach(this.view);
  }
  destroy(): void {
    this.view.destroy({ children: true });
  }
}
