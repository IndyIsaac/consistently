"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FieldLabel } from "@/components/Panel";
import { Select } from "@/components/Select";
import { Skeleton } from "@/components/Skeleton";

/**
 * A GitHub contribution calendar, built from the product owner's exact
 * 21st.dev source (`GithubCalendar`, kept below) plus a range control this
 * product needed and the original didn't have (`GithubActivity`, the export
 * settings/page.tsx actually renders).
 *
 * Three deliberate departures from the 21st.dev original, each because it
 * assumed a world this app doesn't live in:
 *
 * 1. Colour. The original encodes activity level as a five-step GitHub green
 *    ramp (`THEMES`/`DARK_THEMES`, since deleted). DESIGN.md reserves green
 *    and red for money -- "not status, not streaks, not navigation" -- and
 *    this calendar's whole premise is a streak. The product already has an
 *    answer for "show intensity over time without colour": Day markers
 *    (filled `ink` / `ink` outline / `hairline` ghost). This applies the
 *    same idea here -- `var(--ink)` at rising `fillOpacity` instead of a hue
 *    ramp (see `LEVEL_OPACITY`) -- so it is graded by value like everything
 *    else in the product, not coloured.
 *
 * 2. Dark mode. The original watches for a `.dark` class with a
 *    MutationObserver on `documentElement`/`body`, then picks between two
 *    hardcoded colour tables. Because every colour here is now a bare
 *    `var(--ink)` reference, there is nothing left to branch on -- the
 *    custom property itself flips under `.dark` (see app/globals.css), so
 *    the isDark state, the observer and the two tables are gone rather than
 *    kept and rewired. Same reasoning as components/ThemeToggle.tsx, which
 *    reads the palette instead of hardcoding zinc.
 *
 * 3. Game Mode's switch. The original is an emerald pill -- itself a
 *    forbidden non-money colour. components/RuleEditor.tsx already has this
 *    product's discreet-toggle idiom, a plain checkbox with `accent-ink`, so
 *    this uses that instead of inventing a themed pill. It also now defaults
 *    off: the product's voice is dry and deadpan, and a shooting-game legend
 *    that arms itself on load is the opposite of that.
 *
 * The loading skeleton has two smaller changes: `fill-hairline` instead of
 * `fill-muted` (`--surface` on `--ground` is a 4% step nobody can see -- see
 * components/Skeleton.tsx's own comment) and the shimmering `Skeleton`
 * primitive instead of a generic Tailwind pulse -- this product's skeletons
 * shimmer, they don't pulse.
 *
 * Untouched on purpose: the retro-shooter minigame itself (ship, lasers,
 * starfield) keeps its own arcade colours. It renders inside a bordered
 * black canvas cordoned off from the rest of the page, not the product's
 * chrome, so DESIGN.md's colour law doesn't reach it. `playSound` is also
 * left as the no-op stub the original shipped -- dead code this change
 * didn't create.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export type ContributionData = {
  [date: string]: {
    level: ContributionLevel;
    label?: string;
    count?: number;
  };
};

export type CellShape = "rounded" | "circle";

export type GithubCalendarProps = {
  username?: string; // GitHub username
  data?: ContributionData; //Optional - Only for manual data
  startDate?: string;
  endDate?: string;
  startsOnSunday?: boolean; //Want to start weeks on Sunday or not ?
  cellSize?: number;
  cellGap?: number;
  cellShape?: CellShape; //Rounded | Circle
  showMonthLabels?: boolean; // Want the month labels on top
  showStats?: boolean;
  showLegend?: boolean;
  className?: string; // Custom class for custom styling
};

/**
 * level0 is bare surface -- nothing drawn. 1-4 are the same `ink` at rising
 * opacity, tuned so four steps stay distinguishable at 12px against both
 * grounds. This renders inside a `Panel`, whose background is `--panel`, not
 * `--surface` -- against that (panel #FFFFFF, ink #0A0A0A in light) these
 * opacities land at roughly 226/169/103/10; against dark (panel #111112, ink
 * #FAFAFA) roughly 45/99/161/250. Both sequences are monotonic with growing
 * gaps, which is what four legible steps need, though the level0→1 step is
 * the tightest of the four in both themes (~28-29 of 255) -- the one most
 * likely to read as "barely there" at 12px on a real screen.
 */
