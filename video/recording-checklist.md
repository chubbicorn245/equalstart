# Recording checklist: EqualStart 90-second video

This goes with the script in `SUBMISSION.md`. Record the narration **first**, then capture each shot below and cut it to the narration.

Every shot is recorded separately, so you can redo one without redoing the rest. Capture 2–3 seconds of still frame before and after every action; that gives you room to trim.

---

## 0. One-time setup (≈ 20 min)

- [ ] **Recording tool:** Screen Studio, or QuickTime plus an editor. In Screen Studio, turn on auto-zoom and cursor smoothing, and set the click effect to subtle.
- [ ] **Chrome:**
  - hide the bookmarks bar (⌘⇧B)
  - close all other tabs
  - set the window to 1280×800 or record at 1920×1080
  - set page zoom to 110%
- [ ] **macOS:**
  - turn on Do Not Disturb
  - hide desktop icons
  - set the menu-bar clock to hidden or not showing seconds
  - set dark mode on (the site follows the system theme and looks best dark)
- [ ] **Hard-refresh the site** (⌘⇧R) so you have the latest build. Confirm that https://equalstart.vercel.app/#/race plays the animation.
- [ ] **Phantom:** disconnect it from equalstart.vercel.app, or use a profile without it, for every shot except Shot 5. The header should show "Select Wallet" and no address.
- [ ] **Narration:** record it in one quiet take, about 90 seconds, then save it as `narration.wav`. Read slower than feels natural.

---

## Shot 1: The race, unfair half (0:00–0:10)

**URL:** https://equalstart.vercel.app/#/race

**Narration:** "Three people buy the same new token… Just for being first."

1. [ ] Load the page and wait until the animation finishes.
2. [ ] Start recording, wait 1 second, then press **R**. The animation replays from empty.
3. [ ] Let it play to the caption "Going first was worth 51% more tokens per SOL…" (about 5 s after pressing R).
4. [ ] Keep recording through the end of the animation. The same take supplies Shot 2.

**Zoom:** frame the chart and caption. The page title can be cropped out.

**Fallback:** the Veo "The line" clip, with captions added for 31.1M, 26.4M and 20.6M per SOL and "+51%".

## Shot 2: The race, fair half (0:10–0:16)

**Narration:** "EqualStart turns all three buys into one. Same price for everyone."

1. [ ] Use the second half of the Shot 1 take, from about 7 s after pressing R: the badge flips to "EqualStart batch" and the green bars rise to one level.
2. [ ] End on the caption "One price for everyone: 24.3M tokens per SOL each. Nobody went first." and hold it for at least 2 s.

**Fallback:** the Veo "Together" clip.

## Shot 3: Home hero (0:16–0:22)

**URL:** https://equalstart.vercel.app/#/

**Narration:** "On a real launch, first in line is usually a bot. We remove the line."

1. [ ] Scroll to the top.
2. [ ] Record 6 s without moving, then add a slow zoom on "Everyone gets the first price." in the editor.

## Shot 4: How it works (0:22–0:37)

**URL:** the home page, scrolled to "How it works" (or click the **How it works** button in the hero).

**Narration:** "Buyers deposit SOL… makes the whole batch its very first trade." (15 s)

Nothing here is clickable, and nothing needs to be. The "How it works" button in the hero only scrolls down. This shot is all framing plus slow cursor movement.

The section has two parts:
- **The numbered list** (1 Commit, 2 Deposit, 3 Settle, 4 Claim or refund).
- **The diagram below it:** a dashed outline titled "One transaction · signed only by the settler (any wallet)". Inside is the **green-bordered box**, "EqualStart `settle`", holding three small boxes numbered 1 create pool → 2 swap whole batch → 3 hand creator role.

1. [ ] Frame the numbered list plus the diagram.
2. [ ] Slowly move the cursor to each item as it's named, holding about 3 s on each:
   - list item 2, **Deposit**
   - small box 1, **create pool**, especially its "mint & creator are EqualStart PDAs" line
   - small box 2, **swap whole batch**
   - list item 3, **Settle**
3. [ ] Hold on the whole green box for the last 3 s, while "its very first trade" is said.

## Shot 5: Three wallets, one batch (0:37–0:45)

**Narration:** "Here it is live on devnet. Three wallets, three deposits, one batch."

This is the only shot that needs wallets. Choose one option.

**Option A, the best looking (≈ 30 min setup):**

Setup:
1. [ ] Create three Chrome profiles (Creator, Bob, Carol), each with Phantom set to that account and devnet (Testnet Mode).
2. [ ] In the Creator profile, open **New launch**, name the token "EqualStart Demo 2", and keep the defaults (10-minute deposit window). Approve the two transactions.
3. [ ] Open the new launch's page in all three profiles. Tile the windows side by side (Rectangle or macOS window tiling).

Recording (within the deposit window):
1. [ ] Click **Deposit** with 0.3, 0.2 and 0.1 SOL in turn.
2. [ ] Approve each deposit in Phantom.
3. [ ] Capture the progress bar filling in all three windows.

