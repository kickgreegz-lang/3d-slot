import type { ManifestEnv } from '../../../assets/manifest';

/**
 * Bass Drop environment art bound through the engine EnvArtKey slots (frame pieces, logo, the
 * base plates). Feature plates and neon layers are loaded by the game's own background module.
 * Rules: src/assets/manifest.ts. Never list a file that is not shipped.
 */
export const ENV_ART: ManifestEnv[] = [];
