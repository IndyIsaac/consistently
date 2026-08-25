import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Two registers, per DESIGN.md.
 *
 * `Manrope` is the one grotesque of the white world — everything past sign-in.
 * `JetBrains_Mono` belongs to the dark front door alone (app/page.tsx). Nothing
 * inside the app is set in mono.
 */
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
  // Manrope is latin-only, so the Thai baht sign (฿) is always substituted.
  // Naming the stack keeps that substitution the same face on every platform
  // instead of whatever the browser reaches for first.
  fallback: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Consistently",
  description: "A group agrees a rule. Everyone stakes on keeping it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ground text-ink">{children}</body>
    </html>
  );
}
