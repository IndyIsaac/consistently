# Design

Visual world for **Consistently**. Derived from 29 references the builder curated on 21st.dev
(list `dflow`), read directly rather than paraphrased.

## The world

Monochrome app UI at high craft. Near-white ground, near-black as the only strong value, grey for
everything secondary, and colour admitted only where it carries meaning. Generous whitespace, large
soft radii, hairline and dashed rules doing the dividing work. Numbers are the heroes: set large,
heavy and tight. Motion is real and physical — a light that follows the active tab, shimmer while
loading, a checkmark that draws itself — never decorative bounce.

This is the category standard played straight and played well. It was chosen deliberately over three
concept-led alternatives. The ambition lives in execution rather than in metaphor.

## Palette

| Token | Value | Use |
|---|---|---|
| `ground` | `#FFFFFF` | Page. Cards sit on it near-white, not tinted. |
| `ink` | `#0A0A0A` | Text, filled states, the active tab. The only strong value. |
| `muted` | `#737373` | Secondary labels, inactive icons, sub-rows. |
| `hairline` | `#E5E5E5` | Borders, dividers. Dashed at 1px where a break is soft. |
| `surface` | `#F5F5F5` | Inset panels, the "you" row, disclosure blocks. |
| `owed` | `#B42318` | Money you have lost. Also a miss: today's cross, a week out of reach. |
| `earned` | `#067647` | Money you have gained. Also a make: today's tick, a week already met. |
| `pace` | `#C2410C` | The week is still reachable. Icons only — never a figure. |

Red and green mark money and cadence. Navigation and type stay ink. `pace` is the one orange,
and it never sits on a number.

## Type

One geometric grotesque throughout. Display numerals at 48–64px, weight 700, tracking `-0.03em`.
Body 15–17px at 400. Labels 11px uppercase at `0.12em` tracking in `muted`. No italics, no second
family, no serif.

Currency is always written with its symbol and grouping (`฿1,000`, `£10`), never abbreviated to
`1k` in a money context — an abbreviated forfeit reads as a score rather than a debt.

## Components

- **Cards:** white, 1px `hairline` border, radius 20–24px, no drop shadow beyond a whisper. Padding
  24px. They separate content; they do not decorate it.
- **Bottom navigation:** a floating pill with the limelight treatment — a light bar above the active
  icon casting a soft cone down over it. Two tabs only: Dashboard, Groups. Settings lives behind the
  profile, not in the bar.
- **Day markers:** filled `ink` circle with a white check for done, `ink` outline for today,
  `hairline` ghost for future. This is the streak row and it is the product's most repeated shape.
- **Crew table:** rank, avatar, name, one grey sub-line, right-aligned figure. The viewer's own row
  is inset in `surface` with a 2px `ink` border. No podium, no crowns, no tiers.
- **Bot messages:** left-aligned message rows with the bot's mark, timestamped. Member photos post
  as image rows. There is no free-text composer — only a slash-command input and a camera button.
- **Skeletons:** shimmer while loading rather than spinners.

## Rulings made against the references

The references are inspiration, not instruction. Three were deliberately not followed:

1. **The leaderboard's podium, crowns and "Level 42 – Diamond" tiers are dropped.** They are
   gamification, and PRODUCT.md commits the voice to dry and deadpan. A crown congratulates; this
   product states the record. The reference's *row structure* is kept in full.
2. **The neon and glassmorphism profile cards are not used.** They belong to a different, louder
   world than every other reference in the list. The clean card treatment carries profile too.
3. **The streak card's copy is replaced.** Its "missing a day will reset your streak to 0" is wrong
   here — the rule is a cadence per period, not consecutive days, and the streak carries a one-day
   grace. The card's structure and proportions are kept.

## Two registers, and the flip

The product has a front door and an interior, and **they are always opposite**. Crossing between
them is the arrival moment, and it must land in either theme.

**The landing takes the inverse of the app's theme.**

| App theme | Landing | Interior |
|---|---|---|
| Light | Near-black ground, bone text | White |
| Dark | Bone ground, near-black text | Near-black |

