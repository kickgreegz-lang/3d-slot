# Bass Drop: style decision (2026-09-26)

**Decision:** foreground art (symbols, wild, props, emblems, mascots) uses **formula D** below. It
replaces the flat-cel `artbible.styleFormula` for Bass Drop production. Backgrounds use the
**painted environment** formula. Apply both to `art/bible/artbible.json` before the production batch,
then re-render every planned prompt (the plan's `promptHash` values change).

## Why

Three A/B rounds on Higgsfield Nano Banana Pro (`nano_banana_pro`, 2K symbols, 4K sheets and plates;
jobs in `art/ledger/`, batches `probe1`, `ab1`, `ab2`):

| Round | Formula | Result |
|---|---|---|
| probe1 | A: current bible (flat cel, "no soft gradients", plum extrusion) | Clean but flat, mobile clip-art level; well below the Dragonspire reference. "Plum extrusion" was drawn as a literal stick or tab poking out of H1 and H2. Croak came out as a naked frog that reads like a well-known meme frog (IP and brand-safety risk). The background came out as a flat TV-cartoon. |
| ab1 | B: glossy cel with soft gradients | Much richer. "Molten gold" drew dripping gold. The W tooth read as a pickle. Croak v2 (new brief below) is distinctive and on-brand. |
| ab1 | C: hand-painted, rim + bounce light | The most premium symbols (boombox, crawfish in a vest, readable fang), but a sketchy double outline. |
| ab1 | Painted environment (background) | AAA-grade juke joint: atmospheric depth, stage with speaker stacks in the back, calm dark centre for the reels. Adopted. |
| ab2 | **D: clean single-weight outline + painterly rendering** | Best of both: reads at cell size, premium finish, consistent between symbols and characters (Gumbo D sheet). **Adopted.** |

The reference target is the Dragonspire Frostfall demo's finish: bold outlines, rich gradient
rendering, glossy highlights, painterly atmospheric backgrounds. We match the finish, never its
identity: no dragons, no ice, no frame designs, no names.

## Formula D (foreground, verbatim)

> Premium hand-painted slot-game art with a clean, confident, single-weight bold black outline around every shape and thinner dark interior lines. Rich painterly rendering inside the lines: smooth layered shading with soft gradients, saturated jewel-tone colours, strong key light from the upper left with a warm bounce light and a thin cool rim light, glossy lacquered highlights and crisp white specular hotspots, fine surface detail that stays readable at small size. Chunky, rounded, heroic proportions with clear three-dimensional volume; polished and expensive-looking; adult characters.

## Painted environment formula (backgrounds, verbatim)

> Hand-painted premium slot-game environment, painterly soft brushwork, atmospheric perspective with softer and bluer detail in the distance, rich violet-indigo and teal night palette with warm amber and magenta neon accents, cinematic lighting, high detail at the edges.

Plus the background suffix: no characters, no UI, no text or readable signage; the central 60% is
calmer, darker and lower in detail; the brightest neon masses are at the far left and far right edges.

## Brief rules learned

- **Never write "extrusion" or "molten".** "Extrusion" draws a separate object, and "molten" draws drips. Say "polished solid gold". Any depth edge comes from the rendering, or is added in post by the matte step if the art director still wants it.
- **Key colour is not guaranteed.** One D symbol (H1) came back on olive instead of `#00FF00`. The matte step must measure the real background from the corners (a uniform-background check) and key on that, or regenerate. It must never assume the requested hex.
- **Croak brief (v2, adopted):** lanky adult bullfrog DJ with a broad flat head and a very wide confident grin; big bulging golden eyes with narrow horizontal pupils set high on the head; a large inflatable throat pouch; mottled dark olive skin with a pale yellow belly and hot-pink toe pads. He wears a flat-brim cap backwards, an open hot-pink bowling shirt with a black lightning pattern over a black tank top, baggy black cargo shorts, big over-ear headphones around the neck, and a heavy gold chain with a vinyl-record pendant. Avoid droopy half-lidded eyes combined with thick lips (meme-frog read).
- **Gumbo brief (D, adopted):** heavyset adult alligator bouncer with a broad long snout, one gold tooth and a toothpick, and heavy-lidded unimpressed yellow eyes. He has a dark olive-green scaly hide and a pale khaki belly, and wears a tight maroon tank top, dark blue work jeans and black rubber boots. His tail is visible. In the front view his arms are crossed and a red cooler with a white lid stands beside him.
- **W brief (D, adopted):** one big curved alligator fang with a polished gold cap and a short gold chain loop, and teal enamel inlay on the fang. The word WILD stays live text on the runtime badge.
- **H3 brief (D, adopted):** adult-proportioned crawfish with a red-orange shell, a sleeveless denim vest and a swaggering attitude: big claws raised, two long antennae, confident smirk.

## Licence note

Higgsfield outputs can be built and previewed. They ship only after the written clearance (see
`licenses/allowlist.json` → `higgsfield`, and docs/STACK.md "Image route"). The release licence
audit enforces this.
