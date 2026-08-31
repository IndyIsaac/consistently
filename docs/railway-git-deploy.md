# Migrating Railway from `railway up` to a git-connected deploy

Status: **plan only, nothing executed.** Read-only investigation performed against
Railway project `dflow` (project ID `3e59d4f7-dd0f-45c8-a0c6-8c147d6f68d6`), service
`web` (`9c0348c8-d1eb-42c5-9837-0439ac6166f2`), in both the `production` and
`rehearsal` environments, plus the local repo state in this worktree, on
2026-08-31 between roughly 16:05 and 16:25 UTC.

## Important update to the situation as briefed

The brief this plan was requested against said "PR #1 is open and unmerged" and
told the reader not to connect Railway to `main` until it merges. **That precondition
already changed during this investigation**: `gh pr view 1` shows PR #1
(`namearth5005/buildathon-demo` → `main`) was merged at `2026-08-31T15:00:46Z` by
`namearth5005`, merge commit `a621463`. `origin/main` now contains the app.

That does **not** mean it's safe to connect yet. Three things still stand between
here and a safe cutover:

1. **This worktree's branch is 4 commits ahead of the now-updated `origin/main`**,
   all real auth bug fixes made after the merge (see "Uncommitted / unmerged drift"
   below). None of them are on `main` yet.
2. **There are uncommitted changes in this worktree** that a git deploy would never
   see.
3. **Production is being actively deployed to via `railway up` right now.** While
   investigating I observed two live deployments in `BUILDING` status
   (`015105c8…`, started 16:17:38Z, and `d4df3128…`, started 16:17:08Z), on top of a
   `SUCCESS` deploy at 15:48–15:50Z and two `REMOVED` deploys before that at
   15:19Z and 15:42Z. Someone (not this investigation — no deploy command was run
   here) is actively shipping via CLI; a `worktree-contention-guard` also flagged
   another live session sharing this exact checkout, which is almost certainly who.
   Any cutover plan has to assume the target commit for `main` is a moving target
   until whoever is deploying says they're done for the night.

Do not treat "PR #1 merged" as the green light by itself. The actual precondition
is **"main == what's currently live in production, including tonight's later CLI
deploys, with nothing merged that hasn't been through `railway up` on rehearsal or
production first."**

## Precondition checklist (must all be true before connecting Railway to `main`)

- [ ] All CLI deploys anyone is going to do tonight are done. Confirm with whoever
      is running `railway up` that they're finished.
- [ ] The 4 commits currently only in this worktree/branch
      (`394737e`, `8999c7f`, `c34da5e`, `e110bc2` — see below) are pushed and merged
      to `main` via a PR, the same way PR #1 was.
- [ ] The two uncommitted working-tree changes below are either committed and merged,
      or deliberately discarded because they were only local experiments:
      - `app/(app)/dashboard/page.tsx` (modified, unstaged)
      - `scripts/sweep-vault.ts` (new, untracked)
- [ ] `origin/main` HEAD, once all of the above lands, is deployed once more via
      `railway up` and confirmed healthy. This becomes the exact commit Railway's
      git integration will build when you connect it — verify it's right *before*
      connecting, not after.
- [ ] Env parity table below is satisfied in both environments.

## What a git deploy would change here — investigation findings

### 1. Build configuration

No `railway.json`, `railway.toml`, `nixpacks.toml`, `Dockerfile`, or `Procfile`
exists in the repo. Railway's service config (read via `get-service-config` on both
environments) shows:

```
build.builder = "RAILPACK"     (Railway's current default builder, successor to Nixpacks)
build.buildEnvironment = "V3"
deploy.preDeployCommand = ["npx prisma db push"]
deploy.runtime = "V2"
```

No `buildCommand` or `startCommand` override is set — Railpack auto-detects the
Next.js app from `package.json` (`"build": "next build"`, `"start": "next start"`)
the same way it would under a git-triggered build. **This part is source-agnostic:
switching from `railway up` to a git build does not change the build or start
command**, because neither is defined by anything `railway up` uploads that a git
checkout wouldn't also have (`package.json` is committed).

