import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import opentype from "opentype.js";
import { mark, tile, svg, fitted, C } from "./mark.mjs";
const OUT = "out"; mkdirSync(OUT, { recursive: true });
const F = (p) => "node_modules/@fontsource/" + p;
const serif = opentype.parse(readFileSync(F("newsreader/files/newsreader-latin-500-normal.woff")).buffer.slice(0));
const net = JSON.parse(readFileSync("net.json", "utf8"));

// ---------- wordmark as outlines ----------
// opentype's toPathData(decimals) emits NaN for some coordinates; serialise the commands ourselves
const n2 = (v) => (Math.round(v * 100) / 100).toString();
const pathData = (p) => p.commands.map((c) => c.type === "M" || c.type === "L" ? `${c.type}${n2(c.x)} ${n2(c.y)}`
  : c.type === "Q" ? `Q${n2(c.x1)} ${n2(c.y1)} ${n2(c.x)} ${n2(c.y)}` : c.type === "C" ? `C${n2(c.x1)} ${n2(c.y1)} ${n2(c.x2)} ${n2(c.y2)} ${n2(c.x)} ${n2(c.y)}` : "Z").join("");
function word(text, size, track = -0.018) {
  let x = 0; const parts = [];
  const glyphs = serif.stringToGlyphs(text);
  glyphs.forEach((g, i) => {
    parts.push(pathData(g.getPath(x, 0, size)));
    x += g.advanceWidth * size / serif.unitsPerEm + track * size;
    if (i < glyphs.length - 1) x += (Number(serif.getKerningValue(g, glyphs[i + 1])) || 0) * size / serif.unitsPerEm;
  });
  const bb = serif.getPath(text, 0, 0, size).getBoundingBox();
  return { d: parts.join(""), w: x - track * size, asc: -bb.y1, desc: bb.y2, capH: serif.tables.os2.sCapHeight * size / serif.unitsPerEm };
}
// horizontal lockup: mark height = 1.42 × cap height, gap = 0.36 × mark
function lockup(textColor, { mono = null } = {}) {
  const W = word("Neuron", 100), cap = W.capH, mh = cap * 1.55, gap = mh * 0.3;
  const markBox = mh * 1.08;
  const H = Math.ceil(Math.max(markBox, W.asc + W.desc) + 8), base = (H + cap) / 2;
  const total = Math.ceil(markBox + gap + W.w + 4);
  const body = `<g transform="translate(0 ${(H - markBox) / 2})">${svg(markBox, markBox, fitted(markBox, 0, mono ? { mono } : { id: "lk" })).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g>
    <path transform="translate(${markBox + gap} ${base})" d="${W.d}" fill="${textColor}"/>`;
  return svg(total, H, body);
}
const files = {
  "logo-mark.svg": svg(512, 512, fitted(512, 40, { id: "mk" })),
  "logo-mark-black.svg": svg(512, 512, fitted(512, 40, { mono: "#0B0E14" })),
  "logo-mark-white.svg": svg(512, 512, fitted(512, 40, { mono: "#FFFFFF" })),
  "logo-horizontal-on-dark.svg": lockup(C.fg),
  "logo-horizontal-on-light.svg": lockup("#0B0E14"),
  "logo-horizontal-black.svg": lockup("#0B0E14", { mono: "#0B0E14" }),
  "logo-horizontal-white.svg": lockup("#FFFFFF", { mono: "#FFFFFF" }),
  "app-icon.svg": tile({ size: 512 }),
  "favicon.svg": tile({ size: 64, small: true, radius: 0.2, margin: 0.07 }),
};
for (const [k, v] of Object.entries(files)) writeFileSync(`${OUT}/${k}`, v);

// ---------- network drawing from the real model ----------
function drawNet(n, box, { fadeLeft = 0, somaR = 26 } = {}) {
  const xs = n.nodes.map((p) => p.x), ys = n.nodes.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (box.w) / (x1 - x0), sy = box.h / (y1 - y0);
  const last = Math.max(...n.nodes.map((p) => p.layer));
  // pull the output node to the box's soma point so the network converges on it
  const P = n.nodes.map((p) => p.layer === last ? [box.x + box.w, box.y + box.h * 0.5] : [box.x + (p.x - x0) * sx, box.y + (p.y - y0) * sy]);
  const op = (x) => fadeLeft ? Math.max(0, Math.min(1, (x - box.x) / (box.w * fadeLeft))) : 1;
  const edges = [...n.edges].sort((a, b) => a.f - b.f).map((e) => {
    const [ax, ay] = P[e.s], [bx, by] = P[e.t];
    const strong = e.f, pos = e.w >= 0;
    const o = (0.05 + strong * 0.6) * op((ax + bx) / 2);
    if (o < 0.02) return "";
    const mx = (ax + bx) / 2;
    return `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)} C${mx.toFixed(1)} ${ay.toFixed(1)} ${mx.toFixed(1)} ${by.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}" stroke="${pos ? C.b : C.a}" stroke-opacity="${o.toFixed(3)}" stroke-width="${(0.6 + strong * 1.6).toFixed(2)}" fill="none"/>`;
  }).join("");
  const nodes = n.nodes.map((p, i) => {
    if (p.layer === last) return "";
    const [x, y] = P[i], a = Math.min(1, Math.abs(p.a)), o = op(x);
    const r = (p.r * 0.9 + a * 2.2);
    return `${a > 0.55 ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 3.2).toFixed(1)}" fill="url(#ng)" opacity="${(o * a * 0.7).toFixed(3)}"/>` : ""}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${a > 0.4 ? C.fg : "#9DB4E0"}" opacity="${(o * (0.35 + a * 0.65)).toFixed(3)}"/>`;
  }).join("");
  const [sxp, syp] = [box.x + box.w, box.y + box.h * 0.5];
  const soma = `<circle cx="${sxp}" cy="${syp}" r="${somaR * 4.2}" fill="url(#sh)"/><circle cx="${sxp}" cy="${syp}" r="${somaR * 1.3}" fill="${C.b}" opacity=".3"/><circle cx="${sxp}" cy="${syp}" r="${somaR}" fill="url(#sc)"/>`;
  return `<defs>
    <radialGradient id="ng"><stop offset="0" stop-color="${C.b}" stop-opacity=".55"/><stop offset="1" stop-color="${C.b}" stop-opacity="0"/></radialGradient>
    <radialGradient id="sh"><stop offset="0" stop-color="${C.b}" stop-opacity=".55"/><stop offset=".35" stop-color="${C.a}" stop-opacity=".18"/><stop offset="1" stop-color="${C.a}" stop-opacity="0"/></radialGradient>
    <radialGradient id="sc" cx=".42" cy=".4"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#CFE9FF"/></radialGradient>
  </defs><g>${edges}</g><g>${nodes}</g>${soma}`;
}

