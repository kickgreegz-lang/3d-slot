import { gsap } from 'gsap';
import { BitmapText, Container, Sprite } from 'pixi.js';
import type { Rect } from '../../../config/layout';
import { glowTexture } from '../../../fx/textures';
import { punchScale } from '../../../present/common/anim';
import { Plate } from '../../../present/common/Plate';
import { label } from '../../../present/common/text';
import { jukebox, speakerStack } from './art/emblems';
import { type Baked, screenArt, useBaked } from './art/ScreenArt';
import { SCR_LABEL, SCR_NUM, fitText } from './fonts';
import { type FeatureSkin, SCREENS_TIMING, SKINS } from './look';

/**
 * FEATURE PLATE (DESIGN §10.3 / §14): the free-spin counter of Bass Drop, in the layout's
 * fsPlate rect (landscape / tablet, under the logo): a Plate in the feature accent with the
 * feature's mini emblem, the caption JUKE JAM / MEGA MIX and the live "3 / 8". Punches on
 * every count, re-titles (and flashes its total) on the upgrade. Portrait / compact have no
 * plate: the Groove Meter chip carries the merged line there, so `place(null)` hides it.
 * Gameplay time (s()-scaled durations are passed in by the owner).
 */
export class FeaturePlate {
  readonly view = new Container({ label: 'featurePlate' });
  private readonly body = new Container();
  private plate: Plate;
  private readonly glow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', alpha: 0.32 });
  private readonly icon = new Sprite();
  private readonly caption: BitmapText;
  private readonly value: BitmapText;
  private skin: FeatureSkin = 'jukejam';
  private rect: Rect | null = null;
  private res = 1;
  private current = 0;
  private total = 0;
  shown = false;
  private tweens: gsap.core.Tween[] = [];

  constructor() {
    this.plate = new Plate(SKINS.jukejam.accent, 0.88);
    this.caption = new BitmapText({ text: '', style: { fontFamily: SCR_LABEL, fontSize: 36 }, anchor: 0.5 });
    this.value = new BitmapText({ text: '', style: { fontFamily: SCR_NUM, fontSize: 46 }, anchor: 0.5 });
    this.body.addChild(this.glow, this.plate, this.icon, this.caption, this.value);
    this.view.addChild(this.body);
    this.view.visible = false;
    this.body.scale.set(0);
  }

  /** The layout's fsPlate rect, or null where the meter chip shows the free spins. */
  place(rect: Rect | null, res: number): void {
    this.rect = rect;
    this.res = res;
    if (!rect) {
      this.view.visible = false;
      return;
    }
    this.view.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2);
    this.view.visible = this.shown;
    this.plate.resize(rect.w, rect.h);
    this.glow.width = rect.w * 1.3;
    this.glow.height = rect.h * 2.2;
    this.paint();
  }

  private emblem(): Baked {
    return this.skin === 'megamix'
      ? screenArt.get('emblem:megamix', this.res * 0.25, speakerStack)
      : screenArt.get('emblem:jukejam', this.res * 0.25, jukebox);
  }

  private paint(): void {
    const r = this.rect;
    if (!r) return;
    const look = SKINS[this.skin];
    this.plate.accentColor = look.accent;
    this.glow.tint = look.accent;
    const h = r.h;
    // mini emblem on the left, text centred in the rest
    const iconH = h * 0.86;
    useBaked(this.icon, this.emblem());
    this.icon.scale.set(1);
    this.icon.scale.set(iconH / this.icon.texture.height);
    this.icon.position.set(-r.w / 2 + h * 0.52, h * 0.02);
    const textX = (h * 0.95) / 2;
    const textW = r.w - h * 0.95 - 24;
    this.caption.text = label(look.titleKey, this.skin === 'megamix' ? 'MEGA MIX' : 'JUKE JAM');
    this.caption.tint = look.accent;
    this.caption.style.fontSize = Math.round(h * 0.33);
    fitText(this.caption, textW);
    this.caption.position.set(textX, -h * 0.2);
    this.value.style.fontSize = Math.round(h * 0.42);
    this.value.text = label('bd.feature.fsOf', '{current} / {total}', { current: this.current, total: this.total });
    fitText(this.value, textW);
    this.value.position.set(textX, h * 0.17);
  }

  setSkin(skin: FeatureSkin, punch = 0): void {
    if (skin === this.skin) return;
    this.skin = skin;
    this.paint();
    if (this.shown && punch > 0) this.punch(punch, 1.28);
  }

  set(current: number, total: number, punch: number): void {
    const grew = this.total > 0 && total > this.total;
    this.current = current;
    this.total = total;
    this.paint();
    if (!this.shown || punch <= 0) return;
    this.punch(punch, SCREENS_TIMING.plate.punchScale);
    if (grew) {
      this.value.tint = SKINS.megamix.accent;
      this.tweens.push(gsap.delayedCall(punch * 3, () => (this.value.tint = 0xffffff)));
    }
  }

  private punch(duration: number, from: number): void {
    this.tweens.push(punchScale(this.body.scale, from, duration, 'back.out(3)'));
  }

  show(duration: number): void {
    if (this.shown) return;
    this.shown = true;
    this.view.visible = this.rect !== null;
    this.kill();
    this.body.scale.set(0);
    this.tweens.push(gsap.to(this.body.scale, { x: 1, y: 1, duration, ease: 'back.out(2.2)' }));
  }

  hide(duration: number): void {
    if (!this.shown) return;
    this.shown = false;
    this.kill();
    this.tweens.push(
      gsap.to(this.body.scale, {
        x: 0,
        y: 0,
        duration,
        ease: 'back.in(2)',
        onComplete: () => {
          this.view.visible = false;
        },
      }),
    );
  }

  private kill(): void {
    for (const t of this.tweens) t.kill();
    this.tweens = [];
  }

  destroy(): void {
    this.kill();
    this.view.destroy({ children: true });
  }
}