### 2. The Prisma `db push` step — the risk called out in the brief

This is configured as a **service-level `preDeployCommand`** in Railway itself
(`npx prisma db push`), not as a script invoked from `package.json`'s `build` or
`start`, and not baked into a Dockerfile. It runs as a distinct pipeline stage after
build, before the new deployment takes traffic, regardless of whether the build
was triggered by `railway up` or by a git push. **Verified in both `production`
and `rehearsal` service configs — identical `preDeployCommand` in each.**

Conclusion: **connecting git deploy will not change whether `prisma db push` runs.**
This is the single biggest risk the brief anticipated, and it does not materialize
based on how this service is actually configured.

(Side note, not a deploy risk but worth knowing: there is no `prisma/migrations`
directory — the schema is applied with `db push`, not tracked migrations. That's
an existing property of the project, unaffected by this change.)

### 3. Gitignored files the build might depend on

`.gitignore` excludes: `node_modules`, `.next/`, `.pnp*`, `/coverage`, `/build`,
`.DS_Store`, `*.pem`, `npm-debug.log*` and friends, `.env*` (except `.env.example`),
`.vercel`, `*.tsbuildinfo`, `next-env.d.ts`, `.superpowers/`.

What's actually present and gitignored in this worktree right now:
`.env`, `.next/`, `.superpowers/`, `next-env.d.ts`, `node_modules/`,
`tsconfig.tsbuildinfo`.

Every one of these is either regenerated by the build itself
(`node_modules`, `.next/`, `next-env.d.ts`, `tsconfig.tsbuildinfo` — a fresh
`npm install && next build` recreates all four) or is local-only and not read by
the production build/start scripts (`.env` — Next.js's own `build`/`start` don't
load `.env` in a way that matters here because Railway injects `DATABASE_URL` etc.
directly as real environment variables, not by shipping a dotenv file; `.superpowers/`
is scratch workspace unrelated to the app).

**Conclusion: nothing currently gitignored is required by the build or start
commands.** The specific failure mode the brief worried about — "`railway up`
silently uploads a gitignored file the build needs, a git build won't have it" —
was checked directly and doesn't apply to this repo today. Re-check this specific
point if anyone adds a new gitignored file that the build starts depending on
before cutover (e.g. a generated config, a downloaded asset) — that would be an
easy thing to introduce by accident between now and the actual switch.

### 4. Uncommitted / unmerged drift — this is the real risk

`git status --porcelain` in this worktree:

```
 M app/(app)/dashboard/page.tsx      (modified, not staged, not committed)
?? scripts/sweep-vault.ts            (new file, untracked)
```

`app/(app)/dashboard/page.tsx` adds a "that crew has already started" banner for
someone who scans a closed pact's invite — a real, user-visible fix, not a
formatting change. If `railway up` is run again from this worktree, this fix ships.
Under a git deploy, it never would, until it's committed, pushed, and merged.

`scripts/sweep-vault.ts` is a new operational script (manual emergency vault
sweep, not imported anywhere in the running app), so its absence wouldn't break
production, but it's a script the team may need later and it should be committed
so it isn't only sitting in one person's worktree.

On top of the working-tree diff, this branch (`namearth5005/buildathon-demo`) is
4 commits ahead of the now-current `origin/main`:

```
394737e fix: the channel authenticated by cookie alone, then hid the 401
8999c7f fix: an expired sign-in was reported as a crash
c34da5e fix: the photo upload authenticated by cookie alone too
e110bc2 fix: a sign-in the server could not see became an endless bounce
```

These are all auth/session bug fixes (401 handling, cookie vs. bearer auth,
sign-in bounce loops) — not cosmetic. 3 of the 4 are already pushed to
`origin/namearth5005/buildathon-demo`; `e110bc2` exists only in this local
worktree and has not been pushed anywhere. **None of the 4 are on `main`.** If
Railway is connected to `main` before these are merged, the next git-triggered
deploy would be a **regression**: it would remove these fixes from what's running,
even though `railway up` deploys after this point would still have them (because
`railway up` uploads the working directory, commits or not) — the two deploy paths
would silently diverge from each other. This is exactly the kind of gap a
git-connected deploy is supposed to close, so it should be closed by merging
these commits, not discovered by cutting over first.

