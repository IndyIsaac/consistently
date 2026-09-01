/* ---------------------------------------------------------------------------
 * Automated demo capture.
 *
 * Drives a real Chromium through the product and records it, so a take is
 * reproducible rather than performed. Re-running it after a copy change or a
 * layout fix produces the same footage with the change in it, which is the
 * whole point -- a hand-shot demo has to be re-shot.
 *
 * It records the app at a phone viewport and nothing else: no device frame, no
 * background, no zoom. Those are added afterwards in an editor, and a frame
 * baked into the footage cannot be taken out again.
 *
 * The output is three things:
 *
 *   video.webm   one continuous take
 *   beats.json   every beat with its millisecond offset into that take
 *   NN-name.png  a full-resolution still at each beat
 *
 * `beats.json` is the part that saves the editing time. Playwright cannot cut
 * a video into scenes, so instead each scene stamps the clock and the editor
 * is told where to put its zooms rather than hunting for them by scrubbing.
 *
 * This runs against the zero-environment path on purpose. With no
 * NEXT_PUBLIC_PRIVY_APP_ID the door accepts any six digits, and with no
 * DATABASE_URL lib/session.ts serves lib/mock-session.ts -- a frozen Friday
 * morning, the fifth day of a five-a-week rule, before the viewer has been to
 * the gym. No wallet, no mainnet, no seeding. See lib/session.ts, "the seam".
 *
 *   npm run capture
 *   npm run capture -- --base-url=http://localhost:3002 --only=door,dashboard
 *
 * DEV SURFACE -- not part of the product.
 * ------------------------------------------------------------------------- */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";

/* --------------------------------------------------------------------------
 * Options
 * ------------------------------------------------------------------------ */

