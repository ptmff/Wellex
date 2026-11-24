import { useId } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { PriceLinePoint } from "@/api/markets";
import { useI18n } from "@/i18n/useI18n";

export default function PriceChart({ data, intraday }: { data: PriceLinePoint[]; intraday: boolean }) {
  const { language, locale } = useI18n();
  const id = useId();
  const tickDate = new Intl.DateTimeFormat(locale, intraday
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric" });
  const pointDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const formatPrice = (value: number) => `${value.toLocaleString(locale, { maximumFractionDigits: 2 })}¢`;
  const points = data.map((point) => ({ time: point.time * 1000, yes: point.yesPrice * 100, no: point.noPrice * 100 }));
  const timestamp = points[0].time;
  const domain = points.length === 1 ? [timestamp - 60_000, timestamp + 60_000] : ["dataMin", "dataMax"];

  return (
    <div
      role="group"
      aria-label={language === "ru" ? "График цены ДА и НЕТ" : "YES and NO price chart"}
      className="h-[240px] min-w-0 sm:h-[280px]"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} accessibilityLayer>
          <defs>
            <linearGradient id={`${id}-yes`} x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.18} />
              <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`${id}-no`} x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--danger))" stopOpacity={0.12} />
              <stop offset="100%" stopColor="hsl(var(--danger))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="time"
            type="number"
            domain={domain}
            tickCount={5}
            tickFormatter={(value: number) => tickDate.format(value)}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            width={38}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatPrice}
          />
          <Tooltip
            labelFormatter={(value: number) => pointDate.format(value)}
            formatter={(value: number) => formatPrice(value)}
            contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8 }}
          />
          <Area
            name={language === "ru" ? "ДА" : "YES"}
            type="linear"
            dataKey="yes"
            stroke="hsl(var(--success))"
            strokeWidth={2}
            fill={`url(#${id}-yes)`}
            dot={points.length === 1}
            isAnimationActive={false}
          />
          <Area
            name={language === "ru" ? "НЕТ" : "NO"}
            type="linear"
            dataKey="no"
            stroke="hsl(var(--danger))"
            strokeWidth={1.5}
            fill={`url(#${id}-no)`}
            dot={points.length === 1}
            isAnimationActive={false}
            strokeDasharray="4 4"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
