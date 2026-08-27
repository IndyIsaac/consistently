"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLoginWithEmail, useLoginWithSiws } from "@privy-io/react-auth";
import { useStandardWallets } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { TriangleAlert, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

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

type Step = "rest" | "email" | "code" | "arriving";

const EMPTY_CODE = Array<string>(CODE_LENGTH).fill("");

function Door({
  auth,
  privyConfigured,
  wallets,
}: {
  auth: Auth;
  privyConfigured: boolean;
  /** Null when there is no Privy app. Empty when nothing is installed. */
  wallets: WalletOption[] | null;
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

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

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

      setStep("arriving");
      setTimeout(() => router.push("/dashboard"), reduceMotion ? 0 : 620);
    },
    [auth, reduceMotion, router],
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
                <WalletOptions wallets={wallets} onFailure={setError} />
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
function PrivyDoor() {
  const privy = useLoginWithEmail();
  const auth = useMemo(() => privyAuth(privy), [privy]);

  const { ready, wallets: detected } = useStandardWallets();
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws();

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
              signature: bs58.encode(signed.signature),
              message,
              walletClientType: wallet.name.toLowerCase().replace(/\s+/g, "_"),
              connectorType: "injected",
            });
            return null;
          } catch (e) {
            // Closing the wallet is the commonest path through here and is not
            // worth a sentence about signatures.
            const reason = e instanceof Error ? e.message : "";
            return /reject|denied|cancel|close/i.test(reason)
              ? `${wallet.name} was closed before signing.`
              : `Could not sign in with ${wallet.name}.`;
          }
        },
      }));
  }, [ready, detected, generateSiwsMessage, loginWithSiws]);

  return <Door auth={auth} privyConfigured wallets={wallets} />;
}

export function FrontDoor() {
  return PRIVY_CONFIGURED ? (
    <PrivyDoor />
  ) : (
    <Door auth={MOCK_AUTH} privyConfigured={false} wallets={null} />
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
function WalletOptions({
  wallets,
  onFailure,
}: {
  wallets: WalletOption[] | null;
  onFailure: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (wallets === null) {
    return (
      <p className="text-center text-[12px] leading-relaxed text-grey-on-door">
        Connecting a wallet needs a Privy app id.
      </p>
    );
  }

  if (wallets.length === 0) {
    return (
      <p className="text-center text-[12px] leading-relaxed text-grey-on-door">
        No Solana wallet in this browser. The line above makes you one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {wallets.map((wallet) => (
        <button
          key={wallet.name}
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(wallet.name);
            const failure = await wallet.connect();
            setBusy(null);
            if (failure) onFailure(failure);
            // Success needs no branch: Privy's state change re-renders the tree
            // and app/(app)/layout.tsx decides where they land.
          }}
          className="flex w-full items-center justify-center gap-2.5 rounded-full border border-door-ink/25 py-3.5 text-door-ink transition-colors duration-200 hover:border-door-ink hover:bg-door-ink hover:text-door disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-door-ink/25 disabled:hover:bg-transparent disabled:hover:text-door-ink"
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
