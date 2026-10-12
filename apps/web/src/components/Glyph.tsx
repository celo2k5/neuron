import { useId } from "react";

const D = ["M9 12 C21 13.5 30 22 44 32", "M5 32 C18 32 30 32 44 32", "M9 52 C21 50.5 30 42 44 32"];
const IN: [number, number][] = [[9, 12], [5, 32], [9, 52]];

/**
 * The Neuron mark: three dendrites from input nodes converge on a lit soma.
 * Same geometry as brand/ (logo-mark.svg), drawn with the active theme's colours,
 * with a signal pulse travelling along each dendrite.
 */
export function Glyph({ size = 24 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 58 64" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${id}s`} x1="5" y1="0" x2="44" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
        <radialGradient id={`${id}h`} cx="44" cy="32" r="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent-2)" stopOpacity=".7" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <style>{`.ng-p{stroke:var(--fg);stroke-width:3.4;stroke-linecap:round;fill:none;stroke-dasharray:3 60;animation:ngp 2.8s cubic-bezier(.4,0,.2,1) infinite}
        @keyframes ngp{from{stroke-dashoffset:3}to{stroke-dashoffset:-60}}
        @media (prefers-reduced-motion: reduce){.ng-p{animation:none;opacity:0}}`}</style>
      <circle cx="44" cy="32" r="16" fill={`url(#${id}h)`} />
      <g fill="none" stroke={`url(#${id}s)`} strokeWidth="5.4" strokeLinecap="round">{D.map((d) => <path key={d} d={d} />)}</g>
      {D.map((d, i) => <path key={i} className="ng-p" d={d} style={{ animationDelay: `${i * 0.3}s` }} />)}
      {IN.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="var(--accent)" />)}
      <circle cx="44" cy="32" r="10.2" fill="var(--accent-2)" opacity=".3" />
      <circle cx="44" cy="32" r="8" fill="var(--fg)" />
    </svg>
  );
}
