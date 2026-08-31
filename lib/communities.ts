/* ---------------------------------------------------------------------------
 * Communities — the browse surface, hardcoded.
 *
 * PRODUCT.md's crews are invite-only by design: a pact is reached with a QR
 * code and nothing else, and `GET /api/pacts` was deliberately narrowed to the
 * caller's own rows. None of that is changed here. This is a separate,
 * read-only directory that sits in front of that flow — somewhere a member who
 * has nobody to be invited by can find a rule already running and ask in.
 *
 * Everything below is fixture data. There is no database behind it, no API
 * route, and no Prisma model: the demo needs a populated shelf, and inventing
 * one in the schema would collide with work happening on the same branch. When
 * this becomes real, this file is the shape to write the migration against.
 *
 * Numbers are plausible and small. PRODUCT.md is explicit that there are no
 * users beyond the builder's own two groups, so nothing here claims a crowd:
 * the largest community is thirty-one people, which is the run club in the
 * spec, and the smallest is four.
 * ------------------------------------------------------------------------- */

export type CommunityCategory =
  | "gym"
  | "running"
  | "martial-arts"
  | "pilates"
  | "sleep"
  | "nutrition"
  | "study";

/** The filter row, in the order it is drawn. `null` is "everything". */
export const CATEGORIES: { key: CommunityCategory; label: string }[] = [
  { key: "gym", label: "Gym" },
  { key: "running", label: "Running" },
  { key: "martial-arts", label: "Martial arts" },
  { key: "pilates", label: "Pilates" },
  { key: "sleep", label: "Sleep" },
  { key: "nutrition", label: "Food" },
  { key: "study", label: "Study" },
];

/** What a category is called in a sentence. Falls back to the key it was given. */
export function categoryLabel(key: CommunityCategory): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export type ChallengeStatus = "open" | "running" | "full";

export type Challenge = {
  id: string;
  name: string;
  /** One sentence, in the product's voice. What you are agreeing to. */
  rule: string;
  /** "Five days a week", "Every day". Reads under the name. */
  cadence: string;
  proof: "photo" | "self_attest";
  stakeAmount: number;
  stakeCurrency: string;
  members: number;
  status: ChallengeStatus;
  /** Null once it is running. "Monday" while it is still filling. */
  startsIn: string | null;
  /** What the crew has already put in, in the challenge's own currency. */
  pot: number;
};

export type Community = {
  slug: string;
  name: string;
  category: CommunityCategory;
  /** Where the rule is actually kept. A gym has an address; sleep does not. */
  location: string;
  blurb: string;
  members: number;
  /** Initials for the avatar stack. Four at most — the row clips past that. */
  crew: string[];
  currency: string;
  /**
   * Overrides the category's own photo. Unset on every community here, because
   * there is currently one per category — set it the moment there are two
   * gyms, or they will wear the same picture.
   */
  cover?: string;
  challenges: Challenge[];
};

/* Photos live in public/community-photos and are named for the category, so a
   new community needs no image work until it shares a category with another.
   All of them are Unsplash, whose licence permits this use; see the CREDITS
   file beside them for the photographer of each. */

export function coverFor(community: Community): string {
  return community.cover ?? `/community-photos/${community.category}.jpg`;
}

/**
 * A check-in photo that matches what the crew actually does.
 *
 * The poll used to show a treadmill whatever the community was, which reads as
 * a placeholder the moment it appears under a pilates studio.
 */
export function checkInPhotoFor(category: CommunityCategory): string {
  return `/community-photos/checkin-${category}.jpg`;
}