const fontCss = `@font-face{font-family:NS;src:url(${F("newsreader/files/newsreader-latin-500-normal.woff2")});font-weight:500}
@font-face{font-family:NS;src:url(${F("newsreader/files/newsreader-latin-400-normal.woff2")});font-weight:400}
@font-face{font-family:GS;src:url(${F("geist-sans/files/geist-sans-latin-400-normal.woff2")});font-weight:400}
@font-face{font-family:GS;src:url(${F("geist-sans/files/geist-sans-latin-500-normal.woff2")});font-weight:500}
@font-face{font-family:GM;src:url(${F("geist-mono/files/geist-mono-latin-400-normal.woff2")})}
*{margin:0;padding:0;box-sizing:border-box}
body{background:${C.bg};color:${C.fg};-webkit-font-smoothing:antialiased;overflow:hidden}
.bg{position:absolute;inset:0;background:radial-gradient(1200px 600px at 70% 50%, #0F1A33 0%, ${C.bg} 60%)}
.grid{position:absolute;inset:0;background-image:radial-gradient(rgba(139,233,255,.09) 1px, transparent 1.2px);background-size:22px 22px;-webkit-mask-image:radial-gradient(closest-side at 60% 50%, #000, transparent)}
.h{font-family:NS;font-weight:400;letter-spacing:-.025em;line-height:.98}
.s{font-family:GS;color:#93A4C4}
.m{font-family:GM;color:#6A7CA0;letter-spacing:.02em}`;
const page = (w, h, inner) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}</style></head><body style="width:${w}px;height:${h}px;position:relative">${inner}</body></html>`;
const lockupInline = (h) => files["logo-horizontal-on-dark.svg"].replace(/^<svg ([^>]*)width="(\d+)" height="(\d+)"/, (_, rest, w, hh) => `<svg ${rest}height="${h}" width="${(h * w / hh).toFixed(1)}"`);

// X / Twitter header 1500×500 — avatar sits bottom-left, so type goes right
const xh = page(1500, 500, `<div class="bg"></div><div class="grid"></div>
  <svg width="1500" height="500" style="position:absolute;inset:0">${drawNet(net.wide, { x: 40, y: 60, w: 760, h: 380 }, { fadeLeft: 0.35, somaR: 20 })}</svg>
  <div style="position:absolute;left:910px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:22px">
    ${lockupInline(46)}
    <div class="h" style="font-size:64px">Intelligence<br>is a network.</div>
    <div class="s" style="font-size:19px">Create neurons. Build networks. Run experiments.</div>
    <div class="m" style="font-size:15px">neuronai.online</div>
  </div>`);
// Open Graph 1200×630 (link previews) and GitHub social 1280×640
const og = (w, h) => page(w, h, `<div class="bg"></div><div class="grid"></div>
  <svg width="${w}" height="${h}" style="position:absolute;inset:0">${drawNet(net.og, { x: w * 0.53, y: h * 0.17, w: w * 0.36, h: h * 0.66 }, { fadeLeft: 0.42, somaR: 22 })}</svg>
  <div style="position:absolute;left:76px;top:70px">${lockupInline(40)}</div>
  <div style="position:absolute;left:76px;bottom:76px;display:flex;flex-direction:column;gap:22px;max-width:${w * 0.5}px">
    <div class="h" style="font-size:78px">Intelligence<br>is a network.</div>
    <div class="s" style="font-size:21px;line-height:1.45">Create neurons. Build networks. Run experiments.<br>Watch computation become visible.</div>
    <div class="m" style="font-size:16px">neuronai.online</div>
  </div>`);
writeFileSync("x-header.html", xh); writeFileSync("og.html", og(1200, 630)); writeFileSync("gh.html", og(1280, 640));
// square avatar for social profiles (the app icon without rounded corners clips to circle nicely)
writeFileSync(`${OUT}/avatar.svg`, tile({ size: 400, radius: 0, margin: 0.2 }));
console.log("built", Object.keys(files).length + 1, "svgs");
