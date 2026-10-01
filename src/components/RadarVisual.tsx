export function RadarVisual({ scanning = false, blips = 3 }: { scanning?: boolean; blips?: number }) {
  const positions = Array.from({ length: blips }).map((_, i) => {
    const angle = (i / Math.max(blips, 1)) * Math.PI * 1.6 + 0.4;
    const radius = 40 + ((i * 23) % 60);
    return { x: 110 + Math.cos(angle) * radius, y: 110 + Math.sin(angle) * radius };
  });

  return (
    <svg viewBox="0 0 220 220" className="h-full w-full" role="img" aria-label="Radar visualization">
      {[95, 70, 45, 20].map((r) => (
        <circle key={r} cx="110" cy="110" r={r} fill="none" stroke="currentColor" className="text-borderStrong transition-theme" strokeWidth="1" />
      ))}
      <line x1="110" y1="15" x2="110" y2="205" stroke="currentColor" className="text-border transition-theme" strokeWidth="1" />
      <line x1="15" y1="110" x2="205" y2="110" stroke="currentColor" className="text-border transition-theme" strokeWidth="1" />

      {positions.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="4"
          className={`fill-blip transition-theme ${!scanning ? "pulse-dot" : ""}`}
          style={!scanning ? { animationDelay: `${i * 300}ms` } : undefined}
          opacity={scanning ? 1 : 0.7}
        />
      ))}

      {scanning ? (
        <g className="radar-sweep" style={{ transformOrigin: "110px 110px" }}>
          <path d="M110 110 L110 15 A95 95 0 0 1 178 47 Z" fill="url(#sweepGradient)" opacity="0.5" />
        </g>
      ) : (
        <g className="radar-idle" style={{ transformOrigin: "110px 110px" }}>
          <path d="M110 110 L110 15 A95 95 0 0 1 143 22 Z" fill="url(#sweepGradient)" opacity="0.25" />
        </g>
      )}

      <defs>
        <linearGradient id="sweepGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--signal))" stopOpacity="0.6" />
          <stop offset="100%" stopColor="rgb(var(--signal))" stopOpacity="0" />
        </linearGradient>
      </defs>

      <circle cx="110" cy="110" r="3" className="fill-signal-text transition-theme" />
    </svg>
  );
}
