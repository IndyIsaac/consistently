"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { House, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/** Two tabs. Settings lives behind the profile, not in the bar. */
const TABS = [
  { href: "/dashboard", label: "Dashboard", Icon: House, owns: ["/dashboard"] },
  { href: "/groups", label: "Groups", Icon: Users, owns: ["/groups", "/pacts"] },
];

/**
 * The floating pill with the limelight treatment: a light bar sitting on the top
 * edge above the active icon, casting a soft cone down over it and pooling on
 * the floor beneath. Bar, cone and pool are one element, so they travel together
 * on a single spring rather than three animations that can drift apart.
 *
 * The lamp is the value of `ink`, so on the dark ground it throws a bone cone
 * rather than a near-black one that would be invisible.
 */
export function BottomNav() {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  const activeIndex = TABS.findIndex((tab) =>
    tab.owns.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );

  return (
    <nav
      aria-label="Sections"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto relative flex h-[68px] w-[240px] overflow-hidden rounded-[26px] border border-hairline bg-panel/85 shadow-nav backdrop-blur-xl sm:w-[272px]">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2"
          initial={false}
          animate={{
            x: `${Math.max(activeIndex, 0) * 100}%`,
            opacity: activeIndex < 0 ? 0 : 1,
          }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 420, damping: 38, mass: 0.8 }
          }
        >
          {/* the light */}
          <span className="absolute top-0 left-1/2 h-[3px] w-11 -translate-x-1/2 rounded-b-full bg-ink" />

          {/* the cone it throws */}
          <span
            className="absolute inset-x-0 top-0 h-full"
            style={{
              clipPath: "polygon(32% 0, 68% 0, 88% 100%, 12% 100%)",
              backgroundImage:
                "linear-gradient(to bottom, rgb(var(--limelight) / 0.14), rgb(var(--limelight) / 0.05) 46%, rgb(var(--limelight) / 0) 88%)",
            }}
          />

          {/* the pool on the floor */}
          <span
            className="absolute bottom-1.5 left-1/2 h-4 w-16 -translate-x-1/2 blur-[6px]"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at center, rgb(var(--limelight) / 0.20), rgb(var(--limelight) / 0) 68%)",
            }}
          />
        </motion.div>

        {TABS.map((tab, i) => {
          const active = i === activeIndex;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className="relative z-10 flex w-1/2 flex-col items-center justify-center gap-1.5 rounded-[26px] pt-1.5 outline-offset-[-6px]"
            >
              <tab.Icon
                className={cn(
                  "size-[22px] transition-colors duration-200",
                  active ? "text-ink" : "text-grey-on-ground",
                )}
                strokeWidth={active ? 2 : 1.75}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "text-[10px] uppercase tracking-[0.14em] transition-colors duration-200",
                  active ? "font-semibold text-ink" : "text-grey-on-ground",
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
