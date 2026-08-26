"use client";

import { QRCodeSVG } from "qrcode.react";

/* ---------------------------------------------------------------------------
 * A QR code, on a white plate, in either theme.
 *
 * A QR is a physical object being pointed at a camera, and an inverted one is
 * refused outright by some scanners -- so the plate stays white and the dark
 * ground simply sits behind it. `level="M"` leaves a quarter of the code
 * recoverable, which is what covers a hand shake and a phone's autofocus
 * hunting.
 *
 * Two things scan one of these: a room joining a pact, and a wallet app
 * sending money to an address. Both want exactly the treatment above, which is
 * why it lives here rather than twice.
 * ------------------------------------------------------------------------- */

export function CodePlate({
  value,
  size = 252,
  title,
  className,
}: {
  /** Empty renders a blank plate of the same size -- see below. */
  value: string;
  size?: number;
  title: string;
  className?: string;
}) {
  return (
    <div className={`rounded-[20px] bg-white p-5 ${className ?? ""}`}>
      {value ? (
        <QRCodeSVG
          value={value}
          size={size}
          level="M"
          marginSize={0}
          bgColor="#FFFFFF"
          fgColor="#0A0A0A"
          title={title}
          className="block h-auto w-full"
          style={{ maxWidth: size }}
        />
      ) : (
        // One frame, before the value is knowable on the client. Sized to the
        // code so the panel around it does not resize under the reader.
        <div style={{ width: size, height: size }} aria-hidden="true" />
      )}
    </div>
  );
}
