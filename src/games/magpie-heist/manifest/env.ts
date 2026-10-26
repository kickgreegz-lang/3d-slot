import type { ManifestEnv } from '../../../assets/manifest';

/**
 * Magpie Heist environment art bound through the engine EnvArtKey slots (none yet: the gilded frame
 * is the game's own scene/Frame.ts, the plates load in scene/Background.ts). Never list a file that
 * is not shipped.
 */
export const ENV_ART: ManifestEnv[] = [];
