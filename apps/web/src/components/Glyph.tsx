/** The NEURON mark: a lit node with three afferent strokes converging on it. */
export function Glyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <defs>
        <radialGradient id="ng-core" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <style>{`.ng-s{stroke:var(--fg);stroke-opacity:.55;stroke-width:1.1;stroke-linecap:round;fill:none}
        .ng-p{stroke:var(--accent-2);stroke-width:1.4;stroke-linecap:round;stroke-dasharray:2 30;animation:ngp 3s cubic-bezier(.4,0,.2,1) infinite}
        @keyframes ngp{from{stroke-dashoffset:2}to{stroke-dashoffset:-30}}
        @media (prefers-reduced-motion: reduce){.ng-p{animation:none;opacity:0}}`}</style>
      {["M3 5 Q10 7 16 12", "M2 12 L16 12", "M3 19 Q10 17 16 12"].map((d, i) => (
        <g key={i}><path className="ng-s" d={d} /><path className="ng-p" d={d} style={{ animationDelay: `${i * 0.35}s` }} /></g>
      ))}
      <circle cx="17" cy="12" r="6" fill="url(#ng-core)" opacity=".55" />
      <circle cx="17" cy="12" r="2.4" fill="var(--fg)" />
    </svg>
  );
}
