export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#14181e" />
      <rect x="1.25" y="1.25" width="61.5" height="61.5" rx="13" fill="none" stroke="#C9A06A" strokeOpacity="0.45" />
      <g stroke="#C9A06A" strokeWidth="4.5" strokeLinecap="square" fill="none">
        <path d="M14 24 V16 H24" />
        <path d="M40 16 H50 V24" />
        <path d="M14 40 V48 H24" />
        <path d="M50 40 V48 H40" />
      </g>
      <text
        x="32"
        y="34.5"
        fill="#F3EFE8"
        fontFamily="Inter, sans-serif"
        fontSize="18"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="central"
      >
        GG
      </text>
    </svg>
  );
}