function flag(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const OUT_DIR = path.resolve(flag("out", "docs/demo/raw"));
const HEADED = process.argv.includes("--headed");

/**
 * Start a dev server for this take and kill it afterwards.
 *
 * Not a convenience. lib/mock-session.ts runs its clock from the moment the
 * module loaded, at sixty times real speed, so a server that has been up for
 * twenty minutes is a full day past the Friday morning the demo was composed
 * for -- GYM_RULE's window closes at 22:00 and check-ins start being refused
 * for being outside it. A fresh process is the only way to get the same take
 * twice, which is the entire premise of capturing rather than performing.
 */
const SERVE_FLAG = process.argv.includes("--serve");

/**
 * Film a production build rather than a dev server. Implies `--serve`, because
 * the point is what this script starts, not what happens to be on :3000.
 */
const PROD = process.argv.includes("--prod");

const SERVE = SERVE_FLAG || PROD;

const SERVE_PORT = flag("port", "3210");

let BASE_URL = flag(
  "base-url",
  SERVE ? `http://localhost:${SERVE_PORT}` : (process.env.CAPTURE_BASE_URL ?? "http://localhost:3000"),
);

/** `--only=door,dashboard` shoots those scenes; `--skip=` drops them. */
const ONLY = flag("only", "").split(",").filter(Boolean);
const SKIP = flag("skip", "").split(",").filter(Boolean);

/**
 * Two shapes, because a demo is shot for one screen or the other and the
 * product is not the same on both.
 *
 *   phone   — iPhone 16 Pro's CSS screen, taken from app/preview/devices.tsx
 *             rather than from a device list, so the footage is the size the
 *             design was judged at.
 *   desktop — 1440x900, the first width past Tailwind's `lg` (1024px), which is
 *             where app/(app)/dashboard/page.tsx stops stacking its pact cards.
 *             Below that, desktop is only the phone layout with more air.
 *
 * `--shape=desktop`. The scale default follows the shape: 3x on a phone puts
 * the take at 1206x2622, which survives being scaled into a mockup and
 * cropped; 3x on desktop would be 4320x2700, which is a bigger frame than any
 * editor needs and a much heavier file, so desktop defaults to 2.
 */
const SHAPES = {
  phone: { viewport: { width: 402, height: 874 }, scale: 3 },
  desktop: { viewport: { width: 1440, height: 900 }, scale: 2 },
} as const;

type ShapeName = keyof typeof SHAPES;

const SHAPE_NAME = ((): ShapeName => {
  const asked = flag("shape", "phone");
  if (asked in SHAPES) return asked as ShapeName;
  throw new Error(`--shape must be one of ${Object.keys(SHAPES).join(", ")}; got "${asked}"`);
})();

const SHAPE = SHAPES[SHAPE_NAME];

const VIEWPORT = SHAPE.viewport;

/**
 * Chromium's screencast captures device pixels, so this is the multiplier on
 * the recorded resolution as well as the rendered one.
 */
const SCALE = Number(flag("scale", String(SHAPE.scale)));

/**
 * lib/mock-session.ts runs its clock at MOCK_MS_PER_MINUTE = 1_000, so one real
 * second is one minute to the rule. GYM_RULE's minDurationMins is 30, which is
 * why the early check-out is refused at ~8s and accepted at ~32s. If either
 * constant changes, these change with it.
 */
const MOCK_SECONDS_PER_MINUTE = 1;
const GYM_MIN_DURATION_MINS = 30;

/* --------------------------------------------------------------------------
 * Beats
 * ------------------------------------------------------------------------ */

type Beat = { n: number; scene: string; label: string; atMs: number; still: string | null };

const beats: Beat[] = [];

/** Anything the browser complained about while the camera was running. */
const pageErrors: string[] = [];

let recordingStartedAt = 0;

/**
 * Stamp the clock and take a still.
 *
 * The offset is measured from the moment the context was created, which is
 * when Playwright starts the screencast. It drifts from the video's own
 * timeline by however long the first frame took to arrive -- tens of
 * milliseconds, well inside the tolerance of "put a zoom about here".
 */
async function beat(page: Page, scene: string, label: string): Promise<void> {
  const n = beats.length + 1;
  const atMs = Date.now() - recordingStartedAt;
  const still = `${String(n).padStart(2, "0")}-${scene}.png`;

  try {
    await page.screenshot({ path: path.join(OUT_DIR, still), scale: "device" });
  } catch {
    // A still is a convenience; losing one is not worth losing the take.
    beats.push({ n, scene, label, atMs, still: null });
    console.log(`  ${stamp(atMs)}  ${label}  (still failed)`);
    return;
  }

  beats.push({ n, scene, label, atMs, still });
  console.log(`  ${stamp(atMs)}  ${label}`);
}

function stamp(ms: number): string {
  const total = Math.round(ms / 100) / 10;
  const m = Math.floor(total / 60);
  const s = (total % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

/**
 * How long the camera rests on things, as a multiplier. `--pace=2` doubles it.
 *
 * The default take moves at the speed of somebody who already knows the
 * product. A demo that gets talked over does not: a beat has to stay on screen
 * long enough to say a sentence about it, which is four or five seconds, not
 * one. Shoot generously and cut in the editor -- a hold that is too long can be
 * trimmed, and one that is too short cannot be invented.
 */
const PACE = Number(flag("pace", "1"));

/**
 * Let an animation land before the shutter. The app's scene transitions are
 * 300ms, so this is never below that however impatient `--pace` gets.
 *
 * Only the resting holds scale. The two waits in the check-in scene are tied
 * to lib/mock-session.ts's clock -- which runs a minute a second -- and
 * stretching those would not hold the shot for longer, it would move the
 * arithmetic of the thirty-minute rule and change what the bot says.
 */
const settle = (page: Page, ms = 900) => page.waitForTimeout(Math.max(300, Math.round(ms * PACE)));

/**
 * Move the way a member moves: click the nav, do not reload the page.
 *
 * Every scene used to open with `page.goto`, which is a hard load. The app
 * shell remounts, and components/Arrival.tsx replays its 0.6s blur-and-rise
 * from nothing -- so the take carried a blank white screen at every scene
 * boundary, seven times over, and read as jumpy for a reason that had nothing
 * to do with frame rate. Arrival's own note says it "runs once. The shell
 * persists across tab changes"; a `goto` per scene defeats exactly that.
 *
 * Falling back to `goto` keeps every scene independently runnable, which is
 * what `--only=checkin` depends on. The fallback is also the honest path for
 * the front door, where a real arrival *is* a page load.
 */
async function go(page: Page, path: string, navLabel?: string): Promise<void> {
  if (navLabel && page.url().startsWith(BASE_URL) && !page.url().endsWith(path)) {
    // Case-insensitive: components/BottomNav.tsx writes "Dashboard" but the
    // label is uppercased in CSS, and the accessible name can come back either
    // way depending on how the tree is computed.
    const link = page.getByRole("link", {
      name: new RegExp(`^${navLabel}$`, "i"),
    });
    if (await link.isVisible().catch(() => false)) {
      await link.click();
      await page.waitForURL(`**${path}`, { timeout: 15_000 }).catch(() => {});
      return;
    }
  }
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
}

/* --------------------------------------------------------------------------
 * Scenes
 *
 * Each returns nothing and throws on failure. The runner catches, records the
 * failure against the scene name and carries on, because a broken scene 7 is
 * no reason to throw away scenes 1 to 6 -- they are already on the tape.
 * ------------------------------------------------------------------------ */

type Scene = { name: string; run: (page: Page) => Promise<void> };

const SCENES: Scene[] = [
  {
    name: "door",
    /** The landing surface, the START press, and the six digits behind it. */
    run: async (page) => {
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "START" }).waitFor({ timeout: 60_000 });
      await settle(page, 1_400);
      await beat(page, "door", "Front door — “Stay consistent.”");

      await page.getByRole("button", { name: "START" }).click();
      await page.locator("#email").waitFor();
      await settle(page, 600);

      // Typed rather than filled: the keystrokes are the point on camera.
      await page.locator("#email").pressSequentially("indy@consistently.app", { delay: 55 });
      await beat(page, "door", "Email entered");

      await page.getByRole("button", { name: "CONTINUE" }).click();
      await page.getByLabel("Digit 1 of 6").waitFor();
      await settle(page, 600);

      // The door says so itself with no Privy app id: any six digits will do.
      // The last cell is deliberately left for after the beat: writeDigits
      // submits from the keystroke that completes the code, so filling all six
      // and then reaching for CONTINUE finds a form that has already gone.
      for (const [i, d] of [..."48291"].entries()) {
        await page.getByLabel(`Digit ${i + 1} of 6`).fill(d);
        await page.waitForTimeout(110);
      }
      await beat(page, "door", "Six digits — any six, with no Privy app id set");

      await page.getByLabel("Digit 6 of 6").fill("3");
      await page.waitForURL((u) => !u.pathname.endsWith("/"), { timeout: 30_000 }).catch(() => {});
      await settle(page, 1_600);
      await beat(page, "door", "Through the door");
    },
  },

  {
    name: "dashboard",
    /** Everything across every pact at once — the "how am I doing" screen. */
    run: async (page) => {
      await go(page, "/dashboard", "Dashboard");
      await settle(page, 1_800);
      await beat(page, "dashboard", "Dashboard — streaks, earned, lost");

      await page.mouse.wheel(0, 420);
      await settle(page, 1_200);
      await beat(page, "dashboard", "Both pacts, scrolled");
    },
  },

  {
    name: "groups",
    run: async (page) => {
      await go(page, "/groups", "Groups");
      await settle(page, 1_600);
      await beat(page, "groups", "Groups — the crews you are in");
    },
  },

  {
    name: "channel",
    /** The bot channel: a feed, not a chat. Seven commands and nothing else. */
    run: async (page) => {
      await go(page, "/pacts/pact_five_a_week");
      await page.getByLabel("Run a command").waitFor({ timeout: 60_000 });
      await settle(page, 1_800);
      await beat(page, "channel", "Five a week — the channel, Friday morning");

      await runCommand(page, "help");
      await beat(page, "channel", "/help — seven commands, nothing else is a message");

      await runCommand(page, "crew");
      await beat(page, "channel", "/crew — everyone’s standing");

      await runCommand(page, "stake");
      await beat(page, "channel", "/stake — what is riding on it");
    },
  },

  {
    name: "checkin",
    /**
     * The one that has to work on camera.
     *
     * Check in with a photo, attempt the check-out too early and be refused
     * with the arithmetic quoted, then wait out the compressed thirty minutes
     * and be let through. PRODUCT.md: finding out immediately is the point.
     */
    run: async (page) => {
      await go(page, "/pacts/pact_five_a_week");
      await page.getByLabel("Run a command").waitFor({ timeout: 60_000 });
      await settle(page, 1_200);

      // CheckInCamera is a real <input type="file"> -- it dropped `capture`
      // because WebKit would not open a picker for a display:none input. That
      // decision is what makes this scriptable at all.
      const photo = path.resolve("public/mock/checkin-rack.jpg");
      if (!existsSync(photo)) throw new Error(`no check-in photo at ${photo}`);

      await page.setInputFiles('input[type="file"][accept="image/*"]', photo);
      await settle(page, 2_400);
      await beat(page, "checkin", "Checked in — photo posted to the channel");

      // Early. The refusal quotes the minutes left, and the number is real.
      await page.waitForTimeout(8_000);
      await page.setInputFiles('input[type="file"][accept="image/*"]', photo);
      // Longer than the others: capture() says the refusal and then calls its
      // own scrollToFoot, and the beat wants both finished.
      await settle(page, 3_000);
      await beat(page, "checkin", "Check-out refused — “you’ve got another …”");

      // Wait out the rest of the compressed thirty, plus a little margin.
      const remainingMs = (GYM_MIN_DURATION_MINS * MOCK_SECONDS_PER_MINUTE - 8 + 4) * 1_000;
      await page.waitForTimeout(remainingMs);
      await page.setInputFiles('input[type="file"][accept="image/*"]', photo);
      await settle(page, 2_600);
      await beat(page, "checkin", "Checked out — the same arithmetic, now satisfied");
    },
  },

  {
    name: "exemption",
    /** Dave's flight was cancelled twice. Nat has already said yes. */
    run: async (page) => {
      await go(page, "/pacts/pact_five_a_week");
      await page.getByLabel("Run a command").waitFor({ timeout: 60_000 });
      await settle(page, 1_400);

      const vote = page.getByRole("button", { name: "Let them off" }).first();
      if (await vote.count()) {
        await vote.scrollIntoViewIfNeeded();
        await settle(page, 800);
        await beat(page, "exemption", "Dave asks to be let off — one of two votes in");
        await vote.click();
        await settle(page, 1_800);
        await beat(page, "exemption", "Voted — the group is the referee, not the software");
      } else {
        await beat(page, "exemption", "No exemption control on screen");
      }
    },
  },

  {
    name: "settings",
    run: async (page) => {
      await go(page, "/settings");
      await settle(page, 1_600);
      await beat(page, "settings", "Settings — name, photo, linked accounts");
    },
  },
];

/** Type a slash command the way a member does, and give the bot time to answer. */
async function runCommand(page: Page, command: string): Promise<void> {
  const field = page.getByLabel("Run a command");
  await field.click();
  await field.pressSequentially(command, { delay: 85 });
  await page.waitForTimeout(500);
  await field.press("Enter");
  // Through `settle`, so the bot's answer stays on screen long enough to be
  // read aloud when the take is paced for narration.
  await settle(page, 1_900);
}

/* --------------------------------------------------------------------------
 * The server, when we own it
 * ------------------------------------------------------------------------ */

/**
 * Spawn a server and wait for it to say it is listening.
 *
 * `--prod` builds first and serves that, and it is the flag that decides
 * whether the animations survive the take.
 *
 * `next dev` compiles each route the moment it is first asked for, runs React
 * in development -- slower renders, and StrictMode invoking effects twice --
 * and mounts the dev overlay alongside. None of that is visible in a still. It
 * is very visible in a video: the Arrival fade, the limelight sliding under the
 * nav and the channel's bot lines all land on whichever frames the main thread
 * had time for, so the take arrives judder-y in a way no amount of re-encoding
 * can take out. The frames were never captured evenly.
 *
 * The build costs about a minute. It is the difference between filming the
 * product and filming a development server.
 *
 * The port is read back out of its own output rather than assumed: Next takes
 * the next free one when the requested port is busy, and capturing against
 * whatever was already on 3000 is how you end up filming someone else's app.
 */
async function startServer(): Promise<ChildProcess> {
  if (PROD) {
    console.log(`\n  building …`);
    const built = spawnSync("npx", ["next", "build"], {
      shell: true,
      stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production" },
    });
    if (built.status !== 0) {
      throw new Error("next build failed; run `npm run build` to see why");
    }
  }

  const mode = PROD ? "start" : "dev";
  console.log(`\n  starting next ${mode} on :${SERVE_PORT} …`);

  const child = spawn("npx", ["next", mode, "--port", SERVE_PORT], {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    // The whole point is the zero-environment path; a stray .env would change
    // what the capture is of. Next still reads .env files itself, so this only
    // guarantees the shell adds nothing.
    env: { ...process.env, NODE_ENV: PROD ? "production" : "development" },
  });

  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`next ${mode} did not start in 120s`)),
      120_000,
    );
    let seen = "";

    const read = (chunk: Buffer) => {
      seen += chunk.toString();
      const local = seen.match(/http:\/\/localhost:(\d+)/);
      if (local && /Ready in/.test(seen)) {
        clearTimeout(timer);
        resolve(local[0]);
      }
    };

    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`next ${mode} exited with ${code}\n${seen.trim()}`));
    });
  });

  BASE_URL = await ready;
  console.log(`  listening at ${BASE_URL}`);

  // A moment for the first compile, so scene one is not filming a spinner.
  await new Promise((r) => setTimeout(r, 1_500));
  return child;
}