## Environment variable parity

Names only, read via `railway variables --environment <env> --kv`, compared to
`.env.example`. No values are reproduced here or were retained anywhere.

| Variable | production | rehearsal | in `.env.example` | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | present | present | yes | |
| `NEXT_PUBLIC_PRIVY_APP_ID` | present | present | yes | |
| `PRIVY_APP_SECRET` | present | present | yes | |
| `SOLANA_RPC_URL` | present | present | yes | |
| `SPONSOR_SECRET_KEY` | present | present | yes | |
| `VAULT_ENCRYPTION_KEY` | present | present | yes | |
| `DFLOW_TRADE_API_URL` | present | present | yes | |
| `BLOB_READ_WRITE_TOKEN` | present | present | yes | |
| `STAKE_DRY_RUN` | **absent** | present | yes | By design — rehearsal-only flag, see `.env.example` comment. Do not add to production. |
| `DFLOW_API_KEY` | **absent** | **absent** | yes | Optional at runtime — `lib/dflow.ts:98` only sets the header if present. Not boot-blocking. Confirm intentional. |
| `PLATFORM_FEE_BPS` | **absent** | **absent** | yes | Optional — `lib/settlement.ts:467` defaults to `0`. Not boot-blocking. |
| `PLATFORM_FEE_ACCOUNT` | **absent** | **absent** | yes | Optional — `lib/settlement.ts:468` defaults to `undefined` (no fee taken). Not boot-blocking. |
| `ANTHROPIC_API_KEY` | **absent** | **absent** | yes | Optional — `app/api/rules/draft/route.ts:68` checks for it and handles absence explicitly (AI rule-drafting feature only). Not boot-blocking. |
| `CONFIRM_MAINNET_SPIKE`, `TEST_USER_SECRET_KEY`, `TEST_DESTINATION_WALLET` | absent | absent | yes | Only used by `scripts/spike-sponsored-swap.ts`, a local-only dev script. Not needed in any deployed environment. |

**Env parity verdict:** production and rehearsal are consistent with each other by
design (rehearsal = production + `STAKE_DRY_RUN`). The four variables missing from
both relative to `.env.example` (`DFLOW_API_KEY`, `PLATFORM_FEE_BPS`,
`PLATFORM_FEE_ACCOUNT`, `ANTHROPIC_API_KEY`) were checked against the code paths
that read them — none of them prevent the app from booting or serving traffic;
they gate individual features (platform fee collection, AI rule drafting, and an
optional DFlow auth header). This is **not** a git-deploy risk — the same gaps
exist today under `railway up`, since env vars come from Railway's variable store
either way, not from any file `railway up` uploads. Flagging them here only
because "does the app need a var it doesn't have" was worth checking while
already in the config. Confirm with the team whether any of the four are
intentionally deferred.

## Migration steps

Do not perform these until every box in the precondition checklist above is
checked.

1. **Freeze CLI deploys.** Get explicit confirmation nobody is going to run
   `railway up` again — the git integration and CLI-upload deploys are two
   different sources of truth for "what's live," and running both around the
   same time is exactly how the current gap (4 unmerged commits) happened.
