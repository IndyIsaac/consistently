import type { CadenceOutlook, RuleConfig } from "@/lib/rules";

/* ---------------------------------------------------------------------------
 * The bot's voice, in one place.
 *
 * Every sentence the channel's bot says is built here, and nowhere else — the
 * API routes that write feed rows and the screen that answers slash commands
 * both call these, so the bot cannot drift into two voices. Pure functions over
 * plain numbers and already-formatted strings: nothing here reads a clock, a
 * database or the palette.
 *
 * Dry, deadpan, faintly savage, per PRODUCT.md and DESIGN.md. It states the
 * record and lets the numbers do the damage. No exclamation marks. No emoji —
 * those belong to members' reactions. It never congratulates and never scolds.
 * ------------------------------------------------------------------------- */

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];

const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

/**
 * Small counts read better as words than as digits inside a sentence — "Sixteen
 * to go" rather than "16 to go". Past ninety-nine the word is longer than the
 * fact, so the digits come back.
 *
 * Money and durations are never spelled: `฿1,000` and `47 minutes` are figures,
 * and a figure is what the reader is meant to weigh.
 */
export function spellNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 20) return ONES[n];
  const ten = TENS[Math.floor(n / 10)];
  const one = n % 10;
  return one === 0 ? ten : `${ten}-${ONES[one]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Three days" / "One day" / "No days". */
function days(n: number): string {
  return n === 0 ? "No days" : cap(`${spellNumber(n)} ${n === 1 ? "day" : "days"}`);
}

// --- what the bot says when a member acts -----------------------------------

/** The `checkin` feed row, written by the sessions route and by the mock. */
export function checkedInLine(name: string): string {
  return `${name} checked in.`;
}

/** The `checkout` feed row. "Nat checked out. 47 minutes." */
export function checkedOutLine(name: string, durationMins: number): string {
  return `${name} checked out. ${plural(durationMins, "minute", "minutes")}.`;
}

/**
 * The refusal, said at the moment the check-out is attempted rather than
 * recorded and judged days later at settlement. Finding out now is the point.
 *
 * Precondition: `elapsedMins < minDurationMins` — the caller has already
 * decided the session is short. "That's 14 minutes. The pact says 30. Sixteen
 * to go."
 */
export function earlyCheckoutRefusal(elapsedMins: number, minDurationMins: number): string {
  const remaining = Math.max(0, minDurationMins - elapsedMins);
  return `That’s ${plural(elapsedMins, "minute", "minutes")}. The pact says ${minDurationMins}. ${cap(
    spellNumber(remaining),
  )} to go.`;
}

// --- where a member stands --------------------------------------------------

/**
 * One line of standing, from the outlook and nothing else. Neutral and factual
 * while the cadence is still reachable; the moment it is not, it says so.
 */
export function outlookLine(outlook: CadenceOutlook): string {
  if (outlook.met) return "Made. Nothing else owed.";
  if (outlook.outOfReach) {
    return `${days(outlook.daysAvailable)} left, ${spellNumber(
      outlook.daysNeeded,
    )} to go. That is not going to happen.`;
  }
  return `${days(outlook.daysAvailable)} left. ${cap(spellNumber(outlook.daysNeeded))} to go.`;
}

/** A crew row for `/crew`. "Dave — 1 of 5. Three days left, four to go. That is not going to happen." */
export function crewStandingLine(
  name: string,
  daysDone: number,
  required: number,
  outlook: CadenceOutlook,
): string {
  return `${name} — ${daysDone} of ${required}. ${outlookLine(outlook)}`;
}

/**
 * The verdict. Said in the channel the moment the arithmetic closes, not at
 * settlement: the day that took it away, the cadence that is now gone, and what
 * it costs when the period ends.
 *
 * `name` is null for the viewer, who is addressed without being named.
 */
export function outOfReachVerdict(params: {
  name: string | null;
  cadence: number;
  dayClosed: string;
  stake: string;
  settlesOn: string;
}): string {
  const whose = params.name === null ? "" : ` for ${params.name}`;
  return `${params.dayClosed} gone. ${cap(spellNumber(params.cadence))} is out of reach${whose} now. ${
    params.stake
  } settles ${params.settlesOn}.`;
}

// --- the slash commands -----------------------------------------------------

/** Name, description. The order they are listed in and the order they are answered in. */
export const COMMANDS: { name: string; hint: string }[] = [
  { name: "status", hint: "where you are this period" },
  { name: "crew", hint: "everyone's standing" },
  { name: "stake", hint: "what is riding on it" },
  { name: "invite", hint: "the code to hand round" },
  { name: "exempt", hint: "ask to be let off" },
  { name: "settle", hint: "close the period and move the money" },
  { name: "help", hint: "this" },
];

export function helpReply(): string {
  return [
    `${cap(spellNumber(COMMANDS.length))} commands. Nothing else is a message.`,
    ...COMMANDS.map((c) => `/${c.name}${c.name === "exempt" ? " <reason>" : ""} — ${c.hint}`),
  ].join("\n");
}

/**
 * What the bot says to something that is not a command. A dry correction, not an
 * error: the input already refuses free text, so this is only reached by typing
 * a command that does not exist.
 */
export function unknownCommandReply(typed: string): string {
  return `There is no /${typed}. /help lists the ${spellNumber(COMMANDS.length)} there are.`;
}

/** What the bot knows about one member when it answers a command. */
export type BotMember = {
  name: string;
  daysDone: number;
  outlook: CadenceOutlook;
  isViewer: boolean;
};

/** What the bot knows about the pact. Money arrives already formatted. */
export type BotPact = {
  rule: RuleConfig;
  /** Each member's stake, e.g. "฿1,000". */
  stake: string;
  /** Every staked member's stake together, e.g. "฿4,000". */
  pot: string;
  /** The crew-local day the period ends on, e.g. "Sunday". */
  settlesOn: string;
  crew: BotMember[];
  viewerEarned: string;
  viewerLost: string;
};

export function statusReply(pact: BotPact): string {
  const me = pact.crew.find((m) => m.isViewer);
  if (!me) return "You are not staked in this pact.";
  return `${me.daysDone} of ${pact.rule.cadence} this ${pact.rule.period}. ${outlookLine(
    me.outlook,
  )}`;
}

export function crewReply(pact: BotPact): string {
  return pact.crew
    .map((m) => crewStandingLine(m.name, m.daysDone, pact.rule.cadence, m.outlook))
    .join("\n");
}

export function stakeReply(pact: BotPact): string {
  const staked = pact.crew.length;
  const lines = [
    `${pact.stake} each. ${cap(spellNumber(staked))} staked, ${pact.pot} in the vault.`,
    `It settles ${pact.settlesOn}. Whoever misses pays whoever did not.`,
  ];
  const out = pact.crew.filter((m) => m.outlook.outOfReach).map((m) => m.name);
  if (out.length > 0) {
    lines.push(
      `${out.join(" and ")} ${out.length === 1 ? "is" : "are"} already past saving ${
        out.length === 1 ? "it" : "them"
      }.`,
    );
  }
  lines.push(`You have taken ${pact.viewerEarned} out of this pact and lost ${pact.viewerLost}.`);
  return lines.join("\n");
}

export function inviteReply(): string {
  return "The code is up. Scanning it opens the sign-in with this invite attached.";
}

/** The `exemption_request` feed row. Mirrors app/api/pacts/[id]/exemptions/route.ts. */
export function exemptionRequestLine(name: string, reason: string): string {
  return `${name} is asking to be let off: "${reason.slice(0, 140)}"`;
}

/** What the bot adds once an exemption is open: who decides, and how many of them. */
export function exemptionOpenedReply(eligible: number, needed: number): string {
  return `Put to the crew. ${cap(spellNumber(eligible))} ${
    eligible === 1 ? "other votes" : "others vote"
  }, ${spellNumber(needed)} ${needed === 1 ? "has" : "have"} to say yes.`;
}

/** The dry correction for `/exempt` with nothing after it. */
export function exemptNeedsReasonReply(): string {
  return "/exempt takes a reason. /exempt food poisoning.";
}

/** Said the moment a member's cadence is covered. "Nat is done. Five of five." */
export function cadenceMetLine(name: string, cadence: number): string {
  return `${name} is done. ${cap(spellNumber(cadence))} of ${spellNumber(cadence)}.`;
}

/**
 * What the bot says while a settlement is on chain.
 *
 * There is no scheduler in this build, so a period ends when the crew says it
 * ends. `/settle` is safe to run twice: who failed is computed from the
 * sessions rather than from whoever typed it, and the settlement row is a
 * mutex, so a second run resumes an interrupted one rather than paying anyone
 * again.
 */
export function settlingLine(): string {
  return "Closing the period. Working out who owes what.";
}

export function settledLine(params: { failed: number; potUsdc: string }): string {
  if (params.failed === 0) return "Everyone made it. Nobody paid a thing.";
  return `${cap(spellNumber(params.failed))} missed. Their stakes are on their way to everyone who did not.`;
}

export function settleFailedLine(reason: string): string {
  return `The settlement did not finish. ${reason}`;
}
