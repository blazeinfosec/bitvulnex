export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <defs>
          <linearGradient id="bvbe-hex" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FCD535" />
            <stop offset="100%" stopColor="#F0B90B" />
          </linearGradient>
        </defs>
        <polygon
          points="12,2 21,7 21,17 12,22 3,17 3,7"
          fill="url(#bvbe-hex)"
        />
        <line
          x1="6"
          y1="18"
          x2="18"
          y2="6"
          stroke="#0B0E11"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-text font-bold tracking-tight text-lg">Bitvulnex</span>
    </div>
  );
}
