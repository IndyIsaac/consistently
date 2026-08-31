import { cookies } from "next/headers";
import { FrontDoor } from "@/components/FrontDoor";
import { INVITE_COOKIE } from "@/proxy";

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
export default async function Landing() {
  /**
   * Read here because only the server can. proxy.ts stashes a scanned invite
   * in an httpOnly cookie and strips it from the address, which leaves the
   * door unable to see it -- and the door is the one place that needs it, to
   * put it back on the link into Phantom's browser, whose cookie jar is not
   * this one.
   */
  const invite = (await cookies()).get(INVITE_COOKIE)?.value ?? null;

  return <FrontDoor invite={invite} />;
}
