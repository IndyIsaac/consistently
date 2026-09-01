/* ---------------------------------------------------------------------------
 * DEV SURFACE — not part of the product. Delete app/preview/ and it is gone.
 *
 * Three frames drawn to real proportions, so what the builder judges inside them
 * is the true shape of the app on a phone rather than a browser window squeezed
 * narrow. Every number below is derived from the physical device; the comments
 * say from what.
 *
 * The third is a desktop window, which is the opposite errand: the product is
 * phone-first and only the dashboard reflows above `lg`, so the width nobody was
 * looking at is the one most likely to be wrong. It is here to be judged, not
 * because it is the primary case.
 *
 * The colours here are local literals on purpose. A phone is an object in the
 * room, not a surface of the product, so it does not take the product's palette
 * and does not flip with the theme — only the screen inside it does.
 * ------------------------------------------------------------------------- */

export type DeviceId = "s25-ultra" | "iphone-16-pro" | "desktop";

export type Device = {
  id: DeviceId;
  name: string;
  /** The viewport the app is actually handed, in CSS pixels. */
  screen: { width: number; height: number };
  /** The drawn body, for fitting the frame to the stage. */
  frame: { width: number; height: number };
  Frame: (props: { children: React.ReactNode }) => React.ReactElement;
};

/** A side button: a sliver of rail standing proud of the body. */
function SideButton({
  side,
  top,
  height,
}: {
  side: "left" | "right";
  top: number;
  height: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="absolute w-[3px] bg-[#37373b]"
      style={{
        top,
        height,
        [side]: -3,
        borderRadius: side === "right" ? "0 2px 2px 0" : "2px 0 0 2px",
      }}
    />
  );
}

/* ---------------------------------------------------------------------------
 * Samsung Galaxy S25 Ultra
 *
 * 3120 × 1440 physical at 3x → a 480 × 1040 CSS viewport, which is 19.5:9 to the
 * pixel. Body 162.8 × 77.6 mm; a 1.5 mm bezel is 2% of the screen's width, so
 * 10px here, uniform on all four sides — this generation is flat, with no curve
 * to hide a wider edge behind.
 *
 * The corners are the tell. An S24 Ultra is heavily rounded; the S25 Ultra is
 * not. 46px on a 506px body is 9% of the width, against roughly 18% for an
 * iPhone — squarer by half, which is what the eye actually reads.
 * ------------------------------------------------------------------------- */

const S25_SCREEN = { width: 480, height: 1040 };
const S25_BEZEL = 10;
const S25_RAIL = 3;
const S25_INSET = S25_RAIL + S25_BEZEL;

export const galaxyS25Ultra: Device = {
  id: "s25-ultra",
  name: "Galaxy S25 Ultra",
  screen: S25_SCREEN,
  frame: {
    width: S25_SCREEN.width + S25_INSET * 2,
    height: S25_SCREEN.height + S25_INSET * 2,
  },
  Frame: function GalaxyS25UltraFrame({ children }) {
    return (
      <div
        className="relative"
        style={{
          width: S25_SCREEN.width + S25_INSET * 2,
          height: S25_SCREEN.height + S25_INSET * 2,
        }}
      >
        <SideButton side="right" top={296} height={108} />
        <SideButton side="right" top={430} height={62} />

        {/* the titanium rail */}
        <div
          className="absolute inset-0 rounded-[46px] shadow-[0_40px_80px_-34px_rgba(0,0,0,0.55)]"
          style={{
            backgroundImage:
              "linear-gradient(158deg, #56565a, #242427 20%, #45454a 49%, #1e1e21 74%, #4e4e53)",
          }}
        />

        {/* the glass, and the bezel printed under it */}
        <div className="absolute inset-[3px] rounded-[43px] bg-[#08080a]" />

        <div
          className="absolute overflow-hidden rounded-[33px] bg-ground"
          style={{ inset: S25_INSET }}
        >
          {children}
        </div>

        {/* the punch-hole camera, centred */}
        <span
          aria-hidden="true"
          className="absolute left-1/2 size-5 -translate-x-1/2 rounded-full bg-[#050506] ring-1 ring-[#1c1c1f]"
          style={{ top: S25_INSET + 8 }}
        />
      </div>
    );
  },
};

/* ---------------------------------------------------------------------------
 * iPhone 16 Pro
 *
 * 402 × 874 points. Body 149.6 × 71.5 mm behind a 1.15 mm bezel — thinner than
 * the Samsung's, and the corner radius is roughly 12.6 mm, 18% of the width.
 * The Dynamic Island is 125 × 36 pt, 11 pt below the top of the screen.
 *
 * The builder's list carries `beratberkayg/iphone`; its registry needs an API
 * key this machine does not hold, and the install fails on authentication. This
 * is the equivalent, built to the same measurements.
 * ------------------------------------------------------------------------- */

const IPHONE_SCREEN = { width: 402, height: 874 };
const IPHONE_BEZEL = 8;
const IPHONE_RAIL = 3;
const IPHONE_INSET = IPHONE_RAIL + IPHONE_BEZEL;

