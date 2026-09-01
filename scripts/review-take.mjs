/**
 * npm run review
 *
 * A review page for a demo take. Serves docs/demo/raw and builds a contact
 * sheet from beats.json, so every still is captioned with the timestamp it
 * sits at in the video -- which is the thing you actually need when deciding
 * whether a take is usable, and what to cut.
 *
 * Prefers take.mp4 over video.webm when both are there. The raw webm is VP8
 * with no duration on its video stream and browsers scrub it badly; the mp4 is
 * what `docs/demo/README.md`'s ffmpeg line produces.
 *
 * Plain .mjs and node's own http server: no dependency, and nothing to install
 * on a machine that just wants to look at a take.
 *
 *   npm run review                          # docs/demo/raw on :3210
 *   node scripts/review-take.mjs <dir> 3211 # somewhere else, another port
 *
 * DEV SURFACE -- not part of the product.
 */
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.argv[2] ?? "docs/demo/raw";
const PORT = Number(process.argv[3] ?? 3210);

const TYPES = {
  ".png": "image/png",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
};

async function index() {
  const files = await readdir(ROOT);
  const stills = files.filter((f) => f.endsWith(".png")).sort();

  let beats = [];
  try {
    beats = JSON.parse(await readFile(path.join(ROOT, "beats.json"), "utf8"));
  } catch {
    // A take with no beats file still deserves a contact sheet.
  }
  const list = Array.isArray(beats) ? beats : (beats.beats ?? []);

  const cards = stills
    .map((file, i) => {
      const beat = list[i] ?? {};
      const label = beat.label ?? beat.name ?? beat.caption ?? file.replace(/\.png$/, "");
      const at = beat.at ?? beat.time ?? beat.offset ?? "";
      const stamp = typeof at === "number" ? fmt(at) : String(at);
      return `<figure>
        <a href="${file}" target="_blank"><img src="${file}" loading="lazy" alt="${esc(label)}"></a>
        <figcaption><b>${stamp}</b> ${esc(label)}<br><span class="f">${file}</span></figcaption>
      </figure>`;
    })
    .join("\n");

  // Prefer the re-encoded MP4 when it is there: the raw webm is VP8 with no
  // duration on its video stream, which browsers scrub badly.
  const clip = files.includes("take.mp4") ? "take.mp4" : "video.webm";

  return `<!doctype html><meta charset="utf-8"><title>Demo take — review</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; background:#0c0c0d; color:#fafafa;
         font:15px/1.5 ui-sans-serif,system-ui,sans-serif; padding:32px }
  h1 { font-size:22px; margin:0 0 4px }
  p.sub { color:#8a8a8a; margin:0 0 28px }
  video { max-width:min(100%,520px); border-radius:12px; border:1px solid #262626; display:block; margin-bottom:36px }
  .grid { display:grid; gap:22px; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)) }
  figure { margin:0 }
  img { width:100%; border-radius:10px; border:1px solid #262626; display:block; background:#171718 }
  figcaption { font-size:12px; color:#c8c8c8; margin-top:8px; line-height:1.45 }
  .f { color:#6e6e6e; font-family:ui-monospace,monospace; font-size:11px }
  a { color:inherit; text-decoration:none }
  code { background:#171718; padding:2px 6px; border-radius:5px; font-size:12px }
</style>
<h1>Demo take — review</h1>
<p class="sub">${stills.length} stills from <code>${esc(ROOT)}</code>. Click any still for full size.</p>
<video src="${clip}" controls preload="metadata"></video>
<div class="grid">${cards}</div>`;
}

function fmt(ms) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await index());
    }
    // Confined to ROOT: a resolved path that escapes it is refused rather than read.
    const file = path.resolve(ROOT, "." + url);
    if (!file.startsWith(path.resolve(ROOT))) {
      res.writeHead(403);
      return res.end("no");
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log(`review page at http://localhost:${PORT}`));
