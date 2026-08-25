"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { isTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/* ---------------------------------------------------------------------------
 * The theme is not React state. It lives in two places React does not own —
 * `localStorage` and the operating system's preference — and both can change
 * from outside this document: a second tab, or the device preview harness at
 * /preview driving the app it frames. So it is read as an external store, and
 * React subscribes to it rather than the other way round.
 * ------------------------------------------------------------------------- */

type Snapshot = {
  /** The explicit choice, or null while the system is deciding. */
  chosen: Theme | null;
  system: Theme;
  /** False on the server and through hydration: nothing has been read yet. */
  ready: boolean;
};

const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

const UNREAD: Snapshot = { chosen: null, system: "light", ready: false };

let snapshot: Snapshot = UNREAD;
let hasRead = false;
/** Held in memory too, in case a privacy mode refuses the write. */
let override: Theme | null = null;

const listeners = new Set<() => void>();

function measure(): Snapshot {
  let chosen = override;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) chosen = stored;
  } catch {
    // No storage. `override` carries the choice for this page.
  }
  return {
    chosen,
    system: window.matchMedia(SYSTEM_QUERY).matches ? "dark" : "light",
    ready: true,
  };
}

function publish() {
  const next = measure();
  if (
    snapshot.ready &&
    next.chosen === snapshot.chosen &&
    next.system === snapshot.system
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  // `key` is null when storage was cleared wholesale.
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
  // Another document is authoritative over anything held here.
  override = null;
  publish();
}

let media: MediaQueryList | null = null;

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    media = window.matchMedia(SYSTEM_QUERY);
    media.addEventListener("change", publish);
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      media?.removeEventListener("change", publish);
      window.removeEventListener("storage", onStorage);
      media = null;
    }
  };
}

function getSnapshot(): Snapshot {
  if (!hasRead) {
    hasRead = true;
    snapshot = measure();
  }
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return UNREAD;
}

function paint(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function choose(theme: Theme) {
  override = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // See `override`.
  }
  paint(theme);
  publish();
}

type ThemeState = {
  /** What is on screen. Before `ready` it is the server's guess, not the truth. */
  theme: Theme;
  /** True while nobody has chosen and the system is deciding. */
  isSystem: boolean;
  /** Nothing theme-dependent should render before this. */
  ready: boolean;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { chosen, system, ready } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const theme = chosen ?? system;

  // THEME_BOOT_SCRIPT already put the right class on <html> before the first
  // paint. This only keeps it there as the store changes — including when the
  // change came from another document entirely.
  useEffect(() => {
    if (!ready) return;
    paint(theme);
  }, [ready, theme]);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      isSystem: chosen === null,
      ready,
      setTheme: choose,
      toggle: () => choose(theme === "dark" ? "light" : "dark"),
    }),
    [theme, chosen, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>.");
  return value;
}