export const iPhone16Pro: Device = {
  id: "iphone-16-pro",
  name: "iPhone 16 Pro",
  screen: IPHONE_SCREEN,
  frame: {
    width: IPHONE_SCREEN.width + IPHONE_INSET * 2,
    height: IPHONE_SCREEN.height + IPHONE_INSET * 2,
  },
  Frame: function IPhone16ProFrame({ children }) {
    return (
      <div
        className="relative"
        style={{
          width: IPHONE_SCREEN.width + IPHONE_INSET * 2,
          height: IPHONE_SCREEN.height + IPHONE_INSET * 2,
        }}
      >
        <SideButton side="left" top={148} height={32} />
        <SideButton side="left" top={212} height={64} />
        <SideButton side="left" top={292} height={64} />
        <SideButton side="right" top={232} height={96} />

        <div
          className="absolute inset-0 rounded-[74px] shadow-[0_40px_80px_-34px_rgba(0,0,0,0.55)]"
          style={{
            backgroundImage:
              "linear-gradient(158deg, #5d5d61, #2a2a2d 20%, #4b4b50 49%, #232326 74%, #55555a)",
          }}
        />

        <div className="absolute inset-[3px] rounded-[71px] bg-[#08080a]" />

        <div
          className="absolute overflow-hidden rounded-[63px] bg-ground"
          style={{ inset: IPHONE_INSET }}
        >
          {children}
        </div>

        {/* the Dynamic Island */}
        <span
          aria-hidden="true"
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-[#050506]"
          style={{ top: IPHONE_INSET + 11, width: 125, height: 36 }}
        />
      </div>
    );
  },
};

/* ---------------------------------------------------------------------------
 * Desktop
 *
 * 1440 × 900 CSS pixels — a 15" laptop's viewport once the browser's own chrome
 * is off the top. That width is the one worth judging because it is the first
 * past Tailwind's `lg` (1024px), which is where app/(app)/dashboard/page.tsx
 * stops stacking its pact cards and lays them two across. Narrower than that and
 * the desktop layout is only the phone layout with more air around it.
 *
 * Every page is capped at `max-w-[54rem]` (864px) and centred, so what this
 * frame shows at 1440 is a column with roughly 290px of bare ground either side.
 * That is the honest picture, and seeing it is the point.
 *
 * A window, not a laptop body. A lid, a hinge and a keyboard would be three
 * things the app is not in, and the thing being judged is the viewport — so the
 * chrome stops at the title bar.
 *
 * The three dots are grey rather than the usual red/amber/green. This is a dev
 * surface and the frame is not a product surface, but DESIGN.md spends the
 * product's only red and only green on money lost and money gained, and putting
 * a red dot an inch from a forfeit figure is not worth the realism.
 * ------------------------------------------------------------------------- */

const DESKTOP_SCREEN = { width: 1440, height: 900 };
const DESKTOP_BEZEL = 3;
/** The title bar. Tall enough to read as chrome, short enough not to be the subject. */
const DESKTOP_CHROME = 36;

export const desktop: Device = {
  id: "desktop",
  name: "Desktop",
  screen: DESKTOP_SCREEN,
  frame: {
    width: DESKTOP_SCREEN.width + DESKTOP_BEZEL * 2,
    height: DESKTOP_SCREEN.height + DESKTOP_CHROME + DESKTOP_BEZEL * 2,
  },
  Frame: function DesktopFrame({ children }) {
    return (
      <div
        className="relative"
        style={{
          width: DESKTOP_SCREEN.width + DESKTOP_BEZEL * 2,
          height: DESKTOP_SCREEN.height + DESKTOP_CHROME + DESKTOP_BEZEL * 2,
        }}
      >
        {/* the body, in the same metal as the phone rails so the three frames
            read as one set of objects on one bench */}
        <div
          className="absolute inset-0 rounded-[14px] shadow-[0_40px_80px_-34px_rgba(0,0,0,0.55)]"
          style={{
            backgroundImage: "linear-gradient(158deg, #45454a, #242427 55%, #38383d)",
          }}
        />

        {/* the title bar */}
        <div
          className="absolute flex items-center gap-2 px-3.5"
          style={{
            top: DESKTOP_BEZEL,
            left: DESKTOP_BEZEL,
            width: DESKTOP_SCREEN.width,
            height: DESKTOP_CHROME,
          }}
        >
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              aria-hidden="true"
              className="size-3 rounded-full bg-[#4d4d52]"
            />
          ))}
        </div>

        <div
          className="absolute overflow-hidden rounded-b-[11px] bg-ground"
          style={{
            top: DESKTOP_BEZEL + DESKTOP_CHROME,
            left: DESKTOP_BEZEL,
            width: DESKTOP_SCREEN.width,
            height: DESKTOP_SCREEN.height,
          }}
        >
          {children}
        </div>
      </div>
    );
  },
};

export const DEVICES: Device[] = [galaxyS25Ultra, iPhone16Pro, desktop];
