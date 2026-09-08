import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n/I18nContext";
import { formatWx } from "@/lib/money";

type LeaderRow = {
  id: string;
  username: string;
  display_name: string | null;
  total_volume?: string | number;
  trade_count?: string | number;
  total_pnl?: string | number;
};

export default function Leaderboard() {
  const { request } = useAuth();
  const { language } = useI18n();
  const [type, setType] = useState<"volume" | "pnl" | "trades">("pnl");
  const [period, setPeriod] = useState<"7d" | "30d" | "all">("7d");

  const query = useQuery({
    queryKey: ["leaderboard", type, period],
    queryFn: () =>
      request<LeaderRow[]>(`/users/leaderboard?type=${type}&period=${period}&limit=20`, {
        method: "GET",
        authRequired: false,
      }),
  });

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold mb-4">{language === "ru" ? "Таблица лидеров" : "Leaderboard"}</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["pnl", "volume", "trades"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setType(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${type === k ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
          >
            {k === "pnl" ? "PnL" : k === "volume" ? (language === "ru" ? "Объём" : "Volume") : language === "ru" ? "Сделки" : "Trades"}
          </button>
        ))}
        {(["7d", "30d", "all"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setPeriod(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${period === k ? "bg-accent" : "text-muted-foreground"}`}
          >
            {k === "all" ? (language === "ru" ? "Всё время" : "All time") : k === "7d" ? (language === "ru" ? "Неделя" : "Week") : language === "ru" ? "Месяц" : "Month"}
          </button>
        ))}
      </div>
      {query.isError ? (
        <div className="text-sm text-destructive">{language === "ru" ? "Не удалось загрузить рейтинг" : "Failed to load leaderboard"}</div>
      ) : (
        <div className="rounded-xl border border-border/50 bg-card divide-y divide-border/40">
          {(query.data ?? []).map((row, i) => (
            <div key={row.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
                <span className="text-sm font-medium">@{row.username}</span>
              </div>
              <span className="text-sm">
                {type === "pnl"
                  ? formatWx(Number(row.total_pnl ?? 0), { signed: true })
                  : type === "volume"
                    ? formatWx(Number(row.total_volume ?? 0), { compact: true })
                    : String(row.trade_count ?? 0)}
              </span>
            </div>
          ))}
          {!query.isLoading && (query.data ?? []).length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground text-center">
              {language === "ru" ? "Пока нет данных" : "No data yet"}
            </div>
          ) : null}
        </div>
      )}
    </AppLayout>
  );
}