In the editor: speed the clip up 4×, and add captions "0.3 SOL", "0.2 SOL" and "0.1 SOL" above each window.

This also tests the live URL with Phantom, which the earlier run didn't cover. You don't need to settle this launch. If nobody settles it before its deadline, anyone can cancel it and the deposits come back.

**Option B, no wallets (5 min):**
1. [ ] Open https://equalstart.vercel.app/#/launch/BJDWdVWwgxrAjxabZdWXm2jyqkJwQBTAoduC2ToR5BXV.
2. [ ] Scroll slowly through the **Activity** feed, which shows the three deposits by three wallets, then the settle.
3. [ ] Change the narration to "Here's a live devnet launch: three wallets, three deposits, one batch."

## Shot 6: The proof, on Explorer (0:45–1:05). This is the climax.

**URL:** https://explorer.solana.com/tx/3UZ6nanjMmX5T651n5LAXMHB9rFjHyJaZw1pPUyXJjiUP2Y8Zfvst991EWU7htXvojPQpQXXr5vJTeE1HbmHPhEB?cluster=devnet

**Narration:** "This is Meteora's own bonding-curve program, the same one used on mainnet, not a mock. Settlement was signed by a wallet that never deposited… Nothing gets in between."

1. [ ] Before recording, load the page and wait until "Result: Success" shows. Then reload it so it's cached.
2. [ ] **Real Meteora, not a mock** (about 4 s, while "Meteora's own bonding-curve program… not a mock" is said): zoom on the Meteora DBC program address `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`.
   - Where to find it: in **Program Instruction Logs**, or in the account list, where Explorer may show it as "Meteora Dynamic Bonding Curve" or "Unknown Program (dbcij3…)".
   - Add the caption "Meteora DBC: same program ID as mainnet". The same address is Meteora's live mainnet program (checked 2026-10-11).
   - Optional: a 1 s cut to https://explorer.solana.com/address/dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN (no `?cluster` = mainnet) showing it's an executable program there.
3. [ ] **Overview** (about 2 s): zoom on **Result: Success**.
4. [ ] **Account Input(s)** (about 5 s): zoom on the row tagged **Fee Payer / Signer**, `715B3S…qVyF`. That's the Settler, which appears in no deposit.
   - Optional proof: a split-second cut to the launch page's allocation table, showing 715B… isn't listed.
5. [ ] **Program Instruction Logs** (about 7 s; scroll to the bottom of the page): this is the money shot. It shows the nesting:
   - `Instruction: Settle`, under our program. Explorer may label it "Unknown Program (6m6BSh…)"; caption it "EqualStart" in the editor.
   - inside it, `InitializeVirtualPoolWithSplToken` (pool created)
   - then `Swap2` (the batch buy)
   - then `TransferPoolCreator`

   Slowly highlight or zoom on those lines, top to bottom, as you say "the pool is born and the batch buys".

**Tip:** if the Explorer layout is too dense, zoom the browser to 125% for this shot only.

## Shot 7: Equal outcome (1:05–1:17)

**URL:** https://equalstart.vercel.app/#/launch/BJDWdVWwgxrAjxabZdWXm2jyqkJwQBTAoduC2ToR5BXV (no wallet connected)

**Narration:** "Each wallet's share of the tokens matches its share of the SOL… full refund."

1. [ ] Hold 2 s on the top section: the green "Settled" card, 0.6 SOL raised, and 19,453,341 EQUAL bought.
2. [ ] Scroll to **Allocation**: the colored bar, then the table with 50% / 33.33% / 16.67% and every row **claimed**.
3. [ ] Drift the cursor across the shares column while "matches its share of the SOL" is said.

## Shot 8: Honest close (1:17–1:30)

**Narration:** "Every transaction, including rejected attacks… everyone gets the first price."

1. [ ] Open https://github.com/chubbicorn245/equalstart/blob/main/VERIFICATION.md.
2. [ ] Scroll slowly through the attack table, where the ❌ rejected rows are visible, for about 5 s.
3. [ ] Cut to the end card, built in the editor:
   - the green "=" logo (you can screenshot it from the site header)
   - **EqualStart**
   - "Everyone gets the first price."
   - `equalstart.vercel.app` and `github.com/chubbicorn245/equalstart`
4. [ ] Hold the end card for 4 s.

---

## Edit pass

- [ ] Lay down the narration first, then trim each shot to its slot. The time ranges are approximate.
- [ ] **Burn-in captions:** CapCut does auto-captions. Fix "EqualStart", "Meteora" and "DBC" by hand.
- [ ] **Music** at about −25 dB under the voice. Fade it out over the last 2 s.
- [ ] **Text overlays:**
  - Shot 1: "+51% for going first"
  - Shot 6: "Meteora DBC: same program ID as mainnet", "Signer: never deposited" and "1 instruction: create pool → buy"
- [ ] **Final length:** 85–90 s, and never over 90.
- [ ] **Watch it on mute.** It must make sense from the captions alone.
- [ ] **Export:** 1080p MP4. Upload to YouTube as Unlisted, or to Loom. Check that the link plays in a logged-out window, then paste it into `[VIDEO]` in `submission-form.md`.
