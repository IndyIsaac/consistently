"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLoginWithEmail, useLoginWithSiws, usePrivy } from "@privy-io/react-auth";
import { useStandardWallets } from "@privy-io/react-auth/solana";

import { TriangleAlert, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { phantomBrowseLink, walletPath } from "@/lib/door";

/* ---------------------------------------------------------------------------
 * The front door, and the one surface that takes the inverse of the app's
 * theme: near-black under a light app, bone under a dark one. One line, one
 * press, then the code — and then the interior, which the app never leaves.
 *
 * Nothing here names a value. `door` and `door-ink` are the flip, and every
 * alpha ramp below rides on them, so the whole surface inverts as one.
 *
 * Privy is the real mechanism: email, then a six-digit code, no password and so
 * no 2FA. `NEXT_PUBLIC_PRIVY_APP_ID` is inlined at build time; with nothing to
 * call, app/providers.tsx does not mount the provider, `MOCK_AUTH` below runs
 * its own timings, and every screen reads lib/mock-session.ts instead.
 *
 * The door itself never learns which of the two it is talking to. `Door` takes
 * an `Auth` and drives the same four states either way, so the shape of the
 * flow -- and every timing, error and focus move in it -- is the one thing that
 * cannot drift between the demo path and the real one. The two wrappers at the
 * foot of this file are the only place that branches, and they are separate
 * components because `useLoginWithEmail` cannot be called conditionally.
 * ------------------------------------------------------------------------- */

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const PRIVY_CONFIGURED = PRIVY_APP_ID.length > 0;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_LENGTH = 6;

/* ---------------------------------------------------------------------------
 * "Signed in" is two facts, and they do not arrive together.
 *
 * Privy's `authenticated` is a client fact: it flips the moment the SDK holds a
 * token. proxy.ts reads a `privy-token` cookie, which is a server fact and
 * lands a beat later -- the SDK writes it once the token is stored, with
 * js-cookie, which is the only reason this file is allowed to read it.
 *
 * Navigating inside that gap is a loop: push /dashboard, the proxy sees no
 * cookie and sends the member back to /, the door sees `authenticated` and
 * pushes again, forever. What that looks like from a chair is a white screen
 * that comes right after a refresh, which is a bug report nobody enjoys.
 *
 * So the door waits for the cookie itself -- not a timer, not the token, the
 * exact string proxy.ts gates on -- before it moves anybody.
 * ------------------------------------------------------------------------- */
const SESSION_COOKIE = "privy-token";

/** Long enough for a slow round trip, short enough to still be an app. */
const SESSION_WAIT_MS = 3_000;
const SESSION_POLL_MS = 60;

/**
 * The end of the line, and the only sentence here a member can act on.
 * Reloading is not a shrug: a fresh document asks the server again, and Privy
 * writes this cookie SameSite=Strict -- so one that exists but was withheld
 * from a cross-site landing is carried by the second, same-site request.
 */
const SESSION_UNSEEN =
  "You are signed in and the server cannot see it. Reload the page. If that does not do it, this browser is not letting the cookie through.";

/**
 * One installed wallet, ready to be pressed. Resolves to an error string or
 * null, like every other step here.
 */
type WalletOption = {
  name: string;
  /** A data: URI the wallet supplies for itself. */
  icon?: string;
  connect: () => Promise<string | null>;
};

/**
 * Each step resolves to an error string naming the problem, or null when it
 * succeeded. Never rejects: the door renders failure, it does not catch it.
 */
type Auth = {
  sendCode: (email: string) => Promise<string | null>;
  verifyCode: (code: string) => Promise<string | null>;
};

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The one fact proxy.ts checks, read where the browser keeps it. If the cookie
 * is not in this string the next request will not carry it either, which is
 * precisely the question worth asking before navigating.
 */
function serverCanSeeSession() {
  return new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(document.cookie);
}

/**
 * Resolves true once the cookie is there, false if it never turned up.
 *
 * `getAccessToken()` comes first because it mints or refreshes the token and
 * Privy writes the cookie in the same breath. It is not the proof, though --
 * the cookie is -- so the verdict comes from the poll either way, and the
 * token call is raced against the deadline so a hung refresh cannot hold the
 * door shut.
 */
async function sessionVisible(getAccessToken: () => Promise<string | null>) {
  const deadline = Date.now() + SESSION_WAIT_MS;

  try {
    await Promise.race([getAccessToken(), pause(SESSION_WAIT_MS)]);
  } catch {
    // A refresh that failed is not the answer to the question being asked.
  }

  while (!serverCanSeeSession()) {
    if (Date.now() >= deadline) return false;
    await pause(SESSION_POLL_MS);
  }
  return true;
}

/** A signature is 64 bytes, so a plain spread is safe here. */
function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The zero-env-var path. The validation is real and the waits are roughly what
 * Privy's own round trips cost, so the demo rehearses at the speed it will run.
 */
const MOCK_AUTH: Auth = {
  async sendCode(email) {
    if (!EMAIL_RE.test(email)) return "That is not an email address.";
    await pause(600);
    return null;
  },
  async verifyCode(code) {
    if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) return "That code is not six digits.";
    await pause(650);
    return null;
  },
};