/**
 * Kill it and everything it spawned. On Windows `next dev` is a grandchild of
 * this process behind npx, and killing the parent leaves the port held.
 */
function stopServer(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      // Synchronous on purpose: main() calls process.exit immediately after
      // this, and an async kill loses the race -- leaving the port held and
      // the next run dying on EADDRINUSE.
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    child.kill("SIGKILL");
  }
}

/* --------------------------------------------------------------------------
 * Runner
 * ------------------------------------------------------------------------ */

async function main() {
  const chosen = SCENES.filter(
    (s) => (ONLY.length === 0 || ONLY.includes(s.name)) && !SKIP.includes(s.name),
  );

  if (chosen.length === 0) {
    console.error(`No scenes selected. Known: ${SCENES.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }

  let server: ChildProcess | undefined;
  if (SERVE) server = await startServer();

  // A reachable server first, because the alternative is a four-minute take of
  // Chromium's error page.
  const probe = await fetch(BASE_URL, { redirect: "manual" }).catch(() => null);
  if (!probe) {
    stopServer(server);
    console.error(
      `Nothing answering at ${BASE_URL}. Start it with \`npm run dev\`, or pass --serve.`,
    );
    process.exit(1);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`\n  ${BASE_URL} → ${path.relative(process.cwd(), OUT_DIR)}`);
  console.log(
    `  ${SHAPE_NAME} · ${VIEWPORT.width}×${VIEWPORT.height} at ${SCALE}× · ${chosen.length} scenes\n`,
  );

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  const failures: { scene: string; error: string }[] = [];

  try {
    browser = await chromium.launch({ headless: !HEADED });
    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      isMobile: true,
      hasTouch: true,
      colorScheme: "light",
      reducedMotion: "no-preference",
      /**
       * The pact's own timezone, not the machine's.
       *
       * Every mock timestamp is composed against Asia/Bangkok -- MOCK_NOW is a
       * Friday 09:12 there -- and the channel renders them in the browser's
       * zone. Filmed from anywhere else the demo is set at the wrong time of
       * day, and a gym check-in stamped 19:12 quietly contradicts the story.
       */
      timezoneId: "Asia/Bangkok",
      locale: "en-GB",
      /**
       * `size` is the CSS viewport, NOT the viewport times the scale factor.
       *
       * This used to read `VIEWPORT.width * SCALE`, on the belief that Chromium
       * screencasts at the device scale factor and Playwright then scales each
       * frame up to `size`. It does not. The screencast arrives in CSS pixels,
       * and a larger `size` is not filled -- it is padded. Every take came out
       * with the app in the top-left quadrant and the rest of the frame flat
       * grey, which reads in an editor as a small video in the corner of a big
       * canvas, because that is exactly what it was.
       *
       * The stills are unaffected: `page.screenshot({ scale: "device" })` does
       * honour `deviceScaleFactor`, which is why 05-dashboard.png is 2880x1800
       * and sharp while the video of the same moment was neither.
       *
       * So the take is CSS-resolution: 1440x900 on desktop, 402x874 on a phone.
       * `deviceScaleFactor` still earns its keep for the stills. To hand an
       * editor more pixels than this, upscale after the fact -- see the ffmpeg
       * line in docs/demo/README.md.
       */
      recordVideo: {
        dir: OUT_DIR,
        size: { width: VIEWPORT.width, height: VIEWPORT.height },
      },
    });

    /**
     * Next's dev overlay is not part of the product and must not be in shot.
     * It mounts a `nextjs-portal` custom element and paints a badge over the
     * bottom-left corner -- which in a take is a red "1 Issue" pill sitting on
     * top of the nav. Hidden rather than disabled so that anything it is
     * complaining about still reaches `pageErrors` below.
     *
     * Applied on load rather than through addInitScript, which injects its own
     * script tag into the document React is about to hydrate -- React notices
     * the tag it did not render, hydration fails, and the badge this is meant
     * to hide lights up reporting it. After load there is nothing left to
     * mismatch.
     */
    recordingStartedAt = Date.now();
    const page = await context.newPage();

    page.on("load", () => {
      void page
        .addStyleTag({
          content: "nextjs-portal, #nextjs-dev-tools-indicator { display: none !important; }",
        })
        .catch(() => {});
    });

    // Whatever the overlay was going to say, said here instead.
    page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message.split("\n")[0]}`));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(`console: ${m.text().split("\n")[0]}`);
    });

    /**
     * The blob store, stubbed the way lib/session.ts stubs the database.
     *
     * app/api/uploads answers 503 without BLOB_READ_WRITE_TOKEN, and lib/bot.ts
     * turns that into "a check-in without a photo is not a check-in, so nothing
     * was recorded" -- which refuses the sequence this whole capture exists to
     * show. Fulfilling the one request with an image the app already serves
     * leaves every line below it running its own code: the session opens, the
     * early check-out is refused by the real arithmetic against the real rule,
     * and the channel renders a real photo.
     *
     * Nothing here fakes the check-in. It only supplies the URL that blob
     * storage would have returned.
     */
    await page.route("**/api/uploads", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "/mock/checkin-rack.jpg" }),
      }),
    );

    for (const scene of chosen) {
      console.log(`· ${scene.name}`);
      try {
        await scene.run(page);
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
        failures.push({ scene: scene.name, error: message });
        console.log(`  ✗ ${message}`);
      }
    }

    // A beat of stillness at the end, so the last frame is not mid-transition.
    await page.waitForTimeout(1_200);

    const video = page.video();
    // The file is only flushed on close, and its name is only knowable after.
    await context.close();
    context = undefined;

    const videoPath = video ? await video.path() : null;
    if (videoPath) {
      const named = path.join(OUT_DIR, "video.webm");
      const { rename } = await import("node:fs/promises");
      await rename(videoPath, named).catch(() => {});
    }

    await writeBeats(failures);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    stopServer(server);
  }

  console.log(
    `\n  ${beats.length} beats, ${failures.length} scene${failures.length === 1 ? "" : "s"} failed`,
  );
  for (const f of failures) console.log(`    ✗ ${f.scene}: ${f.error}`);

  const distinct = [...new Set(pageErrors)];
  if (distinct.length > 0) {
    console.log(`\n  ${distinct.length} distinct browser error(s) — hidden from the take:`);
    for (const e of distinct.slice(0, 8)) console.log(`    ! ${e}`);
  }
  console.log(`\n  ${path.relative(process.cwd(), OUT_DIR)}\n`);

  // A failed scene is a real result worth reporting, not a crash.
  process.exit(failures.length > 0 ? 2 : 0);
}

/** The edit sheet: where each beat is, in a form an editor can read at a glance. */
async function writeBeats(failures: { scene: string; error: string }[]): Promise<void> {
  await writeFile(
    path.join(OUT_DIR, "beats.json"),
    `${JSON.stringify(
      {
        baseUrl: BASE_URL,
        viewport: VIEWPORT,
        scale: SCALE,
        timezone: "Asia/Bangkok",
        beats,
        failures,
        pageErrors: [...new Set(pageErrors)],
      },
      null,
      2,
    )}\n`,
  );

  const lines = [
    "# Demo capture — edit sheet",
    "",
    `Take recorded from ${BASE_URL} on ${SHAPE_NAME} at ${VIEWPORT.width}×${VIEWPORT.height} (${SCALE}×).`,
    "Offsets are into `video.webm`. Drop a zoom on the beats worth landing on.",
    "",
    "| At | Scene | Beat | Still |",
    "|---|---|---|---|",
    ...beats.map((b) => `| \`${stamp(b.atMs)}\` | ${b.scene} | ${b.label} | ${b.still ?? "—"} |`),
  ];

  if (failures.length > 0) {
    lines.push("", "## Scenes that failed", "");
    for (const f of failures) lines.push(`- **${f.scene}** — ${f.error}`);
  }

  await writeFile(path.join(OUT_DIR, "beats.md"), `${lines.join("\n")}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
