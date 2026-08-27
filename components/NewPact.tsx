"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { DashedRule, FIELD, FieldLabel, Panel } from "@/components/Panel";
import { Select } from "@/components/Select";
import { RuleEditor } from "@/components/RuleEditor";
import { currencySymbol } from "@/lib/money";
import { ruleSentence } from "@/lib/pact-view";
import type { RuleConfig } from "@/lib/rules";

/* ---------------------------------------------------------------------------
 * Starting a crew.
 *
 * One of these gets agreed in a group chat, in one message: "gym five days a
 * week, thirty minutes, photo in and out, a thousand baht if you miss." So
 * that is what this asks for. The draft comes back as a rule, the rule is
 * shown as a sentence, and the fields underneath are there for the parts it
 * got wrong.
 *
 * Typing it out is optional in both directions -- somebody who would rather
 * fill in seven fields can go straight there, and the draft never commits
 * anything until they have read it back.
 * ------------------------------------------------------------------------- */

const DEFAULT_RULE: RuleConfig = {
  cadence: 5,
  period: "week",
  sessionType: "checkin_checkout",
  minDurationMins: 30,
  windowStart: "05:00",
  windowEnd: "22:00",
  proof: "photo",
  failsWhenMissedExceeds: 0,
  split: "equal",
  exemption: "majority",
  durationPeriods: 12,
};

const CURRENCIES = ["THB", "USD", "GBP", "EUR", "JPY"];

const EXAMPLE = "Gym five days a week, thirty minutes minimum, photo in and photo out. ฿1,000 if you miss.";

export function NewPact() {
  const router = useRouter();
  const { getAccessToken } = usePrivy();

  const [step, setStep] = useState<"describe" | "review">("describe");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [rule, setRule] = useState<RuleConfig>(DEFAULT_RULE);
  const [stakeAmount, setStakeAmount] = useState(1000);
  const [stakeCurrency, setStakeCurrency] = useState("THB");

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rules/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = await res.json();

      if (!res.ok) {
        // Drafting is a convenience, never the only way through. Say what
        // happened and open the fields rather than trapping anyone here.
        setError(`${body.error ?? "Could not draft that."} Set it up by hand instead.`);
        setStep("review");
        return;
      }

      setName(body.name);
      setRule(body.ruleConfig);
      setStakeAmount(body.stakeAmount);
      setStakeCurrency(body.stakeCurrency);
      setStep("review");
    } catch {
      setError("Could not reach the drafter. Set it up by hand instead.");
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/pacts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          ruleConfig: rule,
          stakeAmount,
          stakeCurrency,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create that pact.");
        return;
      }
      // Straight into the channel with the code already up. Not `?invite=` --
      // the proxy claims that parameter on every path as a scanned invite.
      router.push(`/pacts/${body.id}?show=invite`);
    } catch {
      setError("Could not create that pact.");
    } finally {
      setBusy(false);
    }
  }

  const windowInvalid = rule.windowStart >= rule.windowEnd;
  const canCreate = name.trim().length > 0 && stakeAmount > 0 && !windowInvalid && !busy;

  return (
    <div className="mx-auto w-full max-w-[40rem] px-5 pt-10 sm:px-8 sm:pt-14">
      <h1 className="text-[clamp(2rem,7vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.035em] text-ink">
        A rule and a number.
      </h1>
      <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-grey-on-ground">
        That is the whole of a pact. Say it the way you would say it to the crew.
      </p>

      {step === "describe" ? (
        <Panel className="mt-9">
          <FieldLabel>In your own words</FieldLabel>
          <textarea
            autoFocus
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={EXAMPLE}
            className="mt-3 w-full resize-none rounded-[20px] bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink transition-colors placeholder:text-grey-on-surface"
          />

          <Failure message={error} />

          <button
            type="button"
            disabled={description.trim().length < 10 || busy}
            onClick={draft}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3.5 text-[12px] tracking-[0.24em] text-ground uppercase transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-grey-on-ground disabled:ring-1 disabled:ring-hairline disabled:hover:opacity-100"
          >
            {busy ? "Reading it" : "Turn it into a rule"}
            {!busy && <ArrowRight className="size-3.5" aria-hidden="true" />}
          </button>

          <button
            type="button"
            onClick={() => setStep("review")}
            className="mt-5 block w-full text-center text-[13px] text-grey-on-ground underline decoration-hairline underline-offset-4 transition-colors hover:text-ink"
          >
            Set it up by hand
          </button>
        </Panel>
      ) : (
        <>
          <Panel className="mt-9">
            <FieldLabel>The rule</FieldLabel>
            <p className="mt-3 text-[16px] leading-relaxed text-ink">{ruleSentence(rule)}</p>
            <p className="mt-1 text-[14px] text-grey-on-ground">
              {currencySymbol(stakeCurrency)}
              {stakeAmount.toLocaleString("en-US")} each, every {rule.period}.
            </p>

            <DashedRule className="mt-6" />

            <div className="mt-2 divide-y divide-hairline">
              <label className="flex items-center justify-between gap-4 py-3">
                <span className="text-[14px] text-grey-on-ground">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 80))}
                  placeholder="Five a week"
                  className={`${FIELD} min-w-0 flex-1 text-right`}
                />
              </label>

              <label className="flex items-center justify-between gap-4 py-3">
                <span className="text-[14px] text-grey-on-ground">Stake each</span>
                <span className="flex items-center gap-2">
                  {/* Typed, not stepped: a stake is ฿1,000 or £20, and a
                      control that moves it by one would be a joke. The native
                      spinner is off globally -- see app/globals.css. */}
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    value={stakeAmount}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) setStakeAmount(n);
                    }}
                    className={`${FIELD} figure w-28 text-right`}
                  />
                  <Select
                    value={stakeCurrency}
                    onChange={(e) => setStakeCurrency(e.target.value)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </span>
              </label>
            </div>

            <RuleEditor value={rule} onChange={setRule} />
          </Panel>

          <Failure message={error} />

          <button
            type="button"
            disabled={!canCreate}
            onClick={create}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3.5 text-[12px] tracking-[0.24em] text-ground uppercase transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-grey-on-ground disabled:ring-1 disabled:ring-hairline disabled:hover:opacity-100"
          >
            {busy ? "Making it" : "Start the crew"}
          </button>

          <p className="mt-4 text-center text-[13px] leading-relaxed text-grey-on-ground">
            Nothing moves until everyone has staked. You will get a code to hand round next.
          </p>
        </>
      )}
    </div>
  );
}

function Failure({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-ink">
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
