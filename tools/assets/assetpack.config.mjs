// AssetPack 1.7.0 config for SWAMP FUNK (ported from the research prototype, tested; see README.md).
//   npx assetpack -c tools/assets/assetpack.config.mjs          (defaults below)
//   node tools/assets/pack.mjs [--entry DIR --output DIR]        (same config + gates + provenance)
//
// Input  build/pack/            written only by scripts (tools/matte, tools/video/flipbook.py, tools/audio)
// Output public/assets/pack/    AssetPack DELETES its output folder on a cold cache, so it owns this
//                               folder alone (fonts, spine exports and GLBs live next to it, untouched).
// Folder tags: {tps} = pack the folder into a spritesheet (ONE folder per animation clip; frames
// <clip>_0001.png ... become animations.<clip>), {m} = manifest bundle, {nomip} = no @0.5x variant,
// {fix} = only the default resolution, {jpg} = jpg atlas, {mIgnore} = copy but keep out of the manifest.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pixiPipes } from '@assetpack/core/pixi';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @param {object} o
 * @param {string} [o.entry]          raw-assets root (default build/pack)
 * @param {string} [o.output]         output root (default public/assets/pack)
 * @param {string} [o.cacheLocation]  default build/.assetpack-cache
 * @param {boolean} [o.cache]         default true
 * @param {boolean} [o.cacheBust]     hashed file names; default false: Stake versions the whole build
 *                                    path, and src/assets/manifest.ts lists stable names
 */
export function makeConfig({
  entry = path.join(REPO, 'build/pack'),
  output = path.join(REPO, 'public/assets/pack'),
  cacheLocation = path.join(REPO, 'build/.assetpack-cache'),
  cache = true,
  cacheBust = false,
} = {}) {
  return {
    entry,
    output,
    cache,
    cacheLocation,
    strict: true, // any broken asset fails the build
    ignore: ['**/*.psd', '**/*.blend', '**/*.spine', '**/_src/**', '**/*.manifest.json', '**/qa/**', '**/.DS_Store'],
    assetSettings: [
      // symbol statics are single frames: sym_H1..sym_H4 must not become an 'animation' sym_H
      { files: ['symbols*', '**/symbols*'], settings: { 'texture-packer': { texturePacker: { autodetectAnimations: false } } } },
    ],
    pipes: [
      ...pixiPipes({
        cacheBust,
        // art is authored at the shipped size (symbols: the 360 @2x canvas): that IS the default
        // resolution; low-tier devices get an exact @0.5x (frames are multiples of 8 px)
        resolutions: { default: 1, low: 0.5 },
        compression: {
          png: { quality: 90 },                    // palette PNG: often smaller than WebP on flat cel art
          webp: { quality: 88, alphaQuality: 95 },
          jpg: false,
          avif: false,
        },
        texturePacker: {
          texturePacker: {
            nameStyle: 'short',
            removeFileExtension: true,
            padding: 4,             // multiples of 4 keep pages block-aligned for a later KTX2 switch
            allowRotation: false,
            allowTrim: false,       // flipbook.py already trims clips uniformly around the pivot
          },
          resolutionOptions: { maximumTextureSize: 2048 },   // bigger sheets split into multi-packs
        },
        // audio is mastered and encoded by tools/audio/master.sh (.webm Opus + .m4a AAC); AssetPack's
        // bundled 2018 ffmpeg must not touch it: no input extension matches, files are copied as-is
        audio: { inputs: ['.assetpack-audio-disabled'] },
        // manifest.json lands in the output root; every src is relative to it, so the runtime uses
        // Assets.init({ basePath: './assets/pack/', manifest })
        manifest: { output: 'manifest.json', createShortcuts: true, trimExtensions: true, includeFileSizes: false },
      }),
    ],
  };
}

export default makeConfig();
