import { cn } from "@/lib/utils";

/**
 * Loading shape. Skeletons shimmer; the product has no spinners.
 *
 * `hairline` rather than `surface` for the base — a skeleton has to read as a
 * shape at a glance, and #F5F5F5 on white is a 4% step nobody can see. The sweep
 * is a real child, not an `::after`: an animated pseudo-element stops its host
 * painting its own background in Chromium, and the skeleton disappears.
 *
 * The sweep's own value is themed: a near-white pass reads over #E5E5E5 and
 * glares over #262626.
 */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn("relative block overflow-hidden bg-hairline", className)}
    >
      <span
        aria-hidden="true"
        className="animate-shimmer absolute inset-0 block bg-[linear-gradient(90deg,transparent,var(--shimmer),transparent)] motion-reduce:hidden"
      />
    </span>
  );
}
