import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/home/claude/neuron/node_modules/@playwright/test/index.mjs";
import { tile } from "./mark.mjs";
writeFileSync("out/maskable.svg", tile({ size: 512, radius: 0, margin: 0.3 }));   // Android safe zone: mark inside the inner 40%
writeFileSync("out/favicon-small.svg", tile({ size: 64, small: true, radius: 0.2, margin: 0.07 }));
const jobs = [
  ["favicon-small.svg", "favicon-16.png", 16, 16], ["favicon-small.svg", "favicon-32.png", 32, 32], ["favicon-small.svg", "favicon-48.png", 48, 48],
  ["app-icon.svg", "apple-touch-icon.png", 180, 180, "#080B12"], ["app-icon.svg", "icon-192.png", 192, 192], ["app-icon.svg", "icon-512.png", 512, 512],
  ["maskable.svg", "icon-maskable-512.png", 512, 512], ["avatar.svg", "avatar-400.png", 400, 400],
  ["logo-mark.svg", "logo-mark-1024.png", 1024, 1024], ["logo-mark-black.svg", "logo-mark-black-1024.png", 1024, 1024], ["logo-mark-white.svg", "logo-mark-white-1024.png", 1024, 1024],
];
for (const f of ["logo-horizontal-on-dark", "logo-horizontal-on-light", "logo-horizontal-black", "logo-horizontal-white"]) {
  const s = readFileSync(`out/${f}.svg`, "utf8"); const [, w, h] = s.match(/width="(\d+)" height="(\d+)"/);
  jobs.push([`${f}.svg`, `${f}.png`, 1200, Math.round(1200 * h / w)]);
}
const b = await chromium.launch(); const p = await b.newPage();
for (const [src, out, w, h, bg] of jobs) {
  const s = readFileSync(`out/${src}`, "utf8").replace(/width="[\d.]+" height="[\d.]+"/, `width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"`);
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;${bg ? `background:${bg}` : "background:transparent"}">${s}</body></html>`);
  await p.screenshot({ path: `out/${out}`, omitBackground: !bg, clip: { x: 0, y: 0, width: w, height: h } });
}
await b.close();
