import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  HemisphereLight,
  type Material,
  type Mesh,
  MeshToonMaterial,
  NearestFilter,
  NoColorSpace,
  type Object3D,
  RGBAFormat,
  type Scene,
  type Texture,
  Vector3,
} from 'three';

/**
 * Toon look shared by every mascot: a gamma-space cel pipeline that matches the
 * 2D art (ColorManagement is disabled by the bridge, so material colours are the
 * sRGB hex values you see on screen).
 *
 * Shading = diffuse * (key * ramp(N·L) + fill) / PI, with a 3-step Nearest ramp.
 * Intensities are solved so the three bands land on the cel palette:
 *   lit  = 1.00 x base    (key * 1.000 + fill = PI)
 *   mid  = 0.70 x base    (key * 0.667 + fill)
 *   deep = 0.42 x base    (key * 0.353 + fill)
 */
export const TOON = {
  /** Ramp texels (0..255): hard bands, no smoothing. */
  ramp: [90, 170, 255],
  /** Key light: top-left, slightly in front (camera space; the camera never rotates). */
  keyDir: new Vector3(-0.62, 0.72, 0.52),
  keyIntensity: 2.83,
  /** Soft fill: warm-white sky, cool plum bounce from the club floor. */
  fillSky: 0xffffff,
  fillGround: 0xb49ccc,
  fillIntensity: 0.33,
  /** Outline colour (pure black, same as the 2D symbol ink). */
  ink: 0x000000,
} as const;

/** Colour override for untextured placeholder parts (first matching rule wins). */
export interface PaletteRule {
  /** tested against the mesh name and its parent's name (GLTF numeric suffixes stripped) */
  mesh?: RegExp;
  /** tested against the source material name */
  material?: RegExp;
  color: number;
}

export const makeRampTexture = (): DataTexture => {
  const data = new Uint8Array(TOON.ramp.length * 4);
  TOON.ramp.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const tex = new DataTexture(data, TOON.ramp.length, 1, RGBAFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
};

/** Key + fill rig, fixed in camera space so every mascot is lit from the same screen direction. */
export const addToonLights = (scene: Scene, target: Object3D): void => {
  const hemi = new HemisphereLight(TOON.fillSky, TOON.fillGround, TOON.fillIntensity);
  scene.add(hemi);
  const key = new DirectionalLight(0xffffff, TOON.keyIntensity);
  key.position.copy(TOON.keyDir).multiplyScalar(10);
  key.target = target;
  scene.add(key);
};

const baseName = (o: Object3D | null): string => (o?.name ?? '').replace(/_\d+$/, '');

const pickColor = (mesh: Mesh, source: Material, palette: readonly PaletteRule[]): number | null => {
  const names = [baseName(mesh), baseName(mesh.parent)];
  for (const rule of palette) {
    if (rule.mesh && !names.some((n) => rule.mesh?.test(n))) continue;
    if (rule.material && !rule.material.test(source.name)) continue;
    return rule.color;
  }
  return null;
};

interface LitSource extends Material {
  color?: Color;
  map?: Texture | null;
}

/**
 * Replace every material under `root` with a MeshToonMaterial on the shared ramp,
 * recolouring untextured parts through `palette`. Returns the created materials
 * (owned by the caller, disposed with the mascot).
 */
export const toonify = (root: Object3D, ramp: Texture, palette: readonly PaletteRule[]): MeshToonMaterial[] => {
  const created: MeshToonMaterial[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.userData.unlit) return;
    const convert = (src: LitSource): MeshToonMaterial => {
      const map = src.map ?? null;
      if (map) map.colorSpace = NoColorSpace;
      const hex = pickColor(mesh, src, palette);
      const mat = new MeshToonMaterial({
        name: `toon:${src.name}`,
        color: hex !== null ? new Color(hex) : (src.color?.clone() ?? new Color(0xffffff)),
        map,
        gradientMap: ramp,
        vertexColors: mesh.geometry.hasAttribute('color'),
      });
      created.push(mat);
      return mat;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => convert(m as LitSource))
      : convert(mesh.material as LitSource);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });
  return created;
};

/**
 * Smoothed normals for the ink hull (`outlineNormal` attribute): vertices that share a
 * position get the average of their normals, so hard-edged (split-normal) meshes still
 * extrude a closed shell and the outline never breaks at creases.
 */
export const bakeOutlineNormals = (geometry: BufferGeometry): void => {
  if (geometry.hasAttribute('outlineNormal')) return;
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  geometry.computeBoundingBox();
  const size = geometry.boundingBox ? geometry.boundingBox.getSize(new Vector3()).length() : 1;
  const q = 1 / Math.max(size * 1e-4, 1e-9);
  const sums = new Map<string, Vector3>();
  const keys: string[] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    keys[i] = key;
    let acc = sums.get(key);
    if (!acc) {
      acc = new Vector3();
      sums.set(key, acc);
    }
    acc.x += nrm.getX(i);
    acc.y += nrm.getY(i);
    acc.z += nrm.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n = sums.get(keys[i]) as Vector3;
    const len = n.length() || 1;
    out[i * 3] = n.x / len;
    out[i * 3 + 1] = n.y / len;
    out[i * 3 + 2] = n.z / len;
  }
  geometry.setAttribute('outlineNormal', new BufferAttribute(out, 3));
};
