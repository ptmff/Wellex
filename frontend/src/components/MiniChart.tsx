import { ResponsiveContainer, AreaChart, Area } from "recharts";

interface MiniChartProps {
  data: { time: string; yes: number }[];
  up: boolean;
}

export function MiniChart({ data, up }: MiniChartProps) {
  const color = up ? "hsl(160, 84%, 44%)" : "hsl(0, 72%, 55%)";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`gradient-${up ? "up" : "down"}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="yes"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#gradient-${up ? "up" : "down"})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
