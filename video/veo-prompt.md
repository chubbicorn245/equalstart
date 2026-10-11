# Prompt for Google Veo (Flow or the Gemini app)

**What this is for:** a 16-second animated opener for the EqualStart video (script slots 0:00–0:16). It replaces or intercuts with the screen recording of `#/race`.

**Before generating:**
- Veo makes clips of about 8 seconds, so generate the two shots separately and join them in your editor.
- Veo garbles on-screen text and numbers, so the prompts ask for **no text at all**. Add the labels ("31.1M / SOL", "24.3M each", the names) as captions in the editor. Those numbers are measured; the AI's would not be.
- Turn audio off, or ask for "no dialogue". Your narration goes on top.
- The shots use equal-sized buyers to make the per-SOL point simply; the real measurement (unequal deposits) is in the race and the captions.
- Paste the **Style block** at the start of each shot prompt so both shots match.

---

## Style block (paste first, in both prompts)

> Minimalist 2D motion-graphics animation, flat vector shapes, clean geometric style like a premium fintech explainer. Dark charcoal background (#121311) with a very subtle vignette. Two colors only: warm amber (#E2A64A) for "the old way" and mint green (#5FB98A) for "the fair way", plus soft off-white (#ECEBE6) for small details. Smooth eased motion with gentle overshoot, no camera shake, locked-off camera with a slow push-in. 16:9, 1080p, 24fps. Absolutely no text, letters, numbers, logos or UI anywhere in the frame. No people's faces: characters are simple rounded geometric tokens. Calm, confident, modern. No dialogue; soft minimal electronic pulse only.

## Shot 1: "The line" (8 seconds)

> [Style block]
>
> A single glowing amber bonding curve sweeps across the frame from lower left to upper right, like a gently rising staircase ramp. At the start of the curve stands a small queue of three identical rounded geometric characters, each holding one identical glowing coin to spend. They are simple soft-cornered capsules, not people.
>
> 0–1s: a sleek, sharp-edged angular shape (a "bot") darts in from off-screen and cuts to the very front of the queue.
>
> 1–5s: one by one, each character steps onto the curve and is lifted up it. Each step lands noticeably higher than the last, and a small amber spark burst marks each landing. The first character receives a big shower of small coins. The second receives fewer. The third, highest on the curve, receives visibly the fewest coins. The coins pile beside each character so the difference is obvious.
>
> 5–8s: the camera slowly pushes in on the three uneven coin piles: large, medium, small, even though all three paid the same. The amber light dims slightly, a feeling of unfairness. Hold the final frame still for the last second.

## Shot 2: "Together" (8 seconds)

> [Style block]
>
> Same dark scene and the same rising curve, now drawn in faint dashed amber as a ghost of before.
>
> 0–2s: the three identical rounded characters stand side by side at the very bottom of the curve. Each drops a glowing droplet into one shared translucent mint-green vessel in the center, which fills with light.
>
> 2–4s: the vessel seals and rises as one single solid mint-green block. It lands at the very start of the curve in one unified motion, with one clean green pulse ring. Nothing gets in front of it; the angular bot shape bumps against the block's edge and slides away harmlessly.
>
> 4–7s: the green block splits into three identical vertical slices, one per character. Every slice's top edge sits at exactly the same height: a perfectly level line glows across them. Coins pour out into three identical piles.
>
> 7–8s: the level green line brightens and holds. The scene settles, balanced and calm. Hold still on the final frame.

---

## If a shot comes out wrong, regenerate with these fixes

| Problem | Add to the prompt |
|---|---|
| Text or numbers appear | "The frame contains zero typography. Remove all text, digits, labels, captions and signage." |
| The characters look like people or have faces | "Characters are abstract capsules with no eyes, mouths or limbs." |
| Shot 2's slices or piles aren't equal | "The three slices and the three coin piles are exactly identical in size and height." |
| Too busy | "Fewer elements, more negative space, slower motion." |

## Gemini Canvas alternative

To have Gemini build an interactive version in code instead, paste this:

> "Build a single-file HTML/SVG animation (no libraries), 16:9, dark background #121311, which loops every 12 seconds:
> 1. Three amber (#E2A64A) bars appear one after another, labelled 'Alice 2 SOL: 31.1M per SOL', 'Bob 4 SOL: 26.4M per SOL' and 'Carol 6 SOL: 20.6M per SOL'. Bar width is proportional to SOL and height to tokens per SOL, on a zero baseline.
> 2. Show the caption 'Going first = 51% more tokens per SOL'.
> 3. The amber bars fade to dashed outlines, and three mint (#5FB98A) bars rise to one shared level at 24.3M per SOL each, with the caption 'EqualStart: one price for everyone'.
>
> Use eased transitions and a large, legible sans-serif. Add a replay button."

These numbers are the real measurements from `app/src/lib/comparison.json` (12 SOL scenario), so the labels are safe to show.
