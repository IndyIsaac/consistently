"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The other half of crossing the threshold. app/page.tsx wipes the black door
 * away with white; the white world resolves out of that same white as the app
 * shell mounts, so the two pages read as one movement.
 *
 * It runs once. The shell persists across tab changes, so switching between
 * Dashboard and Groups does not replay it.
 */
export function Arrival({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.main
      className={className}
      // `initial` stays constant across server and client: branching it on
      // `useReducedMotion` renders different inline styles on each and React
      // reports a hydration mismatch. Only the duration changes.
      initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.main>
  );
}
