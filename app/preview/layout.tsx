import type { Metadata } from "next";

/**
 * DEV SURFACE — not part of the product.
 *
 * Nothing in the app links here and nothing should: the harness exists to look
 * at the product from outside it. Kept out of the (app) group deliberately, so
 * it gets neither the header nor the bottom nav, and kept out of any index.
 */
export const metadata: Metadata = {
  title: "Device preview · dev",
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