export const COMMUNITIES: Community[] = [
  {
    slug: "sathorn-strength",
    name: "Sathorn Strength",
    category: "gym",
    location: "Sathorn, Bangkok",
    blurb:
      "An office crew that has been going five days a week since April. The ledger used to be a pinned message.",
    members: 12,
    crew: ["IN", "NA", "DV", "PK"],
    currency: "THB",
    challenges: [
      {
        id: "sathorn-5day",
        name: "Five days, thirty minutes",
        rule: "In the gym five days a week. Thirty minutes minimum, checked in and checked out with a photo.",
        cadence: "Five days a week",
        proof: "photo",
        stakeAmount: 1000,
        stakeCurrency: "THB",
        members: 6,
        status: "open",
        startsIn: "Monday",
        pot: 4000,
      },
      {
        id: "sathorn-leg",
        name: "Legs, twice",
        rule: "Two leg sessions a week. Nobody is checking which lifts. The photo is the proof.",
        cadence: "Twice a week",
        proof: "photo",
        stakeAmount: 500,
        stakeCurrency: "THB",
        members: 9,
        status: "running",
        startsIn: null,
        pot: 4500,
      },
    ],
  },
  {
    slug: "lumpini-runners",
    name: "Lumpini Runners",
    category: "running",
    location: "Lumphini Park, Bangkok",
    blurb:
      "Six in the morning, before it gets unbearable. Thirty-one people, most of whom have never spoken.",
    members: 31,
    crew: ["AR", "TP", "JS", "MO"],
    currency: "THB",
    challenges: [
      {
        id: "lumpini-dawn",
        name: "Out the door by six",
        rule: "A run started before 06:30, four mornings a week. A photo at the park gate counts.",
        cadence: "Four mornings a week",
        proof: "photo",
        stakeAmount: 800,
        stakeCurrency: "THB",
        members: 14,
        status: "running",
        startsIn: null,
        pot: 11200,
      },
      {
        id: "lumpini-10k",
        name: "Ten kilometres, once",
        rule: "One ten-kilometre run a week. Photograph the watch, not the view.",
        cadence: "Once a week",
        proof: "photo",
        stakeAmount: 1500,
        stakeCurrency: "THB",
        members: 8,
        status: "open",
        startsIn: "Sunday",
        pot: 6000,
      },
    ],
  },
  {
    slug: "eight-limbs",
    name: "Eight Limbs Muay Thai",
    category: "martial-arts",
    location: "Phra Khanong, Bangkok",
    blurb:
      "Two sessions a week and the pads do not care how the week went. Fighters and office workers, same rule.",
    members: 18,
    crew: ["KT", "SW", "BN", "RE"],
    currency: "THB",
    challenges: [
      {
        id: "limbs-twice",
        name: "Twice on the pads",
        rule: "Two sessions a week at the gym. Sixty minutes minimum, wrapped hands in the photo.",
        cadence: "Twice a week",
        proof: "photo",
        stakeAmount: 1200,
        stakeCurrency: "THB",
        members: 11,
        status: "running",
        startsIn: null,
        pot: 13200,
      },
      {
        id: "limbs-clinch",
        name: "Saturday clinch",
        rule: "Saturday clinch class. One a week, and there is only one Saturday.",
        cadence: "Once a week",
        proof: "photo",
        stakeAmount: 600,
        stakeCurrency: "THB",
        members: 6,
        status: "full",
        startsIn: null,
        pot: 3600,
      },
    ],
  },
  {
    slug: "reformer-club",
    name: "Reformer Club",
    category: "pilates",
    location: "Thonglor, Bangkok",
    blurb: "Classes are booked a week out and cancelled the morning of. This is about the cancelling.",
    members: 9,
    crew: ["EL", "MI", "CH"],
    currency: "THB",
    challenges: [
      {
        id: "reformer-three",
        name: "Three classes",
        rule: "Three reformer classes a week. A photo of the machine you were on.",
        cadence: "Three times a week",
        proof: "photo",
        stakeAmount: 900,
        stakeCurrency: "THB",
        members: 7,
        status: "open",
        startsIn: "Monday",
        pot: 6300,
      },
    ],
  },
  {
    slug: "up-at-five",
    name: "Up At Five",
    category: "sleep",
    location: "Anywhere",
    blurb:
      "No gym, no equipment, nowhere to go. A photograph of a clock and a face that is clearly awake.",
    members: 24,
    crew: ["DN", "VI", "LO", "SA"],
    currency: "USD",
    challenges: [
      {
        id: "five-am",
        name: "Awake at five",
        rule: "A photo between 05:00 and 05:30, six mornings a week. The clock has to be in the shot.",
        cadence: "Six mornings a week",
        proof: "photo",
        stakeAmount: 40,
        stakeCurrency: "USD",
        members: 16,
        status: "running",
        startsIn: null,
        pot: 640,
      },
      {
        id: "lights-out",
        name: "Lights out by ten",
        rule: "Phone down, lights off, photographed before 22:15. Five nights a week.",
        cadence: "Five nights a week",
        proof: "photo",
        stakeAmount: 25,
        stakeCurrency: "USD",
        members: 8,
        status: "open",
        startsIn: "Sunday",
        pot: 200,
      },
    ],
  },
  {
    slug: "no-eating-out",
    name: "No Eating Out",
    category: "nutrition",
    location: "Anywhere",
    blurb:
      "Cooked, photographed, eaten. The rule is not about calories and nobody is counting them.",
    members: 15,
    crew: ["PU", "JO", "AM"],
    currency: "GBP",
    challenges: [
      {
        id: "cooked-five",
        name: "Cook five dinners",
        rule: "Five dinners a week cooked at home. Photograph the plate before it is eaten.",
        cadence: "Five days a week",
        proof: "photo",
        stakeAmount: 30,
        stakeCurrency: "GBP",
        members: 10,
        status: "running",
        startsIn: null,
        pot: 300,
      },
      {
        id: "bulk-4",
        name: "Four meals, bulking",
        rule: "Four logged meals a day while bulking. A photo of each, and the fourth is the one that gets missed.",
        cadence: "Every day",
        proof: "photo",
        stakeAmount: 50,
        stakeCurrency: "GBP",
        members: 5,
        status: "open",
        startsIn: "Monday",
        pot: 250,
      },
    ],
  },
  {
    slug: "november-cfa",
    name: "November CFA",
    category: "study",
    location: "Anywhere",
    blurb:
      "Sitting Level One in November. Two hours a day, six days a week, and the exam does not move.",
    members: 4,
    crew: ["IN", "PC"],
    currency: "THB",
    challenges: [
      {
        id: "cfa-two-hours",
        name: "Two hours a day",
        rule: "Two hours of study, six days a week. Check in and check out — the clock is the proof.",
        cadence: "Six days a week",
        proof: "photo",
        stakeAmount: 1000,
        stakeCurrency: "THB",
        members: 4,
        status: "running",
        startsIn: null,
        pot: 4000,
      },
    ],
  },
];

// --- derived, so no screen counts these itself -------------------------------

export function communityBySlug(slug: string): Community | undefined {
  return COMMUNITIES.find((c) => c.slug === slug);
}

/** Challenges anyone can still put money into. `full` and `running` are shut. */
export function openChallenges(community: Community): Challenge[] {
  return community.challenges.filter((c) => c.status === "open");
}

/**
 * What the whole community currently has at stake, in its own currency.
 *
 * Summed across challenges rather than stored, because a stored total is a
 * number that can disagree with the rows under it — and this product's whole
 * argument is that the record is the thing.
 */
export function communityPot(community: Community): number {
  return community.challenges.reduce((sum, c) => sum + c.pot, 0);
}

export function activeCount(community: Community): number {
  return community.challenges.filter((c) => c.status !== "full").length;
}

export function filterByCategory(
  communities: Community[],
  category: CommunityCategory | null,
): Community[] {
  return category === null ? communities : communities.filter((c) => c.category === category);
}