One line — *Stay consistent.* — set in terminal mono, the full stop doing the work. No explanation,
no feature list, no screenshots. Mystery is the point: it says nothing about what the product is. A
single START press reveals the sign-in.

Type here is mono, not the app's grotesque. This is the only surface where that is true. The
simultaneous flip of value and typeface is what makes entry feel like arrival rather than a page
change — and inverting the landing is what preserves that in dark mode instead of dissolving it.

## Dark palette

The interior's dark counterpart. Never pure black — the ground is lifted so cards can sit above it.

| Token | Light | Dark | Note |
|---|---|---|---|
| `ground` | `#FFFFFF` | `#0C0C0D` | Page |
| `ink` | `#0A0A0A` | `#FAFAFA` | Text, filled states, active tab |
| `muted` | `#737373` | `#8A8A8A` | Secondary labels, inactive icons |
| `hairline` | `#E5E5E5` | `#262626` | Borders, dividers |
| `surface` | `#F5F5F5` | `#171718` | Inset panels, the "you" row |
| `owed` | `#B42318` | `#F97066` | Money lost; a miss |
| `earned` | `#067647` | `#47CD89` | Money gained; a make |
| `pace` | `#C2410C` | `#FB923C` | Week still reachable |

Money colours **must** shift between themes. `#B42318` on `#0C0C0D` fails contrast badly; the dark
variants are deliberately lighter. Verify both pairs against the ground before shipping — a
forfeited stake that cannot be read is the one thing this product cannot afford.

## Theme toggle

A pill with a dark track: a moon in a filled light knob at one end, a sun in `muted` at the other,
the knob sliding between them on `motion/react`. It lives in Settings, not in the nav bar.

Theme persists across reloads and respects the system preference on first visit.

## Device preview harness

A development surface at `/preview`, **not part of the product**. It renders the running app inside
a real device frame so the builder can judge it at true proportions and record the demo video
without a screen recorder's chrome.

- **Samsung Galaxy S25 Ultra** and **iPhone**, switchable.
- The S25 Ultra is built to real proportions: 19.5:9, flat display, a thin uniform bezel, a centred
  punch-hole camera, and the notably squarer corners of this generation — do not reuse an older
  Ultra's heavy rounding.
- A light/dark switch sits alongside the device switch so both themes can be judged side by side.
- The app inside the frame is live and navigable, not a screenshot.

## Sign-in

Privy, email and a six-digit code. No password, therefore no 2FA — the two-factor references in the
list were admired for their looks, not their flow.

A Google button sits alongside the email field. **It is not wired and will not be.** It must
therefore never look pressable-and-broken on stage: render it visibly unavailable rather than live,
and disclose it plainly in the README. A dead button a judge clicks is worse than no button.

## Invites

A group's invite is a QR code. Someone opens the group, shows the code, the rest scan it and land in
the join flow. This is the demo's best physical moment — judges can join from their own phones from
the audience — so the QR must be large, high-contrast, and reachable in one tap from inside a group.

## Voice in the interface

Per PRODUCT.md: dry, deadpan, faintly savage. States facts, names people and amounts plainly,
never congratulates and never scolds.

- Good: *"Dave owes ฿3,000. Five weeks."* · *"4 of 5. One day left."* · *"Settled. ฿1,000 to Nat."*
- Wrong: *"Great job! 🎉"* · *"Oops, you missed a day!"* · *"You're crushing it!"*

No exclamation marks. No emoji in system copy — emoji belong to members' reactions only.

## Stack notes

Every reference installs through `npx shadcn@latest add`. shadcn is **not currently set up** in this
project: there is no `components.json`, no `lib/utils.ts`, and no `class-variance-authority` or
`tailwind-merge`. That setup is a prerequisite for adopting any of them, and Tailwind v4 here is
CSS-first with no `tailwind.config.ts`.

Motion comes from `motion/react` (the references' own choice), used for the limelight, the shimmer
and the check draw. Nothing else animates.
