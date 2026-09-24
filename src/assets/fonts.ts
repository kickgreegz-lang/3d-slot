/**
 * Self-hosted fonts (Stake Engine forbids external requests). Loaded with the
 * FontFace API before any Pixi Text/BitmapText is created.
 *  - Lilita One  : royals, multiplier spot numbers, cluster labels
 *  - Titan One   : HUD values, counters
 *  - Luckiest Guy: big-win titles, free-spin banners
 *  - Bebas Neue / Anton: HUD labels, menus
 */
export const FONTS = {
  royal: 'Lilita One',
  value: 'Titan One',
  title: 'Luckiest Guy',
  label: 'Bebas Neue',
  labelHeavy: 'Anton',
} as const;

const FILES: Record<string, string> = {
  'Lilita One': 'LilitaOne-Regular.woff2',
  'Titan One': 'TitanOne-Regular.woff2',
  'Luckiest Guy': 'LuckiestGuy-Regular.woff2',
  'Bebas Neue': 'BebasNeue-Regular.woff2',
  Anton: 'Anton-Regular.woff2',
};

export const loadFonts = async (base = './assets/fonts/'): Promise<void> => {
  await Promise.all(
    Object.entries(FILES).map(async ([family, file]) => {
      const face = new FontFace(family, `url(${base}${file}) format("woff2")`);
      await face.load();
      document.fonts.add(face);
    }),
  );
};
