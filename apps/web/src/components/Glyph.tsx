/** The NEURON mark: a 3-2-1 micro network whose signal pulses left to right. Pure SVG + CSS. */
export function Glyph({ size = 26 }: { size?: number }) {
  const n = [[4, 5], [4, 13], [4, 21], [13, 9], [13, 17], [22, 13]];
  const e = [[0, 3], [0, 4], [1, 3], [1, 4], [2, 3], [2, 4], [3, 5], [4, 5]];
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden className="shrink-0">
      <style>{`
        .ng-e{stroke:var(--faint);stroke-width:.8}
        .ng-p{stroke:var(--accent-2);stroke-width:1.2;stroke-dasharray:3 40;animation:ngp 2.4s linear infinite}
        .ng-n{fill:var(--fg)}
        .ng-o{fill:var(--accent);animation:ngo 2.4s ease-in-out infinite}
        @keyframes ngp{from{stroke-dashoffset:3}to{stroke-dashoffset:-40}}
        @keyframes ngo{0%,55%{opacity:.35}75%{opacity:1}100%{opacity:.35}}
        @media (prefers-reduced-motion: reduce){.ng-p,.ng-o{animation:none}}
      `}</style>
      {e.map(([a, b], i) => <line key={i} className="ng-e" x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} />)}
      {e.map(([a, b], i) => <line key={`p${i}`} className="ng-p" style={{ animationDelay: `${(n[a][0] / 22) * 1.2}s` }} x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} />)}
      {n.map(([x, y], i) => <circle key={i} className={i === 5 ? "ng-o" : "ng-n"} cx={x} cy={y} r={i === 5 ? 2.6 : 1.7} />)}
    </svg>
  );
}
