import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Did this fail because we stopped waiting, rather than because it was refused?
 *
 * `AbortSignal.timeout` rejects with a `TimeoutError`, and the difference
 * matters most where money is involved: a request that timed out may well have
 * been carried out anyway. Telling somebody a stake or a settlement "did not go
 * through" is what makes them do it again, so the sites that can broadcast say
 * something narrower and true instead.
 *
 * `Error` rather than `DOMException`: the browser throws the latter, which is
 * an `Error`, and Node throws a plain `Error` with the same name -- so this one
 * predicate is right on both sides of the app.
 */
export function isTimeout(e: unknown): boolean {
  return e instanceof Error && e.name === "TimeoutError";
}
