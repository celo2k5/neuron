// The NEURON mark: three afferent dendrites from input nodes converge on a lit soma.
export const C = { bg: "#080B12", bg2: "#0F1628", fg: "#EEF4FF", a: "#4D8DFF", b: "#8BE9FF" };
const SOMA = [44, 32];
// tapered dendrite: a filled ribbon from width w0 at the input to w1 at the soma
function ribbon(p0, c1, c2, p1, w0, w1) {
  const N = 28, L = [], R = [];
  const at = (t) => { const u = 1 - t; return [u*u*u*p0[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*p1[0], u*u*u*p0[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*p1[1]]; };
  for (let i = 0; i <= N; i++) {
    const t = i / N, [x, y] = at(t), [x2, y2] = at(Math.min(1, t + 1e-3)), [x0, y0] = at(Math.max(0, t - 1e-3));
    let dx = x2 - x0, dy = y2 - y0; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = (w0 + (w1 - w0) * t * t) / 2;
    L.push([x - dy * w, y + dx * w]); R.push([x + dy * w, y - dx * w]);
  }
  const f = (p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  return `M${L.map(f).join(" L")} L${R.reverse().map(f).join(" L")} Z`;
}
const DENDRITES = [
  [[8, 11], [21, 12.5], [30, 22], SOMA],
  [[5, 32], [18, 32], [30, 32], SOMA],
  [[8, 53], [21, 51.5], [30, 42], SOMA],
];
export function mark({ id = "m", mono = null, small = false } = {}) {
  const inR = small ? 4.6 : 3.3, core = small ? 9.2 : 7.6;
  const shapes = small
    ? `<g fill="none" stroke="${mono ?? `url(#${id}-s)`}" stroke-width="6.4" stroke-linecap="round">${DENDRITES.map(([a, b, c, d]) => `<path d="M${a} C${b} ${c} ${d}"/>`).join("")}</g>`
    : `<g fill="${mono ?? `url(#${id}-s)`}">${DENDRITES.map(([a, b, c, d]) => `<path d="${ribbon(a, b, c, d, 2.6, 7.2)}"/>`).join("")}</g>`;
  const dots = DENDRITES.map(([[x, y]]) => `<circle cx="${x}" cy="${y}" r="${inR}" fill="${mono ?? C.a}"/>`).join("");
  if (mono) return `${shapes}${dots}<circle cx="${SOMA[0]}" cy="${SOMA[1]}" r="${core + 1.6}" fill="${mono}"/>`;
  const hr = small ? 17 : 21;
  return `<defs>
      <linearGradient id="${id}-s" x1="5" y1="0" x2="42" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.a}"/><stop offset=".55" stop-color="#6FB8FF"/><stop offset="1" stop-color="${C.b}"/></linearGradient>
      <radialGradient id="${id}-h" cx="${SOMA[0]}" cy="${SOMA[1]}" r="${hr}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.b}" stop-opacity=".8"/><stop offset=".42" stop-color="${C.a}" stop-opacity=".26"/><stop offset="1" stop-color="${C.a}" stop-opacity="0"/></radialGradient>
      <radialGradient id="${id}-c" cx="42.2" cy="29.8" r="${core}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#CFE9FF"/></radialGradient>
    </defs>
    <circle cx="${SOMA[0]}" cy="${SOMA[1]}" r="${hr}" fill="url(#${id}-h)"/>
    ${shapes}${dots}
    <circle cx="${SOMA[0]}" cy="${SOMA[1]}" r="${core + 2.2}" fill="${C.b}" opacity=".32"/>
    <circle cx="${SOMA[0]}" cy="${SOMA[1]}" r="${core}" fill="url(#${id}-c)"/>`;
}
// bbox of the solid parts (no halo), used for optical centring
export const BBOX = { x0: 1.7, x1: 54, y0: 7.7, y1: 56.3 };
export const svg = (w, h, body, vb = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`;
/** the mark fitted into a box of side `s` with margin `m`, optically centred (nudged right for the halo) */
export function fitted(s, m, opts = {}) {
  const bw = BBOX.x1 - BBOX.x0, bh = BBOX.y1 - BBOX.y0, k = (s - 2 * m) / Math.max(bw, bh);
  const tx = (s - bw * k) / 2 - BBOX.x0 * k - s * 0.015, ty = (s - bh * k) / 2 - BBOX.y0 * k;
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})">${mark(opts)}</g>`;
}
/** app icon: mark on a rounded obsidian tile */
export function tile({ size = 512, small = false, radius = 0.225, margin = 0.2, bg = true } = {}) {
  const S = 512, rx = S * radius;
  return svg(size, size, `<defs><linearGradient id="t-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg2}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
      <radialGradient id="t-g" cx=".62" cy=".5" r=".55"><stop offset="0" stop-color="${C.a}" stop-opacity=".16"/><stop offset="1" stop-color="${C.a}" stop-opacity="0"/></radialGradient></defs>
    ${bg ? `<rect width="${S}" height="${S}" rx="${rx}" fill="url(#t-bg)"/><rect width="${S}" height="${S}" rx="${rx}" fill="url(#t-g)"/>${radius ? `<rect x="2" y="2" width="${S - 4}" height="${S - 4}" rx="${rx - 2}" fill="none" stroke="${C.b}" stroke-opacity=".13" stroke-width="4"/>` : ""}` : ""}
    ${fitted(S, S * margin, { id: "t", small })}`, `0 0 ${S} ${S}`);
}
