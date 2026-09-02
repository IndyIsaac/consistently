import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { CrewOverview } from "@/components/CrewOverview";
import { DashedRule, FieldLabel, Panel } from "@/components/Panel";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/session";
import { spell } from "@/lib/pact-view";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard · Consistently" };

function FirstRun() {
  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-10 sm:px-8 sm:pt-14">
      <h1 className="text-[clamp(2rem,7vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.035em] text-balance text-ink">
        Nothing at stake yet.
      </h1>

      <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-grey-on-ground">
        A crew agrees one rule and everyone puts the same money up. Whoever
        misses forfeits it to whoever did not, and nobody has to ask.
      </p>

      <Panel className="mt-9 max-w-[34rem]">
        <FieldLabel>Two ways in</FieldLabel>

        <div className="mt-4 flex flex-col gap-1">
          <p className="text-[15px] text-ink">Agree the rule yourself.</p>
          <p className="max-w-[40ch] text-[14px] leading-relaxed text-grey-on-ground">
            You set what counts and what it costs, then hand round a code.
          </p>
        </div>

        <Link
          href="/pacts/new"
          className="mt-5 inline-flex items-center justify-center rounded-full bg-ink px-7 py-3 text-[12px] tracking-[0.24em] text-ground uppercase transition-opacity hover:opacity-85"
        >
          Start a crew
        </Link>

        <DashedRule className="mt-7" />

        <div className="mt-5 flex flex-col gap-1">
          <p className="text-[15px] text-ink">Or somebody sends you a code.</p>
          <p className="max-w-[40ch] text-[14px] leading-relaxed text-grey-on-ground">
            Scanning it puts you in their crew, and asks you for your stake.
          </p>
        </div>
      </Panel>
    </div>
  );
}

/**
 * The one thing this page is ever told by the route that sent somebody here.
 *
 * app/join/route.ts redeems an invite and, when it cannot, redirects to
 * `/dashboard?crew=closed` -- a pact that has already started refuses new
 * members by design. Nothing read that parameter. A member who scanned a
 * crew's code and did everything right landed on their own empty dashboard
 * with no crew, no error, and nothing on screen connecting the two.
 *
 * The refusal is correct. Being silent about it was not.
 */
function CrewClosed() {
  return (
    <p
      role="status"
      className="mx-auto mt-6 flex w-full max-w-[54rem] items-start gap-2 px-5 text-[14px] leading-relaxed text-grey-on-ground sm:px-8"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      That crew has already started, so it is closed to new members. Ask them to
      set up a new one and send you the code before anybody stakes.
    </p>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ crew?: string }>;
}) {
  const [{ now, currency, pacts }, query] = await Promise.all([getSession(), searchParams]);
  const crewClosed = query.crew === "closed";

  /**
   * The first screen after the door, for somebody who has just arrived.
   *
   * Everything below assumes a crew: `Math.max()` over no pacts is -Infinity,
   * the money figures are zero in the two colours reserved for money that
   * moved, and the crew list is a table of nothing.
   * A ledger of nothing is a worse greeting than a sentence saying what this
   * is for.
   */
  if (pacts.length === 0)
    return (
      <>
        {crewClosed && (
          <div className="mx-auto w-full max-w-[54rem] px-5 pt-6 sm:px-8">
            <CrewClosed />
          </div>
        )}
        <FirstRun />
      </>
    );

  const earned = pacts.reduce((sum, p) => sum + p.viewerEarned, 0);
  const lost = pacts.reduce((sum, p) => sum + p.viewerLost, 0);
  const net = earned - lost;
  const onThisWeek = pacts.reduce((sum, p) => sum + p.stakeAmount, 0);
  const settled = Math.max(...pacts.map((p) => p.settledPeriods));

  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-10 sm:px-8 sm:pt-14">
      {/* Also here, not only above the empty state. Somebody already in two
          crews who scans a third one's code after it has started is the
          likeliest person to hit this, and they were the one it did not
          tell. */}
      {crewClosed && <CrewClosed />}

      <h1 className="text-[clamp(2rem,7vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.035em] text-balance text-ink">
        {net === 0 ? (
          "You are square."
        ) : (
          <>
            You are{" "}
            <span className={cn("figure", net > 0 ? "text-earned" : "text-owed")}>
              {formatMoney(net, currency)}
            </span>{" "}
            {net > 0 ? "up" : "down"}.
          </>
        )}
      </h1>

      <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-grey-on-ground">
        {/* Counted, not assumed. With one crew this read "Five weeks settled
            across one crews", which is the sort of thing a demo audience reads
            before anything else on the page. */}
        {spell(settled)} {settled === 1 ? "week" : "weeks"} settled across{" "}
        {spell(pacts.length).toLowerCase()} {pacts.length === 1 ? "crew" : "crews"}.{" "}
        {formatMoney(onThisWeek, currency)} rides on this one.
      </p>

      <div className="mt-9 grid grid-cols-2 border-y border-hairline">
        <div className="py-5 pr-5">
          <FieldLabel>Earned</FieldLabel>
          <p className="figure mt-2 text-[clamp(1.75rem,6vw,2.25rem)] leading-none font-extrabold text-earned">
            {formatMoney(earned, currency)}
          </p>
        </div>
        <div className="border-l border-hairline py-5 pl-5">
          <FieldLabel>Lost</FieldLabel>
          <p className="figure mt-2 text-[clamp(1.75rem,6vw,2.25rem)] leading-none font-extrabold text-owed">
            {formatMoney(lost, currency)}
          </p>
        </div>
      </div>

      <p className="mt-4 text-[13px] text-grey-on-ground">
        Nobody was asked for any of it.
      </p>

      <CrewOverview pacts={pacts} now={now} />
    </div>
  );
}
