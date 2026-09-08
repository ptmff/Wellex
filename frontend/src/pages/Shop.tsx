import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Coins, Play } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n/I18nContext";
import {
  claimAdReward,
  getEconomyStatus,
  getPurchase,
  listPackages,
  purchasePackage,
  startAdSession,
  claimDailyBonus,
  type AdSession,
} from "@/api/economy";
import { RewardedAd } from "@/components/RewardedAd";
import { formatWx } from "@/lib/money";
import { toast } from "sonner";

export default function Shop() {
  const { request, user } = useAuth();
  const { language } = useI18n();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [adSession, setAdSession] = useState<AdSession | null>(null);
  const returnToastRef = useRef(false);

  const pendingPurchaseId = searchParams.get("purchase");

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

  const returnPurchaseQuery = useQuery({
    queryKey: ["economy-purchase", pendingPurchaseId],
    queryFn: () => getPurchase(request, pendingPurchaseId!),
    enabled: !!request && !!user && !!pendingPurchaseId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "succeeded" || status === "failed") return false;
      return 2000;
    },
  });

  useEffect(() => {
    const result = returnPurchaseQuery.data;
    if (!result || returnToastRef.current) return;
    if (result.status === "succeeded") {
      returnToastRef.current = true;
      toast.success(
        language === "ru"
          ? `Зачислено ${formatWx(result.wxAmount)}`
          : `Credited ${formatWx(result.wxAmount)}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["economy-me"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio-balance-history"] });
      setSearchParams({}, { replace: true });
      return;
    }
    if (result.status === "failed") {
      returnToastRef.current = true;
      toast.error(language === "ru" ? "Оплата не прошла" : "Payment failed");
      setSearchParams({}, { replace: true });
    }
  }, [language, queryClient, returnPurchaseQuery.data, setSearchParams]);

  const buyMutation = useMutation({
    mutationFn: (slug: string) => purchasePackage(request, slug),
    onSuccess: async (result) => {
      if (result.confirmationUrl) {
        window.location.assign(result.confirmationUrl);
        return;
      }
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

  const adSessionMutation = useMutation({
    mutationFn: () => startAdSession(request),
    onSuccess: (session) => {
      setAdSession(session);
    },
    onError: (err) => {
      const message = typeof (err as { message?: unknown }).message === "string"
        ? (err as { message?: unknown }).message as string
        : language === "ru"
          ? "Реклама недоступна"
          : "Ad unavailable";
      toast.error(message);
      void queryClient.invalidateQueries({ queryKey: ["economy-me"] });
    },
  });

  const adClaimMutation = useMutation({
    mutationFn: (sessionId: string) => claimAdReward(request, sessionId),
    onSuccess: async (result) => {
      setAdSession(null);
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
      setAdSession(null);
      const message = typeof (err as { message?: unknown }).message === "string"
        ? (err as { message?: unknown }).message as string
        : language === "ru"
          ? "Награда недоступна"
          : "Reward unavailable";
      toast.error(message);
      void queryClient.invalidateQueries({ queryKey: ["economy-me"] });
    },
  });

  const dailyMutation = useMutation({
    mutationFn: () => claimDailyBonus(request),
    onSuccess: async (result) => {
      toast.success(
        language === "ru"
          ? `Ежедневный бонус ${formatWx(result.wxAmount)} · серия ${result.streak}`
          : `Daily bonus ${formatWx(result.wxAmount)} · streak ${result.streak}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["economy-me"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (err) => {
      const message = typeof (err as { message?: unknown }).message === "string"
        ? (err as { message?: unknown }).message as string
        : language === "ru"
          ? "Бонус уже получен"
          : "Bonus already claimed";
      toast.error(message);
    },
  });

  const status = statusQuery.data;
  const isYooKassa = status?.paymentProvider === "yookassa";
  const isRealAdNetwork = status?.ad.provider === "yandex";
  const canStartAd = !!user && !!status?.ad.canWatch && !adSession
    && !adSessionMutation.isPending && !adClaimMutation.isPending;
  const waitingReturn = !!pendingPurchaseId && returnPurchaseQuery.data?.status === "pending";

  const adUnavailableText = status?.ad.reasonCode === "daily_limit"
    ? language === "ru" ? "Дневной лимит наград исчерпан" : "Daily ad reward limit reached"
    : status?.ad.reasonCode === "cooldown"
      ? language === "ru" ? "Награда на перезарядке" : "Ad reward cooldown active"
      : status?.ad.reason ?? null;

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">{language === "ru" ? "Магазин WX" : "WX Shop"}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {language === "ru"
            ? "Игровая валюта для стакана. Стартовый бонус выдаётся один раз. Если баланс кончился — докупите WX или посмотрите рекламу."
            : "In-game currency for the order book. The welcome bonus is granted once. If you run out, buy WX or watch an ad."}
        </p>

        {waitingReturn ? (
          <div className="rounded-xl border border-border/50 bg-card p-4 mb-6 text-sm">
            {language === "ru"
              ? "Проверяем оплату в ЮKassa…"
              : "Checking YooKassa payment…"}
          </div>
        ) : null}

        {statusQuery.isError || packagesQuery.isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
            {language === "ru" ? "Не удалось загрузить магазин. Попробуйте обновить страницу." : "Failed to load the shop. Refresh the page."}
          </div>
        ) : null}

        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6">
          <div className="text-xs text-muted-foreground mb-1">{language === "ru" ? "Доступно" : "Available"}</div>
          <div className="text-2xl font-bold">
            {statusQuery.isLoading ? "…" : formatWx(status?.available ?? 0)}
          </div>
        </div>

        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{language === "ru" ? "Ежедневный бонус" : "Daily bonus"}</div>
            <div className="text-xs text-muted-foreground">
              {formatWx(status?.daily.amount ?? 25, { digits: 0 })}
              {status?.daily.streak ? ` · ${language === "ru" ? "серия" : "streak"} ${status.daily.streak}` : ""}
            </div>
          </div>
          <Button
            disabled={!user || !status?.daily.canClaim || dailyMutation.isPending}
            onClick={() => dailyMutation.mutate()}
          >
            {status?.daily.canClaim
              ? language === "ru" ? "Забрать" : "Claim"
              : language === "ru" ? "Уже сегодня" : "Claimed today"}
          </Button>
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
                {isYooKassa
                  ? language === "ru"
                    ? `ЮKassa · ${pack.priceRub} ₽`
                    : `YooKassa · ${pack.priceRub} ₽`
                  : language === "ru"
                    ? `Макет оплаты · ${pack.priceRub} ₽`
                    : `Mock payment · ${pack.priceRub} ₽`}
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
            {isRealAdNetwork
              ? language === "ru"
                ? `Посмотрите рекламный ролик и получите ${formatWx(status?.ad.rewardAmount ?? 100, { digits: 0 })}.`
                : `Watch an ad to earn ${formatWx(status?.ad.rewardAmount ?? 100, { digits: 0 })}.`
              : language === "ru"
                ? `Пока это имитация (реальная сеть подключается после публикации сайта). Награда ${formatWx(status?.ad.rewardAmount ?? 100, { digits: 0 })}.`
                : `This is a placeholder (a real ad network requires a public site). Reward ${formatWx(status?.ad.rewardAmount ?? 100, { digits: 0 })}.`}
          </p>
          {status && !status.ad.canWatch ? (
            <div className="text-xs text-muted-foreground mb-3">
              {adUnavailableText}
              {status.ad.nextAt ? ` · ${new Date(status.ad.nextAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US")}` : ""}
            </div>
          ) : null}

          {adSession ? (
            <div className="mb-3">
              <RewardedAd
                session={adSession}
                claiming={adClaimMutation.isPending}
                onComplete={() => {
                  if (!adClaimMutation.isPending) adClaimMutation.mutate(adSession.sessionId);
                }}
                onCancel={() => setAdSession(null)}
              />
            </div>
          ) : null}

          {!user ? (
            <Button asChild variant="secondary">
              <Link to="/login">{language === "ru" ? "Войти" : "Log in"}</Link>
            </Button>
          ) : !adSession ? (
            <Button
              variant="secondary"
              disabled={!canStartAd}
              onClick={() => adSessionMutation.mutate()}
            >
              <Play className="h-4 w-4 mr-2" />
              {adSessionMutation.isPending
                ? language === "ru" ? "Готовим рекламу..." : "Preparing ad..."
                : language === "ru" ? "Смотреть рекламу" : "Watch ad"}
            </Button>
          ) : null}
        </div>
      </motion.div>
    </AppLayout>
  );
}
