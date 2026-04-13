import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useI18n } from "@/i18n/I18nContext";

interface PriceChartProps {
  data: { time: string; yes: number; no: number }[];
}

const CustomTooltip = ({ active, payload, label, language }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-lg px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="text-success font-medium">{language === "ru" ? "ДА" : "YES"}: {payload[0]?.value}¢</p>
      <p className="text-danger font-medium">{language === "ru" ? "НЕТ" : "NO"}: {payload[1]?.value}¢</p>
    </div>
  );
};

export function PriceChart({ data }: PriceChartProps) {
  const { language } = useI18n();
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradientYes" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(160, 84%, 44%)" stopOpacity={0.15} />
            <stop offset="100%" stopColor="hsl(160, 84%, 44%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradientNo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(0, 72%, 55%)" stopOpacity={0.1} />
            <stop offset="100%" stopColor="hsl(0, 72%, 55%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 16%)" />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}¢`}
        />
        <Tooltip content={<CustomTooltip language={language} />} />
        <Area
          type="monotone"
          dataKey="yes"
          stroke="hsl(160, 84%, 44%)"
          strokeWidth={2}
          fill="url(#gradientYes)"
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="no"
          stroke="hsl(0, 72%, 55%)"
          strokeWidth={1.5}
          fill="url(#gradientNo)"
          dot={false}
          strokeDasharray="4 4"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
