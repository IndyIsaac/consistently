# Crew faces

Portraits for the seeded demo crew, so a demo shows people rather than a wall of
initials. Every image is from [Unsplash](https://unsplash.com) under the
[Unsplash License](https://unsplash.com/license), which grants free use --
commercial and non-commercial -- without permission. Same convention as
`public/community-photos/CREDITS.md`; attribution is here because it costs
nothing and makes a later swap easy.

Each file is named for the seat it fills in `scripts/seed-demo.ts`, so replacing
one is a single file drop with no code change.

| File | Unsplash photo | Seat |
|---|---|---|
| `indy.jpg` | photo-1633332755192-727a05c4013d | Indy -- taken by the real signed-in account when there is one |
| `nat.jpg` | photo-1494790108377-be9c29b29330 | Nat Suwannarat |
| `pim.jpg` | photo-1438761681033-6461ffad8d80 | Pim Chaiyaphum |
| `dave.jpg` | photo-1507003211169-0a1dd7228f2d | Dave Whitfield |
| `kwan.jpg` | photo-1544005313-94ddf0286df2 | Kwan Ratanakul |

Fetched at 256x256, face-cropped, quality 80 -- every one is under 15KB, and
they are committed rather than hotlinked so a demo never waits on someone
else's CDN.
