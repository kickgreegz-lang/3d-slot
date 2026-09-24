import {
  Bone,
  CatmullRomCurve3,
  TubeGeometry,
  Vector3,
  CylinderGeometry,
  type BufferGeometry,
  ConeGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';

/**
 * PLACEHOLDER ONLY. Turns the CC0 RobotExpressive rig into two readable swamp characters
 * with a handful of primitive props parented to its bones (head, chest, hips), so look-dev,
 * timing and composition can be judged before the production GLBs exist:
 *   gator — long snout with nostrils and teeth, heavy lids, gold chain, springy tail
 *   frog  — DJ headphones, wide grin, throat pouch, sleepy lids
 * Every prop is a normal mesh: it is toon-shaded, inked and animated with the body.
 * Production GLBs never go through this file (MascotDef.dress is unset for them).
 *
 * Coordinates are authored in the robot's HEAD frame (x = character's left, y = up,
 * z = forward, world units, origin at the head mesh pivot; head x ±1.32, y ±0.83,
 * face at z 1.23, eye discs at x ±0.7, y -0.08, r 0.38, brows y 0.4..0.55) or in MODEL
 * space at the rest pose.
 */
export type DressKind = 'gator' | 'frog';

export interface DressColors {
  skin: number;
  shade: number;
  belly: number;
  accent: number;
}

export interface Dressing {
  /** unlit, un-inked highlight meshes (eye glints) */
  glints: Object3D[];
  materials: Material[];
  geometries: BufferGeometry[];
}

const INK = 0x15101c;
const TOOTH = 0xfff4d6;
const GOLD = 0xf2c230;
const WHITE = 0xffffff;

export const dressPlaceholder = (model: Object3D, kind: DressKind, colors: DressColors): Dressing | null => {
  let eyes: Object3D | null = null;
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!eyes && mesh.isMesh && /^Head_\d+$/.test(mesh.name) && (mesh.material as Material).name === 'Black') eyes = mesh;
  });
  const headGroup = (eyes as Object3D | null)?.parent;
  const bones = new Map<string, Object3D>();
  model.traverse((o) => {
    if ((o as Bone).isBone) bones.set(o.name.replace(/_\d+$/, ''), o);
  });
  const chest = bones.get('Torso');
  const hips = bones.get('Hips');
  if (!headGroup || !chest || !hips) return null;
  model.updateMatrixWorld(true);

  const out: Dressing = { glints: [], materials: [], geometries: [] };
  const mats = new Map<number, MeshBasicMaterial>();
  const mat = (color: number): MeshBasicMaterial => {
    let m = mats.get(color);
    if (!m) {
      m = new MeshBasicMaterial({ color, name: 'prop' });
      mats.set(color, m);
      out.materials.push(m);
    }
    return m;
  };
  const mesh = (geo: BufferGeometry, color: number, parent: Object3D): Mesh => {
    out.geometries.push(geo);
    const m = new Mesh(geo, mat(color));
    parent.add(m);
    return m;
  };

  // head frame: the head mesh group is Blender Z-up at 1/100 scale -> y-up, z-forward, world units
  const head = new Group();
  head.name = 'dress:head';
  head.rotation.x = Math.PI / 2;
  head.scale.setScalar(0.01);
  headGroup.add(head);

  // eye glints (key light is top-left): the cheapest "alive" read there is
  for (const side of [1, -1]) {
    const big = mesh(new SphereGeometry(0.1, 12, 8), WHITE, head);
    big.position.set(side * 0.7 - 0.15, -0.1, 1.36);
    const small = mesh(new SphereGeometry(0.05, 10, 6), WHITE, head);
    small.position.set(side * 0.7 + 0.13, -0.3, 1.35);
    out.glints.push(big, small);
  }

  // lids: half discs over the top of each eye; `edge` = lid line height, `tilt` > 0 = stern
  const lid = (side: number, tilt: number, edge: number, color: number): void => {
    const geo = new CylinderGeometry(0.44, 0.44, 0.12, 20, 1, false, -Math.PI / 2, Math.PI);
    const m = mesh(geo, color, head);
    m.rotation.order = 'ZYX'; // face forward first, then tilt about the forward axis
    m.rotation.set(-Math.PI / 2, 0, tilt * side);
    m.position.set(side * 0.7, edge, 1.32);
  };

  // props authored in model space at the rest pose, then re-parented to a bone
  const onBone = (bone: Object3D, build: (g: Group) => void): Group => {
    const g = new Group();
    model.add(g);
    build(g);
    g.updateMatrixWorld(true);
    bone.attach(g);
    return g;
  };

  if (kind === 'gator') {
    // snout: long flattened ellipsoid from the lower face, nostril bumps, a row of teeth
    const snout = mesh(new SphereGeometry(1, 28, 16), colors.skin, head);
    snout.scale.set(0.95, 0.33, 0.82);
    snout.position.set(0, -0.66, 1.42);
    const jaw = mesh(new SphereGeometry(1, 24, 12), colors.belly, head);
    jaw.scale.set(0.82, 0.19, 0.72);
    jaw.position.set(0, -0.92, 1.34);
    for (const side of [1, -1]) {
      const nostril = mesh(new SphereGeometry(0.12, 12, 8), colors.shade, head);
      nostril.position.set(side * 0.28, -0.42, 2.02);
    }
    for (let i = 0; i < 7; i++) {
      const a = 0.35 + (i / 6) * (Math.PI - 0.7);
      const tooth = mesh(new ConeGeometry(0.07, 0.24, 8), TOOTH, head);
      tooth.rotation.x = Math.PI;
      tooth.position.set(Math.cos(a) * 0.88, -0.8, 1.42 + Math.sin(a) * 0.76);
    }
    lid(1, 0.3, 0.06, colors.shade);
    lid(-1, 0.3, 0.06, colors.shade);

    // bouncer bling: gold chain + medallion on the chest
    onBone(chest, (g) => {
      const chain = mesh(new TorusGeometry(0.62, 0.07, 8, 32, Math.PI), GOLD, g);
      chain.rotation.set(-0.35, 0, Math.PI);
      chain.position.set(0, 2.62, 0.72);
      const coin = mesh(new CylinderGeometry(0.24, 0.24, 0.08, 20), GOLD, g);
      coin.rotation.x = Math.PI / 2 - 0.35;
      coin.position.set(0, 1.98, 0.97);
    });

    // tail: three tapered segments on spring bones (procedural.ts picks up "tail" bones)
    onBone(hips, (g) => {
      g.position.set(0, 1.2, -0.7);
      g.rotation.y = 0.6; // sweep toward the character's right so it reads in the 3/4 view
      let parent: Object3D = g;
      const radii = [0.46, 0.32, 0.2, 0.05];
      const lens = [0.8, 0.72, 0.62];
      for (let i = 0; i < 3; i++) {
        const b = new Bone();
        b.name = `tail_${i}`;
        b.rotation.x = i === 0 ? -2.2 : 0.35;
        if (i > 0) b.position.y = lens[i - 1];
        parent.add(b);
        const geo = new CylinderGeometry(radii[i + 1], radii[i], lens[i], 14);
        geo.translate(0, lens[i] / 2, 0);
        mesh(geo, i === 0 ? colors.skin : colors.shade, b);
        const knob = mesh(new SphereGeometry(radii[i], 14, 10), colors.skin, b);
        knob.scale.setScalar(0.98);
        parent = b;
      }
    });
  } else {
    // DJ headphones: band over the crown, big cups over the ears
    const band = mesh(new TorusGeometry(1.42, 0.1, 10, 40, Math.PI), INK, head);
    band.position.set(0, -0.48, -0.1);
    for (const side of [1, -1]) {
      const cup = mesh(new CylinderGeometry(0.5, 0.5, 0.32, 24), colors.accent, head);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 1.44, -0.22, -0.1);
      const pad = mesh(new CylinderGeometry(0.32, 0.32, 0.1, 20), INK, head);
      pad.rotation.z = Math.PI / 2;
      pad.position.set(side * 1.64, -0.22, -0.1);
    }
    // wide grin + throat pouch
    const smile = new CatmullRomCurve3([
      new Vector3(-0.95, -0.46, 1.34),
      new Vector3(-0.5, -0.66, 1.4),
      new Vector3(0, -0.72, 1.42),
      new Vector3(0.5, -0.66, 1.4),
      new Vector3(0.95, -0.46, 1.34),
    ]);
    mesh(new TubeGeometry(smile, 32, 0.06, 8), INK, head);
    const pouch = mesh(new SphereGeometry(1, 24, 14), colors.belly, head);
    pouch.scale.set(0.8, 0.4, 0.6);
    pouch.position.set(0, -1.05, 0.85);
    lid(1, -0.08, -0.02, colors.skin);
    lid(-1, -0.08, -0.02, colors.skin);
  }

  for (const g of out.glints) g.userData.unlit = true;
  return out;
};