2. **Land the outstanding branch work on `main`.**
   - Commit `app/(app)/dashboard/page.tsx` and `scripts/sweep-vault.ts` (or
     deliberately drop them if they're not meant to ship).
   - Push this worktree's branch (including the unpushed `e110bc2`) to
     `origin/namearth5005/buildathon-demo`.
   - Open a PR from that branch (or a fresh branch containing just these 4
     commits) into `main`, same as PR #1, and merge it.
3. **Deploy `origin/main` HEAD via `railway up` one more time**, from a clean
   checkout of `main` (not this worktree, which still carries its own branch), and
   confirm the deploy is healthy on `production`. This is the last CLI deploy —
   after this, whatever git-triggered deploy you connect next should build from
   an identical tree, so there's a known-good point to compare against or roll
   back to.
4. **Connect the git source on `rehearsal` first, not `production`.**
   Railway dashboard → project `dflow` → service `web` → Settings → Source →
   Connect Repo → `IndyIsaac/dflow`, branch `main`. (Equivalently,
   `mcp__railway__connect-service-source` / the CLI's repo-connect flow, scoped to
   the `rehearsal` environment/service if the dashboard lets you scope by
   environment — Railway services are shared across environments in this project,
   so check whether the connect action is service-wide or environment-scoped
   before applying it, since this service (`web`) serves both `rehearsal` and
   `production`.)
5. **Trigger a deploy on `rehearsal` from the connected branch** and verify:
   - Build succeeds via Railpack the same way it did in the logs pulled during
     this investigation (`npm run build` → Next.js compiles → static pages
     generate → route manifest matches what's expected).
   - `preDeployCommand` (`npx prisma db push`) still runs and succeeds.
   - The app boots and serves traffic on the rehearsal domain
     (`web-rehearsal-df0c.up.railway.app`).
   - Run `npm run preflight` against rehearsal's `DATABASE_URL`/RPC/etc. (or ask
     someone with rehearsal env access to run it) to confirm the money-path
     preconditions are intact — it's a real, existing script in this repo that
     checks DB, RPC, DFlow, and sponsor balance live.
6. **Only after rehearsal proves out**, connect `production`'s source the same way,
   pointed at `main`.
7. **Trigger (or wait for) the first git-triggered production deploy** and watch
   it the same way as step 5.
8. **Confirm no drift**: diff the deployed commit SHA (visible in the Railway
   deployment detail) against the `origin/main` HEAD you deployed via CLI in step
   3. They should build to a functionally identical app — if anything differs in
   behavior, the gap is almost certainly something that was in the CLI-uploaded
   working directory but never committed, so look there first.

## Rollback procedure

If the git-connected deploy fails, or production comes up broken and the cause
isn't quickly obvious:

1. In the Railway dashboard, service `web` → Settings → Source → Disconnect repo
   (or reconnect to "no source" / empty, restoring `repo: None`). This stops
   future git pushes from auto-deploying.
2. From a local checkout of the exact commit that was last known-good (the one
   deployed via CLI in step 3 of the migration, or whatever the last-good git
   deploy's commit was), run `railway up` as before. This is the same procedure
   that's been used all along, so it's a known-safe fallback.
3. Confirm the app is healthy again on the affected environment before touching
   anything else.
4. Once stable, investigate the git-build failure offline (in `rehearsal`, not
   `production`) before attempting the cutover again.

## Verify it worked — checklist

- [ ] `railway status` (or dashboard) shows the service's source as the connected
      repo/branch, not `repo: None`.
- [ ] A commit pushed to `main` triggers a new deployment automatically, without
      anyone running `railway up`.
- [ ] The deployed commit SHA shown in the Railway deployment matches
      `origin/main` HEAD.
- [ ] Build logs show the same shape as observed in this investigation
      (`npm run build`, Next.js compiling, `Route (app)` manifest listing all the
      expected routes — `/`, `/dashboard`, `/groups`, `/pacts/[id]`, the `/api/*`
      routes, etc.).
- [ ] Deploy logs show `npx prisma db push` ran as the pre-deploy step.
- [ ] `npm run preflight` passes against the deployed environment's config
      (DB reachable, RPC reachable, DFlow reachable, sponsor wallet funded).
- [ ] Spot-check the app in a browser: sign in, view dashboard, confirm the
      recent auth fixes (401 handling, no bounce loop) actually behave correctly
      — these are the exact behaviors that were at risk of being silently dropped
      if step 2 of the migration was skipped.
- [ ] No `STAKE_DRY_RUN` var present on `production` (it should only be on
      `rehearsal`).