/**
 * Privy throws on a bad address or a wrong code rather than resolving with a
 * verdict, and its messages name its own internals. Both are turned into the
 * one sentence the door can show, in the product's voice.
 */
function privyAuth(privy: ReturnType<typeof useLoginWithEmail>): Auth {
  return {
    async sendCode(email) {
      if (!EMAIL_RE.test(email)) return "That is not an email address.";
      try {
        await privy.sendCode({ email });
        return null;
      } catch {
        return "That address could not be reached. Try again.";
      }
    },
    async verifyCode(code) {
      if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) return "That code is not six digits.";
      try {
        await privy.loginWithCode({ code });
        return null;
      } catch {
        // Privy invalidates the code after five attempts and does not say which
        // failure this was. "Ask for another" covers both without guessing.
        return "That code did not work. Ask for another.";
      }
    },
  };
}

type Step = "rest" | "email" | "code" | "arriving" | "stuck";

const EMPTY_CODE = Array<string>(CODE_LENGTH).fill("");

/**
 * One bounce per document.
 *
 * Waiting for the cookie should mean the door never pushes into a redirect it
 * cannot survive. It is not enough on its own: a cookie can be cleared
 * mid-session, and a SameSite=Strict one is invisible to the first request of
 * a cross-site landing however plainly `document.cookie` shows it. Either way
 * the proxy returns the member to `/` with `alreadyIn` still true, and an
 * effect that replaces every time it mounts is the loop.
 *
 * A ref would not hold, because the bounce may remount this component. A
 * module variable lasts exactly as long as the document -- which is the right
 * life for it: a reload is the member's retry, and it should get a clean one.
 */
let bouncedOnce = false;

