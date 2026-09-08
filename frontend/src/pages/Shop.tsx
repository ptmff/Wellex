import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Coins, Play } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n/I18nContext";
import { claimAdReward, getEconomyStatus, listPackages, purchasePackage } from "@/api/economy";
import { formatWx } from "@/lib/money";
import { toast } from "sonner";
import { Link } from "react-router-dom";

const AD_SECONDS = 15;

export default function Shop() {
  const { request, user } = useAuth();
  const { language } = useI18n();
  const queryClient = useQueryClient();
  const [watching, setWatching] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(AD_SECONDS);

  const packagesQuery = useQuery({
    queryKey: ["economy-packages"],
    queryFn: () => listPackages(request),
    enabled: !!request,
  });

  const statusQuery = useQuery({
    queryKey: ["economy-me"],
    queryFn: () => getEconomyStatus(request),
    enabled: !!request && !!user,
  });

  useEffect(() => {
    if (!watching) return;
    if (secondsLeft <= 0) return;
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [watching, secondsLeft]);

  const buyMutation = useMutation({
    mutationFn: (slug: string) => purchasePackage(request, slug),
    onSuccess: async (result) => {
      toast.success(
        language === "ru"
          ? `Зачислено ${formatWx(result.wxAmount)}`
          : `Credited ${formatWx(result.wxAmount)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["economy-me"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-balance-history"] });
    },
    onError: (err) => {
      const message = typeof (err as { message?: unknown }).message === "string"
        ? (err as { message?: unknown }).message as string
        : language === "ru"
          ? "Покупка не удалась"
          : "Purchase failed";
      toast.error(message);
    },
  });

  const adMutation = useMutation({
    mutationFn: () => claimAdReward(request),
    onSuccess: async (result) => {
      setWatching(false);
      setSecondsLeft(AD_SECONDS);
      toast.success(
        language === "ru"
          ? `Награда ${formatWx(result.wxAmount)}`
          : `Reward ${formatWx(result.wxAmount)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["economy-me"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-balance-history"] });
    },
    onError: (err) => {
      setWatching(false);
      setSecondsLeft(AD_SECONDS);
      const message = typeof (err as { message?: unknown }).message === "string"
        ? (err as { message?: unknown }).message as string
        : language === "ru"
          ? "Награда недоступна"
          : "Reward unavailable";
      toast.error(message);
    },
  });

  const status = statusQuery.data;
  const canStartAd = !!user && !!status?.ad.canWatch && !watching && !adMutation.isPending;

  const finishAd = () => {
    if (secondsLeft > 0) return;
    adMutation.mutate();
  };

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">{language === "ru" ? "Магазин WX" : "WX Shop"}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {language === "ru"
            ? "Игровая валюта для стакана. Стартовый бонус выдаётся один раз. Если баланс кончился — докупите WX или посмотрите рекламу."
            : "In-game currency for the order book. The welcome bonus is granted once. If you run out, buy WX or watch an ad."}
        </p>

        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6">
          <div className="text-xs text-muted-foreground mb-1">{language === "ru" ? "Доступно" : "Available"}</div>
          <div className="text-2xl font-bold">
            {statusQuery.isLoading ? "…" : formatWx(status?.available ?? 0)}
          </div>
        </div>

        <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Пакеты" : "Packages"}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {(packagesQuery.data ?? []).map((pack) => (
            <div key={pack.id} className="rounded-xl bg-card border border-border/50 p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Coins className="h-4 w-4 text-primary" />
                <span className="font-semibold">{pack.name}</span>
              </div>
              <div className="text-xl font-bold mb-1">{formatWx(pack.wxAmount, { digits: 0 })}</div>
              <div className="text-xs text-muted-foreground mb-4">
                {language === "ru" ? `Макет оплаты · ${pack.priceRub} ₽` : `Mock payment · ${pack.priceRub} ₽`}
              </div>
              <Button
                className="mt-auto"
                disabled={!user || buyMutation.isPending}
                onClick={() => {
                  if (!user) {
                    toast.error(language === "ru" ? "Войдите, чтобы купить WX" : "Log in to buy WX");
                    return;
                  }
                  buyMutation.mutate(pack.slug);
                }}
              >
                {language === "ru" ? "Купить" : "Buy"}
              </Button>
            </div>
          ))}
        </div>

        <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Реклама" : "Watch an ad"}</h2>
        <div className="rounded-xl bg-card border border-border/50 p-4">
          <p className="text-sm text-muted-foreground mb-3">
            {language === "ru"
              ? `Пока это имитация (15 сек). Позже подключим реальную сеть. Награда ${formatWx(status?.ad.rewardAmount ?? 100, { digits: 0 })}.`
              : `This is a 15s placeholder. A real ad network comes later. Reward ${formatWx(status?.ad.rewardAmount ?? 100, { digits: 0 })}.`}
          </p>
          {status && !status.ad.canWatch ? (
            <div className="text-xs text-muted-foreground mb-3">
              {status.ad.reason}
              {status.ad.nextAt ? ` · ${new Date(status.ad.nextAt).toLocaleString()}` : ""}
            </div>
          ) : null}

          {watching ? (
            <div className="rounded-lg bg-secondary p-6 text-center mb-3">
              <div className="text-3xl font-bold mb-1">{secondsLeft}</div>
              <div className="text-xs text-muted-foreground">
                {language === "ru" ? "Имитация рекламного ролика" : "Simulated ad playback"}
              </div>
            </div>
          ) : null}

          {!user ? (
            <Button asChild variant="secondary">
              <Link to="/login">{language === "ru" ? "Войти" : "Log in"}</Link>
            </Button>
          ) : watching && secondsLeft <= 0 ? (
            <Button onClick={finishAd} disabled={adMutation.isPending}>
              {adMutation.isPending
                ? language === "ru"
                  ? "Начисляем..."
                  : "Claiming..."
                : language === "ru"
                  ? "Забрать награду"
                  : "Claim reward"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={!canStartAd}
              onClick={() => {
                setWatching(true);
                setSecondsLeft(AD_SECONDS);
              }}
            >
              <Play className="h-4 w-4 mr-2" />
              {language === "ru" ? "Смотреть рекламу" : "Watch ad"}
            </Button>
          )}
        </div>
      </motion.div>
    </AppLayout>
  );
}