const LEVEL_OPACITY: Record<ContributionLevel, number> = {
  0: 0,
  1: 0.12,
  2: 0.35,
  3: 0.62,
  4: 1,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const FULL_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function formatTooltipDate(dateStr: string): string {
  try {
    const date = parseDate(dateStr);
    const month = FULL_MONTH_NAMES[date.getMonth()];
    const day = date.getDate();
    const suffix = getOrdinalSuffix(day);
    return `${month} ${day}${suffix}`;
  } catch {
    return dateStr;
  }
}

/** What the stats line's count actually counts -- states the window rather
 *  than a fixed "this year", since the range control can make it any window
 *  at all. "Jun–Aug 2026" when it's one year, the year repeated on each side
 *  when it isn't (a 3-month window can cross a year boundary). */
function formatRangeLabel(startDate: string, endDate: string): string {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  if (startYear === endYear && startMonth === endMonth) return `${startMonth} ${startYear}`;
  if (startYear === endYear) return `${startMonth}–${endMonth} ${startYear}`;
  return `${startMonth} ${startYear} – ${endMonth} ${endYear}`;
}

function playSound(type: "laser" | "explosion" | "hit" | "victory") {
  // Sound effects disabled
}

// ─── API fetch ────────────────────────────────────────────────────────────────

type APIResponse = {
  total: Record<string, number>;
  contributions: { date: string; count: number; level: number }[];
};

/** Carries the HTTP status so the caller can tell "no such account" (404)
 *  apart from the service itself being unreachable -- those read as two
 *  different facts, not one outage message. */
class ContributionFetchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function fetchContributions(username: string): Promise<ContributionData> {
  const res = await fetch(
    `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}`,
  );
  if (!res.ok) {
    throw new ContributionFetchError(
      `Could not fetch contributions for "${username}" (${res.status})`,
      res.status,
    );
  }
  const json: APIResponse = await res.json();

  const result: ContributionData = {};
  for (const entry of json.contributions) {
    result[entry.date] = {
      level: Math.min(4, Math.max(0, entry.level)) as ContributionLevel,
      count: entry.count,
    };
  }
  return result;
}

// ─── Build calendar grid ──────────────────────────────────────────────────────

function buildGrid(
  startDate: string,
  endDate: string,
  startsOnSunday: boolean,
): {
  weeks: (string | null)[][];
  monthLabels: { label: string; weekIndex: number }[];
  gridStart: string;
} {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const startDay = startsOnSunday ? 0 : 1;
  const startDow = start.getDay();
  const offset = (startDow - startDay + 7) % 7;
  const gridStart = addDays(start, -offset);

  const weeks: (string | null)[][] = [];
  const monthLabels: { label: string; weekIndex: number }[] = [];

  let current = new Date(gridStart);
  let weekIndex = 0;
  let lastMonth = -1;

  while (
    current <= end ||
    (weeks.length > 0 && (weeks[weeks.length - 1]?.length ?? 0) < 7)
  ) {
    const week: (string | null)[] = [];

    for (let d = 0; d < 7; d++) {
      const dateStr = formatDate(current);
      const isInRange = current >= start && current <= end;
      week.push(isInRange ? dateStr : null);

      if (isInRange && current.getMonth() !== lastMonth) {
        lastMonth = current.getMonth();
        monthLabels.push({
          label: MONTH_NAMES[current.getMonth()]!,
          weekIndex,
        });
      }

      current = addDays(current, 1);
    }

    weeks.push(week);
    weekIndex++;

    if (
      current > end &&
      weeks.length > 0 &&
      (weeks[weeks.length - 1]?.every(
        (d) => d === null || parseDate(d) > end,
      ) ?? false)
    )
      break;
  }

  return { weeks, monthLabels, gridStart: formatDate(gridStart) };
}

// ─── Tooltip state type ───────────────────────────────────────────────────────

type TooltipState = {
  visible: boolean;
  date: string;
  count: number | undefined;
  label: string | undefined;
  x: number;
  y: number;
};

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function CalendarSkeleton({
  cellSize = 12,
  cellGap = 3,
  className,
}: {
  cellSize?: number;
  cellGap?: number;
  className?: string;
}) {
  const step = cellSize + cellGap;
  // Approximates the shrunk default range's week count, not the original's
  // hardcoded 53 (that matched its full-year default) -- see GithubActivity.
  const weeks = 14;
  const days = 7;
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex gap-6">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-4 w-24 rounded" />
      </div>
      <div className="overflow-x-auto">
        <svg
          width={weeks * step - cellGap}
          height={16 + days * step - cellGap}
          className="overflow-visible"
        >
          {Array.from({ length: weeks }).map((_, wi) =>
            Array.from({ length: days }).map((_, di) => (
              <rect
                key={`${wi}-${di}`}
                x={wi * step}
                y={16 + di * step}
                width={cellSize}
                height={cellSize}
                rx={cellSize * 0.2}
                className="fill-hairline"
              />
            )),
          )}
        </svg>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const GithubCalendar = memo(function GithubCalendar({
  username,
  data: dataProp,
  startDate,
  endDate,
  startsOnSunday = true,
  cellSize = 12,
  cellGap = 3,
  cellShape = "rounded",
  showMonthLabels = true,
  showStats = true,
  showLegend = true,
  className,
}: GithubCalendarProps) {
  const id = useId();
  // Scroll ref — used to auto-scroll to most recent months on compact viewports
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gameActive, setGameActive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Fetch state ────────────────────────────────────────────────────────
  const [fetchedData, setFetchedData] = useState<ContributionData | null>(null);
  const [loading, setLoading] = useState(!!username);
  // "not-found" (the account doesn't exist) and "error" (the service didn't
  // answer) are two different facts, not one outage message -- see the
  // render branch below.
  const [fetchError, setFetchError] = useState<"not-found" | "error" | null>(null);

  useEffect(() => {
    if (!username) return;

    // A separate async function rather than three setState calls at the top
    // of the effect body -- react-hooks/set-state-in-effect wants state
    // updates driven from a callback (the fetch resolving), not synchronously
    // during the effect itself.
    let cancelled = false;
    async function run() {
      setFetchedData(null);
      setFetchError(null);
      setLoading(true);
      try {
        const d = await fetchContributions(username!);
        if (!cancelled) setFetchedData(d);
      } catch (e) {
        if (!cancelled) {
          setFetchError(e instanceof ContributionFetchError && e.status === 404 ? "not-found" : "error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();

    return () => {
      cancelled = true;
    };
  }, [username]);

  // ── Choose data source ─────────────────────────────────────────────────
  const data: ContributionData = dataProp ?? fetchedData ?? {};

  // ── Resolve dates ──────────────────────────────────────────────────────
  const resolvedEnd = endDate ?? formatDate(new Date());
  const resolvedStart = useMemo(() => {
    if (startDate) return startDate;
    const d = parseDate(resolvedEnd);
    d.setFullYear(d.getFullYear() - 1);
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }, [startDate, resolvedEnd]);

  // ── Tooltip state ──────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    date: "",
    count: undefined,
    label: undefined,
    x: 0,
    y: 0,
  });

  // ── Build grid ─────────────────────────────────────────────────────────
  const { weeks, monthLabels, gridStart } = useMemo(
    () => buildGrid(resolvedStart, resolvedEnd, startsOnSunday),
    [resolvedStart, resolvedEnd, startsOnSunday],
  );

  // ── Stats ──────────────────────────────────────────────────────────────
  // Windowed to the visible range, not the account's whole fetched history --
  // `data` holds every contribution the API returned regardless of what's on
  // screen, and a figure next to a range control is read as scoped to it.
  // Date strings sort the same lexicographically as chronologically, so a
  // plain string comparison windows them without re-parsing each one.
  const stats = useMemo(() => {
    const entries = Object.entries(data).filter(
      ([d]) => d >= resolvedStart && d <= resolvedEnd,
    );
    const total = entries.reduce(
      (sum, [, v]) => sum + (v.count ?? (v.level > 0 ? 1 : 0)),
      0,
    );
    const activeDays = entries.filter(([, v]) => v.level > 0).length;
    const maxStreak = (() => {
      let max = 0;
      let cur = 0;
      const sorted = entries
        .filter(([, v]) => v.level > 0)
        .map(([d]) => d)
        .sort();
      for (let i = 0; i < sorted.length; i++) {
        if (i === 0) {
          cur = 1;
          max = 1;
          continue;
        }
        const prev = parseDate(sorted[i - 1]!);
        const curr = parseDate(sorted[i]!);
        const diff = (curr.getTime() - prev.getTime()) / 86400000;
        if (diff === 1) {
          cur++;
          max = Math.max(max, cur);
        } else cur = 1;
      }
      return max;
    })();
    return { total, activeDays, maxStreak };
  }, [data, resolvedStart, resolvedEnd]);

  // ── Dimensions ────────────────────────────────────────────────────────
  const step = cellSize + cellGap;
  const monthLabelHeight = showMonthLabels && !gameActive ? 20 : 0;
  const svgWidth = weeks.length * step - cellGap;
  const svgHeight = monthLabelHeight + 7 * step - cellGap;
  // Auto-scroll to the right end (most recent months) — must be before early returns
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [fetchedData, dataProp]);

  // Game loop and autoplay logic
  useEffect(() => {
    if (!gameActive) {
      // Restore every cell's resting appearance when the game stops.
      weeks.forEach((week) => {
        week.forEach((date) => {
          if (!date) return;
          const rect = document.getElementById(`cell-${id}-${date}`);
          if (rect) {
            rect.style.opacity = "1";
            rect.style.pointerEvents = "auto";
            const originalLevel = data[date]?.level ?? 0;
            rect.style.setProperty("fill-opacity", String(LEVEL_OPACITY[originalLevel]));
          }
        });
      });
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Canvas 2D's fillStyle can't resolve `var(--ink)` the way SVG/CSS can,
    // so the one colour this loop needs (explosion sparks) is read out as a
    // real value once here, rather than hardcoded.
    const ink =
      getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() ||
      "#0a0a0a";

    let animationFrameId: number;
    const width = svgWidth;
    const height = svgHeight + 80;
    canvas.width = width;
    canvas.height = height;

    // Local mutable map for dynamic cell levels
    const cellLevels = new Map<string, number>();
    weeks.forEach((week) => {
      week.forEach((date) => {
        if (!date) return;
        const entry = data[date];
        const initialLevel = entry?.level ?? 0;
        cellLevels.set(date, initialLevel);
        const rect = document.getElementById(`cell-${id}-${date}`);
        if (rect) {
          if (initialLevel === 0) {
            rect.style.opacity = "0";
            rect.style.pointerEvents = "none";
          } else {
            rect.style.opacity = "1";
            rect.style.pointerEvents = "auto";
          }
        }
      });
    });

    // Player (Spacecraft) with automatic direction sweep
    const player = {
      x: width / 2 - 15,
      y: height - 25,
      width: 30,
      height: 20,
      speed: 4,
      direction: 1, // 1 = right, -1 = left
      color: "#38bdf8",
    };

    // Bullets
    type GameBullet = {
      x: number;
      y: number;
      vy: number;
      width: number;
      height: number;
      color: string;
    };
    let bullets: GameBullet[] = [];
    let lastShot = 0;
    const cooldown = 140; // Autoplay shooting speed

    const shoot = () => {
      bullets.push({
        x: player.x + player.width / 2 - 1.5,
        y: player.y - 4,
        vy: -6,
        width: 3,
        height: 8,
        color: "#fbbf24", // Yellow laser
      });
      playSound("laser");
    };

    // Stars background (Space effect)
    const stars = Array.from({ length: 140 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      speed: Math.random() * 0.4 + 0.1,
      size: Math.random() * 1.2 + 0.5,
      alpha: Math.random() * 0.5 + 0.1,
    }));

    // Particles (for explosions)
    type GameParticle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      size: number;
      alpha: number;
      life: number;
      maxLife: number;
    };
    let particles: GameParticle[] = [];
    const explode = (x: number, y: number, color: string) => {
      playSound("explosion");
      for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.5 + 1.2;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: Math.random() * 2 + 1,
          alpha: 1,
          life: 0,
          maxLife: Math.random() * 15 + 15,
        });
      }
    };

    const update = () => {
      // Find the min and max column index (wi) that still has active cells (level > 0)
      let minWi = -1;
      let maxWi = -1;
      weeks.forEach((week, wi) => {
        week.forEach((date) => {
          if (!date) return;
          if ((cellLevels.get(date) ?? 0) > 0) {
            if (minWi === -1) minWi = wi;
            minWi = Math.min(minWi, wi);
            maxWi = Math.max(maxWi, wi);
          }
        });
      });

      // If there are active cells, restrict player boundary
      let minX = 0;
      let maxX = width - player.width;
      if (minWi !== -1 && maxWi !== -1) {
        minX = minWi * step;
        maxX = Math.max(
          minX,
          Math.min(width - player.width, (maxWi + 1) * step - player.width),
        );
      }

      // Clamp player position
      player.x = Math.max(minX, Math.min(maxX, player.x));

      // ── Side-to-Side Sweep Ship Movement ──────────────────────────────────
      player.x += player.speed * player.direction;
      if (player.x >= maxX) {
        player.x = maxX;
        player.direction = -1;
      } else if (player.x <= minX) {
        player.x = minX;
        player.direction = 1;
      }

      // ── Continuous Auto-Shooting ──────────────────────────────────────────
      const now = Date.now();
      if (now - lastShot >= cooldown) {
        shoot();
        lastShot = now;
      }

      // ── Reset Game if all contribution cells are cleared to level 0 ──────
      let anyActive = false;
      cellLevels.forEach((level) => {
        if (level > 0) anyActive = true;
      });

      if (!anyActive) {
        playSound("victory");
        // Reset all cell levels back to their original levels
        weeks.forEach((week) => {
          week.forEach((date) => {
            if (!date) return;
            const originalLevel = data[date]?.level ?? 0;
            cellLevels.set(date, originalLevel);
            const rect = document.getElementById(`cell-${id}-${date}`);
            if (rect) {
              rect.style.setProperty("fill-opacity", String(LEVEL_OPACITY[originalLevel]));
              if (originalLevel === 0) {
                rect.style.opacity = "0";
                rect.style.pointerEvents = "none";
              } else {
                rect.style.opacity = "1";
                rect.style.pointerEvents = "auto";
              }
            }
          });
        });
      }

      // ── Update Environment ────────────────────────────────────────────────
      // Move Stars
      stars.forEach((s) => {
        s.y += s.speed;
        if (s.y > height) {
          s.y = 0;
          s.x = Math.random() * width;
        }
      });

      // Move Bullets
      bullets = bullets.filter((b) => {
        b.y += b.vy;
        return b.y > 0;
      });

      // Move Particles
      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        p.alpha = 1 - p.life / p.maxLife;
      });
      particles = particles.filter((p) => p.life < p.maxLife);

      // Check laser collisions with cells
      bullets.forEach((bullet, bulletIdx) => {
        weeks.forEach((week, wi) => {
          week.forEach((date, di) => {
            if (!date) return;

            const currentLevel = cellLevels.get(date) ?? 0;
            if (currentLevel === 0) return; // Already finished / level 0

            const cellX = wi * step;
            const cellY = monthLabelHeight + di * step;

            // Simple box-overlap collision check
            if (
              bullet.x < cellX + cellSize &&
              bullet.x + bullet.width > cellX &&
              bullet.y < cellY + cellSize &&
              bullet.y + bullet.height > cellY
            ) {
              // Collision detected! Remove the bullet
              bullets.splice(bulletIdx, 1);

              // Decrement the level by 1
              const newLevel = currentLevel - 1;
              cellLevels.set(date, newLevel);

              // Instantly update the cell's intensity in the SVG DOM
              const rect = document.getElementById(`cell-${id}-${date}`);
              if (rect) {
                if (newLevel === 0) {
                  rect.style.opacity = "0";
                  rect.style.pointerEvents = "none";
                } else {
                  rect.style.setProperty(
                    "fill-opacity",
                    String(LEVEL_OPACITY[newLevel as ContributionLevel]),
                  );
                }
              }

              // Play hit explosion effect in the product's one real colour
              explode(cellX + cellSize / 2, cellY + cellSize / 2, ink);
            }
          });
        });
      });
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw starry space background
      ctx.fillStyle = "#ffffff";
      stars.forEach((s) => {
        ctx.globalAlpha = s.alpha;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      });
      ctx.globalAlpha = 1.0;

      // Draw bullets
      bullets.forEach((b) => {
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.width, b.height);
      });

      // Draw particles
      particles.forEach((p) => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      });
      ctx.globalAlpha = 1.0;

      // Draw Player Ship (Cyan space fighter style)
      ctx.fillStyle = player.color;
      ctx.shadowColor = player.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(player.x + player.width / 2, player.y);
      ctx.lineTo(player.x + player.width, player.y + player.height);
      ctx.lineTo(player.x + player.width * 0.7, player.y + player.height * 0.75);
      ctx.lineTo(player.x + player.width * 0.3, player.y + player.height * 0.75);
      ctx.lineTo(player.x, player.y + player.height);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    const loop = () => {
      update();
      render();
      if (gameActive) {
        animationFrameId = requestAnimationFrame(loop);
      }
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameActive, data, weeks, step, cellSize, cellGap, monthLabelHeight, id, svgWidth, svgHeight]);

  // ── Loading / error states ───────────────────────────
  if (loading) {
    return (
      <CalendarSkeleton
        cellSize={cellSize}
        cellGap={cellGap}
        className={className}
      />
    );
  }

  if (fetchError) {
    // Quiet, not shouted: a member whose calendar won't load still gets a
    // legible settings page, not a red banner over a third party's outage.
    // A wrong handle and a dead API read as two different facts, not one.
    return (
      <p className={cn("text-[13px] text-grey-on-ground", className)}>
        {fetchError === "not-found"
          ? `No GitHub account found for ${username}.`
          : `GitHub is not answering for ${username}.`}
      </p>
    );
  }

  const cellRx = cellShape === "circle" ? cellSize / 2 : cellSize * 0.2;

  return (
    <div
      className={cn(
        "overflow-x-hidden transition-all duration-500",
        gameActive && "w-fit rounded-sm border border-neutral-800 bg-black",
        className,
      )}
    >
      <div className="flex flex-col gap-3 p-3">
        <div
          ref={scrollRef}
          className={cn(
            "relative overflow-x-auto transition-all duration-500",
            gameActive ? "pb-[80px]" : "",
          )}
          style={
            {
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            } as React.CSSProperties
          }
        >
          <svg
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="overflow-visible"
          >
            {/* month labels */}
            {showMonthLabels &&
              !gameActive &&
              (() => {
                const byWeek = new Map<number, string>();
                monthLabels.forEach(({ label, weekIndex }) =>
                  byWeek.set(weekIndex, label),
                );
                const entries = Array.from(byWeek.entries());
                const validEntries: [number, string][] = [];
                for (let i = 0; i < entries.length; i++) {
                  const current = entries[i]!;
                  const next = entries[i + 1];
                  // If the first month is too close to the second, skip the first one
                  if (i === 0 && next && next[0] - current[0] < 3) {
                    continue;
                  }
                  // If this month is too close to the last added one, skip it
                  const lastValid = validEntries[validEntries.length - 1];
                  if (lastValid && current[0] - lastValid[0] < 3) {
                    continue;
                  }
                  validEntries.push(current);
                }
                return validEntries.map(([weekIndex, label]) => (
                  <text
                    key={`${label}-${weekIndex}`}
                    x={weekIndex * step}
                    y={10}
                    fontSize={14}
                    fill="var(--ink)"
                    fontFamily="inherit"
                  >
                    {label}
                  </text>
                ));
              })()}

            {/* cells */}
            {weeks.map((week, wi) =>
              week.map((date, di) => {
                const entry = date ? data[date] : undefined;
                const level: ContributionLevel = entry?.level ?? 0;
                const cellCenterX = wi * step + cellSize / 2;
                const cellTopY = monthLabelHeight + di * step;

                if (!date) {
                  const cellDate = formatDate(
                    addDays(parseDate(gridStart), wi * 7 + di),
                  );
                  if (cellDate > resolvedEnd) return null;
                }

                return (
                  <rect
                    key={`${wi}-${di}`}
                    id={date ? `cell-${id}-${date}` : undefined}
                    x={wi * step}
                    y={cellTopY}
                    width={cellSize}
                    height={cellSize}
                    rx={cellRx}
                    fill="var(--ink)"
                    fillOpacity={LEVEL_OPACITY[level]}
                    style={{
                      transition: "opacity 0.1s",
                      opacity: gameActive ? (level === 0 || !date ? 0 : 1) : 1,
                      pointerEvents: gameActive
                        ? level === 0 || !date
                          ? "none"
                          : "auto"
                        : "auto",
                    }}
                    onMouseEnter={() => {
                      if (!date || gameActive) return;
                      setTooltip({
                        visible: true,
                        date,
                        count: entry?.count,
                        label: entry?.label,
                        x: cellCenterX,
                        y: cellTopY,
                      });
                    }}
                    onMouseLeave={() =>
                      setTooltip((t) => ({ ...t, visible: false }))
                    }
                  />
                );
              }),
            )}
          </svg>

          {/* Game canvas overlay */}
          {gameActive && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 pointer-events-auto z-10 cursor-crosshair"
              style={{ width: svgWidth, height: svgHeight + 80 }}
            />
          )}

          {/* custom tooltip */}
          {tooltip.visible &&
            (() => {
              const count = tooltip.count ?? 0;
              const formattedDate = formatTooltipDate(tooltip.date);
              const tooltipText = tooltip.label
                ? `${tooltip.label} on ${formattedDate}.`
                : count === 0
                  ? `No contributions on ${formattedDate}.`
                  : `${count} contribution${count !== 1 ? "s" : ""} on ${formattedDate}.`;

              return (
                <div
                  className="pointer-events-none absolute z-50 rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-ground shadow-md whitespace-nowrap"
                  style={{
                    left: tooltip.x,
                    top: tooltip.y,
                    transform: "translate(-50%, calc(-100% - 6px))",
                  }}
                >
                  {tooltipText}
                  {/* Small arrow pointing down */}
                  <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-1.5 h-1.5 rotate-45 bg-ink" />
                </div>
              );
            })()}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* legend (left) */}
          {showLegend && (
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-grey-on-ground shrink-0 mt-0.5">
              <div className="flex items-center gap-1.5">
                <span>Less</span>
                {/* 1-4, not 0-4. Level 0 is fully transparent by design, so a
                    swatch for it is an invisible box that opens a gap after
                    "Less" -- it reads as a swatch that failed to render. */}
                {([1, 2, 3, 4] as ContributionLevel[]).map((level) => (
                  <svg key={level} width={cellSize} height={cellSize}>
                    <rect
                      width={cellSize}
                      height={cellSize}
                      rx={cellRx}
                      fill="var(--ink)"
                      fillOpacity={LEVEL_OPACITY[level]}
                    />
                  </svg>
                ))}
                <span>More</span>
              </div>

              {/* Game Mode: off by default, kept discreet -- see the file
                  header. A plain checkbox, the idiom RuleEditor.tsx already
                  uses for its own switches, rather than a themed pill. */}
              <label className="flex items-center gap-2 border-l border-hairline pl-4">
                <span className="select-none">Game mode</span>
                <input
                  type="checkbox"
                  className="size-4 accent-ink"
                  checked={gameActive}
                  onChange={(e) => setGameActive(e.target.checked)}
                />
              </label>
            </div>
          )}

          {/* stats line (right) */}
          {showStats && (
            <div className="ml-auto text-[13px] tracking-wide text-grey-on-ground">
              <a
                href={`https://github.com/${username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-right transition-colors hover:text-ink"
              >
                <span className="font-semibold text-ink">{username}</span> ·{" "}
                {stats.total.toLocaleString()} contribution
                {stats.total === 1 ? "" : "s"}, {formatRangeLabel(resolvedStart, resolvedEnd)}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

GithubCalendar.displayName = "GithubCalendar";

export default GithubCalendar;

/* ─── Range control ──────────────────────────────────────────────────────────
 * The 21st.dev original takes `startDate`/`endDate` but has no UI for
 * picking them -- its only default is the full trailing year (53 weeks,
 * ~795px at cellSize=12/cellGap=3). The product owner asked for both a
 * smaller default and a way to move it, so this builds a month/year picker
 * on top of the existing date props rather than reaching into
 * GithubCalendar's internals.
 * ---------------------------------------------------------------------- */

/**
 * Three months: ~13-14 weeks, roughly 190-210px wide at the default
 * cellSize=12/cellGap=3 -- comfortably inside a phone viewport even after
 * the Panel's own padding, unlike the original's 795px year.
 */
const RANGE_MONTHS = 3;

/** No "joined GitHub" date to anchor a real bound to, so this is simply a
 *  sensible number of years back rather than an exact one. */
const YEARS_BACK = 5;

function monthRangeFor(year: number, month: number): { startDate: string; endDate: string } {
  const today = new Date();
  const rawEnd = new Date(year, month + 1, 0); // last day of the selected month
  const end = rawEnd > today ? today : rawEnd; // never request days that haven't happened
  const start = new Date(year, month - RANGE_MONTHS + 1, 1);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

/**
 * What settings/page.tsx actually renders: the calendar plus the month/year
 * control. Not itself wrapped in a `Panel` -- the page supplies that, since
 * this product's cards never nest.
 */
export function GithubActivity({ username }: { username: string }) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);

  // Only the current year has months that haven't happened yet.
  const maxMonth = year === currentYear ? currentMonth : 11;
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => currentYear - i);

  const { startDate, endDate } = useMemo(
    () => monthRangeFor(year, month),
    [year, month],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>GitHub</FieldLabel>
        <div className="flex gap-2">
          <Select
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i} disabled={i > maxMonth}>
                {name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Year"
            value={year}
            onChange={(e) => {
              const y = Number(e.target.value);
              setYear(y);
              // Moving to the current year can leave a later month selected
              // than exists yet -- pull it back rather than show an empty
              // grid for months that haven't happened.
              if (y === currentYear && month > currentMonth) setMonth(currentMonth);
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <GithubCalendar username={username} startDate={startDate} endDate={endDate} />
    </div>
  );
}
