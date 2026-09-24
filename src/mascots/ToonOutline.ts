import {
  BackSide,
  type Camera,
  Color,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { TOON } from './toon';

/**
 * Inverted-hull ink outline with a constant on-screen width.
 *
 * Same technique and call shape as three's OutlineEffect (`render(scene, cam)` draws
 * the scene, then a BackSide hull pass), with the defects that matter for a cel-art
 * slot fixed:
 *  - the hull is inflated in VIEW space along the normal, scaled by depth, so the ink is
 *    a constant number of render-target pixels at the silhouette and isotropic on a
 *    non-square target (OutlineEffect's clip-space offset is ~1.5x thinner horizontally
 *    on a 2:3 RT and flips thin back-facing triangles, which punches holes in the line);
 *  - it extrudes along `outlineNormal` (smoothed, see bakeOutlineNormals), so hard-edged
 *    meshes don't crack open at creases;
 *  - it is independent of the model's unit scale (GLBs exported at 100x still work).
 * Skinning and morph targets are supported through three's standard shader chunks.
 * One override material per mascot; no per-frame material swapping or allocation.
 */
const vertexShader = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
attribute vec3 outlineNormal;
uniform float inkWidth;
void main() {
  vec3 objectNormal = outlineNormal;
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  // inflate by inkWidth * depth: a constant pixel width where the normal is side-on
  vec3 viewNormal = normalize( normalMatrix * objectNormal );
  mvPosition.xyz += viewNormal * ( inkWidth * -mvPosition.z );
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 inkColor;
void main() {
  gl_FragColor = vec4( inkColor, 1.0 );
}
`;

export class ToonOutline {
  readonly material: ShaderMaterial;

  constructor(color: number = TOON.ink) {
    this.material = new ShaderMaterial({
      name: 'toon-ink',
      uniforms: {
        inkWidth: { value: 0 },
        inkColor: { value: new Color(color) },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
    });
  }

  /** Outline width in render-target pixels for a target `rtHeight` px tall seen by `camera`. */
  setWidth(px: number, rtHeight: number, camera: PerspectiveCamera): void {
    // view-space size of one pixel at depth 1 = 2 / (rtHeight * P[1][1])
    this.material.uniforms.inkWidth.value = (2 * px) / (rtHeight * camera.projectionMatrix.elements[5]);
  }

  /**
   * Draw `scene` then its ink hull into the current render target (caller clears).
   * `skip` objects (eye glints) are hidden during the hull pass.
   */
  render(three: WebGLRenderer, scene: Scene, camera: Camera, skip: readonly Object3D[] = []): void {
    three.render(scene, camera);
    for (const o of skip) o.visible = false;
    scene.overrideMaterial = this.material;
    three.render(scene, camera);
    scene.overrideMaterial = null;
    for (const o of skip) o.visible = true;
  }

  dispose(): void {
    this.material.dispose();
  }
}
