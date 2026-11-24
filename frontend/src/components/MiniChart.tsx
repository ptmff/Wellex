import { useId } from "react";

export function MiniChart({ prices, up }: { prices: number[]; up: boolean }) {
  const id = useId();
  const points = prices.filter(Number.isFinite).map((price) => Math.max(0, Math.min(1, price)));
  if (points.length < 2) return null;

  const line = points.map((price, i) => `${i * 100 / (points.length - 1)},${38 - price * 36}`).join(" ");

  return (
    <svg
      aria-hidden="true"
      className={`h-full w-full ${up ? "text-success" : "text-danger"}`}
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={id} x2="0" y2="1">
          <stop stopColor="currentColor" stopOpacity=".2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${line} 100,40`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
