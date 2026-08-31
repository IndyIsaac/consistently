# Demo video prep

State of play on `demo-video-prep`, and the questions that have to be answered before the next
piece can be built. Written to be picked up cold on another machine.

---

## What works right now

```bash
npm install
npx prisma generate              # npm 11 skips it; the app will not run without it
npx playwright install chromium  # the browser is not in node_modules
npm run capture -- --serve
```

All three of the first lines are needed on a fresh clone. `prisma generate` and the Chromium
download are the two that are easy to forget and fail loudly rather than usefully.

One command, about ninety seconds, no interaction. It starts its own `next dev`, drives a real
Chromium through the product, records, and kills the server behind it. Last run: **17 beats, 0
scenes failed.**

Output lands in `docs/demo/raw/`, which is gitignored — it is regenerated, never committed:

| | |
|---|---|
| `video.webm` | one continuous take, 1206×2622 |
| `01–17-*.png` | a still at every beat, same resolution |
| `beats.md` / `beats.json` | every beat with its millisecond offset into the video |

`beats.md` is the point of the whole thing. Playwright cannot cut a video into scenes, so instead
every beat stamps the clock — the edit sheet says *the refusal lands at 0:45.4* rather than making
you scrub for it.

### Useful flags

```bash
npm run capture -- --serve --only=checkin      # one scene, while iterating
npm run capture -- --serve --headed            # watch it drive
npm run capture -- --base-url=http://localhost:3000   # against a server you already have
npm run capture -- --serve --scale=2           # smaller take
```

Scene names: `door`, `dashboard`, `groups`, `channel`, `checkin`, `exemption`, `settings`.

---

## What it captures

Front door → START → email → six digits → dashboard → groups → the channel → `/help`, `/crew`,
`/stake` → **check in with a photo (09:13) → check out too early, refused with
*"That's 10 minutes. The pact says 30. Twenty to go."* (09:23) → check out accepted, 39 minutes,
streak 3 of 5 → 4 of 5** → vote on Dave's exemption → settings.

All of it on the zero-environment path. No wallet, no mainnet, no database, no seeding: with no
`NEXT_PUBLIC_PRIVY_APP_ID` the door takes any six digits, and `lib/session.ts` serves
`lib/mock-session.ts`.

**It contains none of DFlow.** No stake sheet, no `/settle`, no swap. See the open questions.

---

## Four things that bite, written down so they do not bite twice

**The mock clock drifts, and fast.** `MOCK_MS_PER_MINUTE = 1_000` — one real second is a mock
minute. A dev server up twenty minutes is a full day past the Friday the demo was composed for, and
`GYM_RULE`'s window closes at 22:00, after which check-ins are refused for being outside it. The
first take came out stamped 19:12. This is why the script starts its own server rather than reusing
a running one; it is the only way to get the same take twice. **Do not capture against a server
that has been up a while.**

**The browser timezone matters.** Every mock timestamp is composed against Asia/Bangkok and the
channel renders in the browser's zone, so filmed from anywhere else the demo is set at the wrong
time of day. Pinned in the context options.

**Check-in needs a blob store.** `/api/uploads` answers 503 without `BLOB_READ_WRITE_TOKEN`, and
`lib/bot.ts` correctly refuses: *"a check-in without a photo is not a check-in, so nothing was
recorded."* The capture script stubs that one request with an image the app already serves
(`public/mock/checkin-rack.jpg`). Nothing else is faked — the session arithmetic, the refusal and
the channel photo all run their own code.

**Next's dev overlay is in shot** as a red "1 Issue" pill over the nav, and it must be hidden with
a stylesheet applied *after load*. Doing it through `addInitScript` injects a script tag into the
document React is about to hydrate, hydration fails, and the badge lights up reporting it.

---

## The bug this turned up

`Channel.capture()` catches `ChannelError` and says the message. The mock path threw
`MockSessionGuardError`, a different class, so it fell through to `throw e` — **the early-checkout
refusal never reached the channel.** You checked out early and were shown nothing.

