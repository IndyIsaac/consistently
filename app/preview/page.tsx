"use client";

import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DEVICES, type DeviceId } from "./devices";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * DEV SURFACE — not part of the product.
 *
 * The running app inside a real device frame, live and navigable, so the builder
 * can judge true proportions and record the demo without a screen recorder's
 * chrome around it. Nothing in the product links here, and deleting app/preview/
 * removes the whole thing.
 *
 * The theme switch is the product's own toggle. It writes the same key the app
 * reads, and a `storage` event carries the change into the frame — the app in
 * there is a separate document of the same origin, so it hears it for free.
 * ------------------------------------------------------------------------- */

const ROUTES = [
  { href: "/", label: "Front door" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/groups", label: "Groups" },
  { href: "/settings", label: "Settings" },
];

export default function PreviewHarness() {
  const [deviceId, setDeviceId] = useState<DeviceId>("s25-ultra");
  const [route, setRoute] = useState("/dashboard");
  // Bumped on every jump, so pressing the route you are already on reloads it.
  const [trip, setTrip] = useState(0);
  const [path, setPath] = useState("/dashboard");

  const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[0];

  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = stage.current;
    if (!element) return;

    // The frame is absolutely placed inside the stage, so measuring the stage
    // can never be fed by the size of what it holds.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit =
    box.width && box.height
      ? Math.min(1, box.width / device.frame.width, box.height / device.frame.height)
      : 1;

  return (
    <div className="flex min-h-dvh flex-col bg-surface font-mono">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-hairline px-5 py-3.5 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
            Device preview
          </span>
          <span className="rounded-full border border-dashed border-hairline px-2 py-0.5 text-[10px] tracking-[0.18em] text-grey-on-surface uppercase">
            dev
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Segmented
            label="Route"
            options={ROUTES.map((r) => ({ value: r.href, label: r.label }))}
            value={route}
            onChange={(next) => {
              setRoute(next);
              setPath(next);
              setTrip((n) => n + 1);
            }}
          />

          <Segmented
            label="Device"
            options={DEVICES.map((d) => ({ value: d.id, label: d.name }))}
            value={device.id}
            onChange={(next) => setDeviceId(next as DeviceId)}
          />

          <ThemeToggle />
        </div>
      </header>

      <div ref={stage} className="relative flex-1 overflow-hidden p-6">
        {/* The bench, lit. `--limelight` is the value of `ink`, so this is a
            faint shadow pooled under the device on the light bench and a faint
            light on the dark one — where a near-black phone would otherwise
            have nothing to stand against. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(52% 46% at 50% 48%, rgb(var(--limelight) / 0.07), rgb(var(--limelight) / 0) 72%)",
          }}
        />

        <div
          className="absolute top-1/2 left-1/2"
          style={{ transform: `translate(-50%, -50%) scale(${fit})` }}
        >
          <device.Frame>
            <iframe
              key={`${route}#${trip}`}
              src={route}
              title={`Consistently on ${device.name}`}
              className="block h-full w-full border-0"
              onLoad={(event) => {
                try {
                  const inner = event.currentTarget.contentWindow;
                  if (inner) setPath(inner.location.pathname);
                } catch {
                  // A cross-origin frame would land here; ours never is.
                }
              }}
            />
          </device.Frame>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline px-5 py-3 text-[11px] text-grey-on-surface sm:px-7">
        <p className="tabular-nums">
          <span className="text-ink">{path}</span>
          <span aria-hidden="true"> · </span>
          {device.screen.width} × {device.screen.height} css px
          <span aria-hidden="true"> · </span>
          {Math.round(fit * 100)}% to fit
        </p>
        <p>Not product. Delete app/preview/ to remove it.</p>
      </footer>
    </div>
  );
}

/** The instrument panel's one control: a hairline pill, the active leg filled. */
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] tracking-[0.18em] text-grey-on-surface uppercase">
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="flex items-center gap-1 rounded-full border border-hairline bg-panel p-1"
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] transition-colors duration-150",
                active
                  ? "bg-ink text-ground"
                  : "text-grey-on-surface hover:text-ink",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
