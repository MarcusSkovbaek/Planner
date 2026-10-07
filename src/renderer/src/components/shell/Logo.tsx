export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="planner-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b7bf2" />
          <stop offset="1" stopColor="#4646c6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill="url(#planner-logo)" />
      <rect x="7" y="8" width="11" height="4.2" rx="2.1" fill="#fff" />
      <rect x="7" y="14" width="18" height="4.2" rx="2.1" fill="#fff" fillOpacity="0.92" />
      <rect x="13" y="20" width="12" height="4.2" rx="2.1" fill="#fff" fillOpacity="0.7" />
    </svg>
  );
}