That is the moment `PRODUCT.md` calls the point of the product ("finding out immediately is the
point"), and it was broken in exactly the mode the demo runs in. The live path was always fine:
`send` turns a 400 into a `ChannelError`.

Fixed in `lib/channel-client.ts` with a `viaMock` wrapper that translates the mock's guard errors at
the seam — which is where that file's own note 2 says the line belongs. Applies to all five mock
branches, not just check-out.

---

## Known, not fixed

A dev-only hydration warning from the inline theme-boot script at `app/layout.tsx:47`. It is
deliberate — it settles the theme before hydration so there is no flash — it only warns in dev, and
the overlay is hidden so it stays out of the take. Left alone.

`npm test` shows 44 failures, all `PrismaClientInitializationError` / missing `DATABASE_URL` and
`VAULT_ENCRYPTION_KEY`. Pre-existing, environment-only, nothing to do with the above.
`npx tsc --noEmit` is clean and `lib/__tests__/bot.test.ts` passes 38/38.

---

## Open questions — answer these and the next piece can be built

### The one that blocks everything

**Does the video show money actually moving?**

The behaviour loop captures perfectly with zero setup. The DFlow money path needs real
credentials — `SOLANA_RPC_URL`, `SPONSOR_SECRET_KEY` with SOL in it, `DFLOW_API_KEY`,
`VAULT_ENCRYPTION_KEY`. Given the brief is *"build what happens after the swap,"* this decides
whether the demo has a second act at all.

- [ ] **Real mainnet** — the actual thing, actual money, unrepeatable takes
- [ ] **`STAKE_DRY_RUN=1`** — whole path priced, signed, sponsor co-signed, guard-checked and
      simulated against live mainnet, never broadcast. Costs nothing; `scripts/rehearse.ts` exists
      for it already
- [ ] **Mock only** — extend `lib/mock-session.ts` to draw a stake sheet and a settlement, narrate
      the DFlow part over it. Honest, but it is a drawing
- [ ] **Skip it** — behaviour loop only, DFlow explained in the README

**Which credentials do you actually have to hand?**

### The rest

1. **Who is watching, and where?** Buildathon judges, DFlow's team, a landing page?
2. **Length?** 60s / 90s / 3min. The real constraint — it decides how many beats survive.
3. **The one sentence they should believe at the end.**
4. **Star of the show** — the behaviour loop, or the money path? Both is usually neither.
5. **What gets said out loud?** `PRODUCT.md` is explicit that the partial auth and the server-held
   vault are to be *"disclosed rather than glossed."* In the video, or the README only?
6. **Voice or captions?** Narrated, or silent with text over it?

Then list the beats you want, in order, in plain language. That is enough — it turns into scenes,
and a beat sheet comes back for approval before anything is shot.

---

## Then

- Extend `SCENES` in `scripts/capture-demo.ts` with whatever the answers add — the stake sheet, the
  invite QR, `/settle`, a dark-mode pass.
- Take `docs/demo/raw/video.webm` into an editor for zooms, a device mockup and a background.

  The editor picked was **OpenVid**. The hosted one at openvid.dev needs nothing. To run it
  locally it has to be cloned separately — it is not part of this repo and does not arrive with a
  pull:

  ```bash
  git clone https://github.com/CristianOlivera1/openvid.git
  cd openvid && pnpm install
  cp .env.example .env      # then see below
  pnpm dev --port 3001      # 3001, so `next dev` here keeps 3000
  ```

  It will not boot without Supabase values: `utils/supabase/{client,server,middleware}.ts` each
  throw at module load, and `proxy.ts` imports the middleware one, so every route 500s. Nothing on
  the anonymous editor path actually calls Supabase, so URL-shaped placeholders are enough —
  `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co` and any non-empty anon key. The
  Unsplash/Pexels/Pixabay keys are genuinely optional; blank just empties those three background
  pickers. Editor lives at `/en/editor`.

  Its licence is **PolyForm Noncommercial 1.0.0**, which restricts use of the software — not the
  video made with it — and a commercial pitch sits in a grey area. Worth a decision, not a
  surprise.
- Do not bake a device frame into the capture. The editor adds one, and a frame in the footage
  cannot be taken out again.
