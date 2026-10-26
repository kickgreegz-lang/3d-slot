# Magpie Heist: style decision (2026-10-26)

**Decision.** Foreground art (symbols, wild, loot, mascot, emblems) uses **formula M** — the agreed formula D's outline-and-light rules pushed toward a modern cartoon finish (the brief asked for cartoonish, Hacksaw/Paperclip-quality art). Backgrounds use the **painted cartoon environment** formula. Both are stored in `art/bible/artbible.json` → `magpieHeist` (`styleFormula`, `environmentFormula`) and passed to every Magpie Heist prompt as `--var STYLE_FORMULA=…`.

## Probe (batch `mh_probe1`, Nano Banana Pro on Higgsfield, 14 credits)

| Job | Formula | Result |
|---|---|---|
| H1 crown | D (verbatim) | Clean single-weight outline, glossy gold, pearls and gems readable at cell size. Already cartoon enough to sit with M. **Adopted as the H1 anchor.** |
| H1 crown | M | Not generated (rejected by the account's daily limit). |
| W bandit mask over a blank banner | M | Chunky glossy satin, thin gold trim, clean key. **Adopted** (WILD stays live text on the banner). |
| R shooting star | M | Plump bevelled star with a violet / teal / white ribbon tail; strong silhouette. **Adopted.** |
| Monty design sheet (4 views) | M | Appealing, adult-proportioned (head < ¼ of height), sly grin, on-brief wardrobe. The black domino mask disappears into his black head: the next sheet / rig master asks for the mask's thin **gold trim** (the W mask's trim). **Adopted** as the identity reference and the rig master (three-quarter view). |
| Base plate (21:9 4K) | painted environment | AAA museum hall: moon window + curtain left, half-open vault right, dome skylight with lasers, calm darker centre. One defect: a **slot machine** was painted bottom centre (the template's "seen from behind the slot reels"). Adopted with a clean-up edit planned (`background.txt#G`, batch `mh_c02`). |

## Formula M (foreground, verbatim)

> Premium cartoon slot-game art in a polished modern animated-feature style: a bold, clean, confident single-weight black outline around every shape and thinner dark interior lines; exaggerated chunky, rounded, playful shapes with strong readable silhouettes; vibrant saturated jewel-tone colours with smooth soft-gradient cel shading, a strong key light from the upper left, a warm bounce light and a thin cool rim light, glossy lacquered highlights and crisp white specular hotspots; clean graphic surface detail that stays readable at small size; polished and expensive-looking; adult characters.

## Painted environment (backgrounds, verbatim)

> Hand-painted premium cartoon slot-game environment, painterly soft brushwork with clean graphic shapes, atmospheric perspective with softer and bluer detail in the distance, deep midnight-indigo and moonlit-teal night palette with warm gold lamp accents and crimson velvet, cinematic moonlight, high detail at the edges.

## Brief rules learned

- Never name the reference game or its studio (added to `tools/gen/forbidden-words.json`), and never put game or feature titles in prompts (they would be painted as letters).
- "Seen from behind the slot reels" can paint a slot machine: plates need the clean-up edit or a different framing line.
- A black mask on a black head needs a contrasting trim.
- Key colours: `#00FF00` for symbols and loot without green; `#FF00FF` for Monty (blue / teal / green plumage) and the diamond; the matte measures the real key (`--key auto`). Monty's plum cap and crimson scarf trip the halo gate's key-hue test on genuine colours: checked on navy, no spill; the override is recorded on the row.

## Licence note

Higgsfield outputs build and preview; they ship only after the written clearance (`licenses/allowlist.json` → `higgsfield`, `clearance: pending`). `pnpm licence:audit` warns in dev and `--release` refuses.
