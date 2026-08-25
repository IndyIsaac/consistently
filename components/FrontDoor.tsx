"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Lock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * The dark front door. One line, one press, then the code — and then the white
 * world, which the app never leaves again.
 *
 * Privy is the real mechanism: email, then a six-digit code, no password and so
 * no 2FA. `NEXT_PUBLIC_PRIVY_APP_ID` is inlined at build time; with nothing to
 * call, `sendCode` and `verifyCode` below run their own timings and hand you the
 * dev mock session in lib/mock-session.ts instead.
 * ------------------------------------------------------------------------- */

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const PRIVY_CONFIGURED = PRIVY_APP_ID.length > 0;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_LENGTH = 6;

const NOT_WIRED =
  "An app id is set but the Privy provider is not mounted yet. Clear NEXT_PUBLIC_PRIVY_APP_ID to use the dev session.";

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves to an error string naming the problem, or null when the step succeeded. */
async function sendCode(email: string): Promise<string | null> {
  if (PRIVY_CONFIGURED) {
    // Real call goes here once <PrivyProvider> is mounted:
    //   await useLoginWithEmail().sendCode({ email })
    return NOT_WIRED;
  }
  if (!EMAIL_RE.test(email)) return "That is not an email address.";
  await pause(600);
  return null;
}

async function verifyCode(code: string): Promise<string | null> {
  if (PRIVY_CONFIGURED) {
    // Real call:  await useLoginWithEmail().loginWithCode({ code })
    return NOT_WIRED;
  }
  if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) return "That code is not six digits.";
  await pause(650);
  return null;
}

type Step = "rest" | "email" | "code" | "arriving";

const EMPTY_CODE = Array<string>(CODE_LENGTH).fill("");

export function FrontDoor() {
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

      const failure = await verifyCode(code);
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
    [reduceMotion, router],
  );

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const failure = await sendCode(email.trim());
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
    <div className="on-ink relative flex min-h-dvh flex-1 flex-col overflow-hidden overscroll-none bg-ink font-mono text-white">
      {/* The slot below the line reserves its tallest state, so the block never
          changes height and the line never moves when the panel opens. */}
      <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-[clamp(1.6rem,7.5vw,3rem)] leading-[1.1] font-medium tracking-[-0.03em] whitespace-nowrap text-white/65">
          Stay consistent<span className="text-white">.</span>
        </h1>

        <div className="mt-10 min-h-[17.5rem] max-w-[23rem]">
          <AnimatePresence mode="wait" initial={false}>
            {scene === "rest" && (
              <motion.div key="rest" {...sceneMotion}>
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="rounded-full border border-white/25 px-8 py-3.5 text-[11px] tracking-[0.32em] text-white transition-colors duration-200 hover:border-white hover:bg-white hover:text-ink"
                >
                  START
                </button>
              </motion.div>
            )}

            {scene === "email" && (
              <motion.form key="email" {...sceneMotion} onSubmit={submitEmail} noValidate>
                <label
                  htmlFor="email"
                  className="block text-[11px] tracking-[0.24em] text-grey-on-ink uppercase"
                >
                  Email
                </label>

                <div className="mt-3 flex items-center gap-2 border-b border-white/20 transition-colors focus-within:border-white">
                  <span aria-hidden="true" className="text-white/40 select-none">
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
                    className="w-full bg-transparent py-3 text-[15px] text-white outline-none placeholder:text-white/30"
                  />
                </div>

                <FormError message={error} />

                <SubmitButton busy={busy}>{busy ? "SENDING" : "CONTINUE"}</SubmitButton>
                <OrRule />
                <GoogleButton />
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
                <p className="text-[11px] tracking-[0.24em] text-grey-on-ink uppercase">
                  Six digits
                </p>
                <p className="mt-3 truncate text-[13px] text-white/70">Sent to {email}.</p>

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
                      className="h-[3.25rem] w-full min-w-0 rounded-xl border border-white/20 bg-white/[0.04] text-center text-[19px] text-white outline-none transition-colors focus:border-white"
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
                    className="self-start rounded-sm text-[12px] text-white/50 underline decoration-white/25 transition-colors hover:text-white"
                  >
                    Use another address
                  </button>

                  {!PRIVY_CONFIGURED && (
                    <p className="text-[12px] leading-relaxed text-grey-on-ink">
                      No Privy app id is set. Any six digits will do.
                    </p>
                  )}
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Crossing the threshold: the black door is wiped away by the white world
          it opens onto. app/(app)/layout.tsx picks the movement up on the far side. */}
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

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-white">
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
        "mt-6 w-full rounded-full border border-transparent bg-white py-3.5 text-[11px] tracking-[0.28em] text-ink",
        "transition-[opacity,background-color,color,border-color] duration-200 hover:opacity-85",
        // Not a dimmed white pill — that still out-shouts the field above it.
        // An outline reads as "not yet" without competing for the eye.
        "disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-transparent disabled:text-white/40 disabled:hover:opacity-100",
      )}
    >
      {children}
    </button>
  );
}

function OrRule() {
  return (
    <div className="my-6 flex items-center gap-4">
      <span className="h-px flex-1 bg-white/15" />
      <span className="text-[10px] tracking-[0.24em] text-grey-on-ink uppercase">or</span>
      <span className="h-px flex-1 bg-white/15" />
    </div>
  );
}

/**
 * Google is not wired and will not be. It is rendered visibly unavailable rather
 * than live: a dead button someone presses on stage is worse than no button.
 */
function GoogleButton() {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title="Google sign-in is not wired and will not be."
      className="flex w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-full border border-dashed border-white/20 py-3.5 text-white/55"
    >
      <Lock className="size-3.5" aria-hidden="true" />
      <span className="text-[13px] tracking-[0.04em]">Google</span>
      <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">not wired</span>
    </button>
  );
}
