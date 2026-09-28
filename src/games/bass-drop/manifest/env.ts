import type { ManifestEnv } from '../../../assets/manifest';

/**
 * Bass Drop environment art bound through the engine EnvArtKey slots: the formula-D painted cypress
 * frame (art/source/ui/bass-drop/frame + frame.json, tools/frame/build_frame.py). The Frame module
 * (swamp-funk/scene/Frame.ts prodPart) draws each piece as a 3-slice (20% fixed ends, thickness fitted
 * uniformly); `@2x` = loaded at resolution 2, so the landscape pieces draw unstretched. A missing key
 * falls back to the procedural wood, per piece. The neon tube and the panel glass stay code.
 *
 * Not listed here on purpose (loaded by the game's own scene modules, see ../scene/):
 *  - the plates + additive neon layers (base / Juke Jam / Mega Mix, landscape + portrait): scene/Background.ts
 *    loads only the orientation and look on screen, so a phone never holds the other set;
 *  - the logo crest: scene/Logo.ts composes it with the live SWAMP FUNK / BASS DROP word-mark.
 * Rules: src/assets/manifest.ts. Never list a file that is not shipped (tools/licence/ship.py ships them,
 * spec tools/licence/ship/bass_drop_env.json).
 */
export const ENV_ART: ManifestEnv[] = [
  { key: 'frame_beam', src: './assets/bass-drop/frame/frame_beam@2x.webp' },
  { key: 'frame_post', src: './assets/bass-drop/frame/frame_post@2x.webp' },
  { key: 'frame_sill', src: './assets/bass-drop/frame/frame_sill@2x.webp' },
];
