import { FrontDoor } from "@/components/FrontDoor";

/**
 * The landing surface, and the only one that runs on the inverse of the app's
 * theme: near-black under a light app, bone under a dark one. One line, a START
 * press, and the sign-in it reveals. It says nothing about what the product does
 * — the mystery is deliberate.
 *
 * The two registers are always opposite. That is what makes crossing the
 * threshold read as arrival rather than a page change, and it is the whole
 * reason dark mode was let in at all.
 */
export default function Landing() {
  return <FrontDoor />;
}
