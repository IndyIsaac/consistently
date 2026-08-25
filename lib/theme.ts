/**
 * The two registers of DESIGN.md are a single switch: `.dark` on <html>.
 *
 * This file holds the parts both the server and the client need — the key, the
 * type guard, and the script that has to run before the first paint.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "consistently-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Runs synchronously in <head>, so the ground is already the right value when
 * the page first paints. Without it the app renders white, then flips — which is
 * the exact effect the front door reserves for arrival.
 *
 * No stored choice means follow the system; the provider keeps following it
 * until someone touches the toggle. Everything is inside a try/catch because
 * `localStorage` throws outright in some privacy modes.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var t=(s==="dark"||s==="light")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`;