function Door({
  auth,
  privyConfigured,
  wallets,
  handoff,
  invite,
  alreadyIn = false,
  awaitSession,
}: {
  auth: Auth;
  privyConfigured: boolean;
  /** Null when there is no Privy app. Empty when nothing is installed. */
  wallets: WalletOption[] | null;
  /**
   * Opens Privy's own sheet, which is the only thing holding the WalletConnect
   * entry and so the only way to reach Phantom on a phone. Absent on the
   * zero-env-var path, where an empty list is never reached.
   */
  handoff?: () => void;
  /** A scanned invite the proxy stashed, or null. See app/page.tsx. */
  invite: string | null;
  /** Signed in already -- a returning tab, or a sign-in that did not navigate. */
  alreadyIn?: boolean;
  /**
   * Resolves true once the server can see the session, false once it is clear
   * it never will. Absent on the zero-env-var path, where there is no cookie,
   * nothing gates on one, and so there is nothing to wait for.
   */
  awaitSession?: () => Promise<boolean>;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [step, setStep] = useState<Step>("rest");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(EMPTY_CODE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const verifying = useRef(false);

  /**
   * Held in a ref, and read through one stable callback, because Privy hands
   * back a fresh `getAccessToken` identity on some renders -- and `arrive`
   * feeds `enter`, which must not be rebuilt under somebody mid-code. Nothing
   * is captured that could go stale: the wait reads the cookie when it runs.
   */
  const gate = useRef(awaitSession);
  // The ref is seeded once and then kept in step: `useRef(awaitSession)` reads
  // its argument on the first render only, so a prop that arrives later -- or
  // changes identity, which Privy's `getAccessToken` does -- would never reach
  // the callback below without this.
  useEffect(() => {
    gate.current = awaitSession;
  }, [awaitSession]);
  const serverSees = useCallback(async () => (gate.current ? gate.current() : true), []);

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  /**
   * Crossing the threshold. Both doors end here -- the email code and the
   * wallet signature are different proofs of the same thing, and what follows
   * them is identical.
   */
  const arrive = useCallback(async () => {
    setStep("arriving");

    /**
     * The wipe and the wait run together rather than one after the other. The
     * 620ms of threshold is time the door was already spending and the cookie
     * almost always lands inside it, so crossing costs what it always cost --
     * a late session is the only thing that makes anybody wait longer.
     */
    const [visible] = await Promise.all([serverSees(), pause(reduceMotion ? 0 : 620)]);

    // Pushing anyway would hand the member the loop this whole file is now
    // built to avoid. A sentence they can act on is a worse outcome than the
    // dashboard and a far better one than a blank page.
    if (!visible) {
      setError(SESSION_UNSEEN);
      setStep("stuck");
      return;
    }

    router.push("/dashboard");
  }, [reduceMotion, router, serverSees]);

  /**
   * A door is for people outside. Somebody already signed in and looking at it
   * is in a state that should not exist -- a tab left open, or a sign-in that
   * failed to navigate -- and asking them to sign in again earns them "User
   * already authenticated" from Privy, which explains nothing to anybody.
   */
  useEffect(() => {
    if (!alreadyIn) return;

    let live = true;

    void (async () => {
      // Back here after a bounce. The client says signed in, the server keeps
      // saying otherwise, and trying a third time would only ask the same
      // question faster. Stop, and say so.
      //
      // Checked inside the async block rather than in the effect body: a
      // synchronous setState there cascades a render, which React's own lint
      // rule refuses, and every other refusal on this path already reports
      // itself from here.
      if (bouncedOnce) {
        if (!live) return;
        setError(SESSION_UNSEEN);
        setStep("stuck");
        return;
      }

      const visible = await serverSees();
      if (!live) return;

      if (!visible) {
        setError(SESSION_UNSEEN);
        setStep("stuck");
        return;
      }

      // Set on the way out rather than on the way in, so a development
      // remount -- StrictMode mounts every effect twice -- spends the one
      // attempt on the navigation and not on the rehearsal of it.
      bouncedOnce = true;

      // `replace`, and no threshold animation: this is not an arrival, it is a
      // page they should never have been looking at. The animation is for
      // crossing a threshold, and they crossed it already.
      router.replace("/dashboard");
    })();

    return () => {
      live = false;
    };
  }, [alreadyIn, router, serverSees]);

  const enter = useCallback(
    async (code: string) => {
      if (verifying.current) return;
      verifying.current = true;
      setBusy(true);
      setError(null);

      const failure = await auth.verifyCode(code);
      if (failure) {
        verifying.current = false;
        setBusy(false);
        setError(failure);
        setDigits(EMPTY_CODE);
        cells.current[0]?.focus();
        return;
      }

      await arrive();
    },
    [auth, arrive],
  );

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const failure = await auth.sendCode(email.trim());
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setDigits(EMPTY_CODE);
    setStep("code");
  }

  function writeDigits(from: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    const next = [...digits];

    if (typed === "") {
      next[from] = "";
    } else {
      for (let i = 0; i < typed.length && from + i < CODE_LENGTH; i += 1) {
        next[from + i] = typed[i];
      }
    }
    setDigits(next);

    if (typed === "") return;
    cells.current[Math.min(from + typed.length, CODE_LENGTH - 1)]?.focus();

    // Six digits in means six digits in. Submitting from the keystroke that
    // completed the code — rather than from an effect watching the state — keeps
    // React out of a cascading render.
    if (next.every((d) => d !== "")) void enter(next.join(""));
  }

  function onCellKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && digits[index] === "" && index > 0) {
      event.preventDefault();
      setDigits((prev) => {
        const next = [...prev];
        next[index - 1] = "";
        return next;
      });
      cells.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      cells.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      event.preventDefault();
      cells.current[index + 1]?.focus();
    }
  }

  const scene: Step = step === "arriving" ? "code" : step;
  const sceneMotion = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
  };

  return (
    <div className="on-door relative flex min-h-dvh flex-1 flex-col overflow-hidden overscroll-none bg-door font-mono text-door-ink">
      {/* The slot below the line reserves its tallest state, so the block never
          changes height and the line never moves when the panel opens. */}
      <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-[clamp(1.6rem,7.5vw,3rem)] leading-[1.1] font-medium tracking-[-0.03em] whitespace-nowrap text-door-ink/65">
          Stay consistent<span className="text-door-ink">.</span>
        </h1>

        <div className="mt-10 min-h-[17.5rem] max-w-[23rem]">
          <AnimatePresence mode="wait" initial={false}>
            {scene === "rest" && (
              <motion.div key="rest" {...sceneMotion}>
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="rounded-full border border-door-ink/25 px-8 py-3.5 text-[11px] tracking-[0.32em] text-door-ink transition-colors duration-200 hover:border-door-ink hover:bg-door-ink hover:text-door"
                >
                  START
                </button>
              </motion.div>
            )}

            {scene === "email" && (
              <motion.form key="email" {...sceneMotion} onSubmit={submitEmail} noValidate>
                <label
                  htmlFor="email"
                  className="block text-[11px] tracking-[0.24em] text-grey-on-door uppercase"
                >
                  Email
                </label>

                <div className="mt-3 flex items-center gap-2 border-b border-door-ink/20 transition-colors focus-within:border-door-ink">
                  <span aria-hidden="true" className="text-door-ink/40 select-none">
                    &gt;
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    aria-invalid={error !== null}
                    className="w-full bg-transparent py-3 text-[15px] text-door-ink outline-none placeholder:text-grey-on-door"
                  />
                </div>

                <FormError message={error} />

                <SubmitButton busy={busy}>{busy ? "SENDING" : "CONTINUE"}</SubmitButton>
                <OrRule />
                <WalletOptions
                  wallets={wallets}
                  handoff={handoff}
                  invite={invite}
                  onFailure={setError}
                  onSuccess={arrive}
                />
              </motion.form>
            )}

            {scene === "code" && (
              <motion.form
                key="code"
                {...sceneMotion}
                onSubmit={(e) => {
                  e.preventDefault();
                  void enter(digits.join(""));
                }}
              >
                <p className="text-[11px] tracking-[0.24em] text-grey-on-door uppercase">
                  Six digits
                </p>
                <p className="mt-3 truncate text-[13px] text-door-ink/70">Sent to {email}.</p>

                <div className="mt-5 flex gap-2" role="group" aria-label="Six-digit code">
                  {digits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        cells.current[i] = el;
                      }}
                      value={digit}
                      onChange={(e) => writeDigits(i, e.target.value)}
                      onKeyDown={(e) => onCellKeyDown(i, e)}
                      onFocus={(e) => e.currentTarget.select()}
                      inputMode="numeric"
                      // Focused on mount rather than in an effect: AnimatePresence
                      // waits for the email form to leave before these exist.
                      autoFocus={i === 0}
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
                      className="h-[3.25rem] w-full min-w-0 rounded-xl border border-door-ink/20 bg-door-ink/[0.04] text-center text-[19px] text-door-ink outline-none transition-colors focus:border-door-ink"
                    />
                  ))}
                </div>

                <FormError message={error} />

                <SubmitButton busy={busy} disabled={digits.some((d) => d === "")}>
                  {busy ? "CHECKING" : "CONTINUE"}
                </SubmitButton>

                <div className="mt-5 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setError(null);
                    }}
                    className="self-start rounded-sm text-[12px] text-door-ink/65 underline decoration-door-ink/25 transition-colors hover:text-door-ink"
                  >
                    Use another address
                  </button>

                  {!privyConfigured && (
                    <p className="text-[12px] leading-relaxed text-grey-on-door">
                      No Privy app id is set. Any six digits will do.
                    </p>
                  )}
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Crossing the threshold: the door is wiped away by the interior it opens
          onto — and the interior is always the opposite value, in either theme.
          app/(app)/layout.tsx picks the movement up on the far side. */}
      <AnimatePresence>
        {step === "arriving" && !reduceMotion && (
          <motion.div
            key="threshold"
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-50 bg-ground"
            initial={{ clipPath: "circle(0% at 50% 62%)" }}
            animate={{ clipPath: "circle(150% at 50% 62%)" }}
            transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Mounted only when an app id is set, so the hook always has its provider.
 * `useMemo` keeps the Auth identity stable across renders -- `enter` depends on
 * it, and a fresh object every render would rebuild the callback mid-typing.
 */
function PrivyDoor({ invite }: { invite: string | null }) {
  const { ready: privyReady, authenticated, getAccessToken, login } = usePrivy();
  const privy = useLoginWithEmail();
  const auth = useMemo(() => privyAuth(privy), [privy]);

  const { ready, wallets: detected } = useStandardWallets();
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws();

  /**
   * The wait the door performs before it sends anybody at an interior route.
   *
   * This is the half of the fix that only exists here: `Door` is shared with
   * the zero-env-var path, which has no Privy, no cookie and nothing to wait
   * for, so it receives no `awaitSession` and `serverSees` answers true
   * immediately. Only this branch has a server-side session to be out of step
   * with in the first place.
   */
  const waitForSession = useCallback(() => sessionVisible(getAccessToken), [getAccessToken]);

  /**
   * The one place the door gives up its own language, and only when staying in
   * it would mean offering nothing.
   *
   * Privy's sheet is scoped to the half the door cannot do itself -- wallets,
   * on this chain -- so the email field above it is not offered twice. Nothing
   * is passed back: a sheet that signs in flips `authenticated`, `alreadyIn`
   * follows, and the effect that already waits on the cookie does the arriving.
   */
  const handoff = useCallback(
    () => login({ loginMethods: ["wallet"], walletChainType: "solana-only" }),
    [login],
  );

  /**
   * Sign-In With Solana, by hand.
   *
   * Privy will run this behind its own modal, and the modal is the problem:
   * this door is mono on an inverted ground, and a generic dark sheet landing
   * on top of it reads as someone else's product. So the wallets are listed
   * in the door's own language and the three steps happen underneath --
   * connect, sign the message Privy generates, hand the signature back.
   *
   * The list comes from the Solana wallet-standard registry, which is how
   * Phantom announces itself. Nothing is hardcoded: whatever the member has
   * installed is what they are offered, and a member with none is told so.
   */
  const wallets = useMemo<WalletOption[]>(() => {
    if (!ready) return [];

    return detected
      .filter((w) => w.features["standard:connect"] && w.features["solana:signMessage"])
      /**
       * The registry contains more than installed extensions.
       *
       * Privy registers its own embedded wallet there, which would offer
       * "sign in with Privy" to somebody whose only other option is the Privy
       * email field directly above it. And it registers a WalletConnect
       * wallet, which needs a WalletConnect project id this app does not set
       * -- so it would open, wait, and fail.
       *
       * Both carry a marker at runtime that is not in the published types.
       * Reading them through a cast is uglier than matching on the name and
       * survives a rename, which the name does not.
       */
      .filter((w) => {
        const flags = w as unknown as {
          isPrivyWallet?: boolean;
          isWalletConnectSolana?: boolean;
        };
        return !flags.isPrivyWallet && !flags.isWalletConnectSolana;
      })
      .map((wallet) => ({
        name: wallet.name,
        icon: wallet.icon,
        connect: async () => {
          try {
            const { accounts } = await wallet.features["standard:connect"]!.connect();
            const account = accounts[0];
            if (!account) return `${wallet.name} did not offer an account.`;

            const message = await generateSiwsMessage({ address: account.address });
            const [signed] = await wallet.features["solana:signMessage"]!.signMessage({
              account,
              message: new TextEncoder().encode(message),
            });

            await loginWithSiws({
              // base64, NOT base58. Privy's own SIWS flow does
              // `base64.encode(signature)` -- the address beside it is base58,
              // which is what makes this worth a comment: the two encodings sit
              // one line apart in their code and only one of them is the one a
              // Solana signature is usually written in. Sending base58 is
              // accepted by the wallet, signed happily, and rejected by
              // /siws/authenticate as "Invalid SIWS message and/or nonce".
              signature: toBase64(signed.signature),
              message,
              walletClientType: wallet.name.toLowerCase().replace(/\s+/g, "_"),
              connectorType: "injected",
            });
            return null;
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);

            // Closing the wallet is the commonest path through here and is not
            // worth a sentence about signatures.
            if (/reject|denied|cancel|close/i.test(reason)) {
              return `${wallet.name} was closed before signing.`;
            }

            // Anything else is a fault worth naming. Swallowing it into "could
            // not sign in" costs a debugging round trip every time, and the
            // person who sees it is the person who can act on it.
            console.error(`[sign-in] ${wallet.name} failed`, e);
            return reason
              ? `${wallet.name}: ${reason.slice(0, 160)}`
              : `Could not sign in with ${wallet.name}.`;
          }
        },
      }));
  }, [ready, detected, generateSiwsMessage, loginWithSiws]);

  return (
    <Door
      auth={auth}
      privyConfigured
      wallets={wallets}
      handoff={handoff}
      invite={invite}
      alreadyIn={privyReady && authenticated}
      awaitSession={waitForSession}
    />
  );
}

export function FrontDoor({ invite }: { invite: string | null }) {
  return PRIVY_CONFIGURED ? (
    <PrivyDoor invite={invite} />
  ) : (
    <Door auth={MOCK_AUTH} privyConfigured={false} wallets={null} invite={null} />
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-door-ink">
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

function SubmitButton({
  busy,
  disabled,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className={cn(
        "mt-6 w-full rounded-full border border-transparent bg-door-ink py-3.5 text-[11px] tracking-[0.28em] text-door",
        "transition-[opacity,background-color,color,border-color] duration-200 hover:opacity-85",
        // Not a dimmed solid pill — that still out-shouts the field above it.
        // An outline reads as "not yet" without competing for the eye.
        "disabled:cursor-not-allowed disabled:border-door-ink/15 disabled:bg-transparent disabled:text-door-ink/40 disabled:hover:opacity-100",
      )}
    >
      {children}
    </button>
  );
}

function OrRule() {
  return (
    <div className="my-6 flex items-center gap-4">
      <span className="h-px flex-1 bg-door-ink/15" />
      <span className="text-[10px] tracking-[0.24em] text-grey-on-door uppercase">or</span>
      <span className="h-px flex-1 bg-door-ink/15" />
    </div>
  );
}

/**
 * The second door.
 *
 * Most people this is built for have never held a token, and the email field
 * above is for them -- a wallet gets made during sign-in and they are never
 * asked what one is. But a crew that already has Phantom should not be made to
 * go the long way round and then fund a second, empty wallet they would have
 * to top up separately.
 *
 * Every wallet the browser announces is listed here, in the door's own type
 * and on the door's own ground. Privy will do this behind its modal instead,
 * and the modal is a fine modal that belongs to a different product -- landing
 * it on this surface undoes the one thing the landing page is for.
 *
 * This slot used to hold a Google button that was deliberately dead, on the
 * grounds that a dead button someone presses on stage is worse than no button.
 * The reasoning stands and the conclusion flipped: there is something behind
 * it now.
 */
/**
 * Whether this is a touch device, read the way React wants an external value
 * read rather than assigned into state from an effect.
 *
 * The server has no pointer to report, so it answers false; the first client
 * paint agrees with it and is corrected in the same commit, which is why this
 * cannot produce a hydration mismatch. Nothing that depends on it is on screen
 * before START is pressed in any case.
 */
const COARSE_POINTER = "(pointer: coarse)";

function subscribeToPointer(onChange: () => void) {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  );
}

const WALLET_BUTTON =
  "flex w-full items-center justify-center gap-2.5 rounded-full border border-door-ink/25 py-3.5 text-door-ink transition-colors duration-200 hover:border-door-ink hover:bg-door-ink hover:text-door disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-door-ink/25 disabled:hover:bg-transparent disabled:hover:text-door-ink";

function WalletOptions({
  wallets,
  handoff,
  invite,
  onFailure,
  onSuccess,
}: {
  wallets: WalletOption[] | null;
  handoff?: () => void;
  invite: string | null;
  onFailure: (message: string) => void;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const path = walletPath(wallets, { mobile: useCoarsePointer() });

  if (path === "unconfigured") {
    return (
      <p className="text-center text-[12px] leading-relaxed text-grey-on-door">
        Connecting a wallet needs a Privy app id.
      </p>
    );
  }

  /**
   * Nothing announced itself: a phone, or a desktop with no extension. What
   * stood here was a sentence, and it was true in the only sense that did not
   * matter -- this browser has no wallet -- to a member holding Phantom on the
   * same device. Privy's sheet is the way to it, so the door offers that
   * instead of narrating a dead end.
   */
  if (path === "handoff") {
    return (
      <button type="button" onClick={handoff} className={WALLET_BUTTON}>
        <Wallet className="size-3.5" aria-hidden="true" />
        <span className="text-[13px] tracking-[0.04em]">Connect a wallet</span>
      </button>
    );
  }

  /**
   * A phone. Not a button that signs in -- a door out of this browser and into
   * Phantom's, which is the only place on a phone where a wallet can answer.
   * An anchor rather than an onClick because that is what it is, and because
   * the OS handles a real link to another app more reliably than script does.
   */
  if (path === "wallet-app") {
    return (
      <>
        <a href={phantomBrowseLink(window.location.href, invite)} className={WALLET_BUTTON}>
          <Wallet className="size-3.5" aria-hidden="true" />
          <span className="text-[13px] tracking-[0.04em]">Open in Phantom</span>
        </a>
        <p className="mt-3 text-center text-[12px] leading-relaxed text-grey-on-door">
          Phantom opens this page in its own browser, and you sign in there.
        </p>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {(wallets ?? []).map((wallet) => (
        <button
          key={wallet.name}
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(wallet.name);
            const failure = await wallet.connect();
            setBusy(null);
            // Signing in does not navigate on its own. Privy flips its auth
            // state and re-renders, and the door sits there looking like
            // nothing happened -- which is exactly what it did until this
            // line existed. The email path has always called this; the wallet
            // path has to as well.
            if (failure) onFailure(failure);
            else onSuccess();
          }}
          className={WALLET_BUTTON}
        >
          {wallet.icon ? (
            // The wallet's own mark, from its own registry entry. Next's Image
            // cannot take an arbitrary data: URI and there is nothing to
            // optimise about a 16px icon the browser already holds.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wallet.icon} alt="" aria-hidden="true" className="size-4 rounded-sm" />
          ) : (
            <Wallet className="size-3.5" aria-hidden="true" />
          )}
          <span className="text-[13px] tracking-[0.04em]">
            {busy === wallet.name ? "Waiting on the wallet" : wallet.name}
          </span>
        </button>
      ))}
    </div>
  );
}
