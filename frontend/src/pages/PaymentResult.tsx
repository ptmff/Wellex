import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n/I18nContext";
import { getPurchase } from "@/api/economy";
import { formatWx } from "@/lib/money";

export default function PaymentResult() {
  const { request, user } = useAuth();
  const { language } = useI18n();
  const [params] = useSearchParams();
  const purchaseId = params.get("purchase");
  const queryClient = useQueryClient();
  const done = useRef(false);

  const query = useQuery({
    queryKey: ["economy-purchase", purchaseId],
    queryFn: () => getPurchase(request, purchaseId!),
    enabled: !!request && !!user && !!purchaseId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === "succeeded" || status === "failed") return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (!query.data || done.current) return;
    if (query.data.status === "succeeded" || query.data.status === "failed") {
      done.current = true;
      void queryClient.invalidateQueries({ queryKey: ["economy-me"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    }
  }, [query.data, queryClient]);

  const status = query.data?.status;
  const title =
    status === "succeeded"
      ? language === "ru" ? "Оплата прошла" : "Payment succeeded"
      : status === "failed"
        ? language === "ru" ? "Оплата не прошла" : "Payment failed"
        : language === "ru" ? "Проверяем оплату…" : "Checking payment…";

  return (
    <AppLayout>
      <div className="max-w-md mx-auto rounded-xl border border-border/50 bg-card p-6 text-center">
        <h1 className="text-xl font-bold mb-2">{title}</h1>
        {status === "succeeded" ? (
          <p className="text-sm text-muted-foreground mb-4">
            {language === "ru" ? "Зачислено" : "Credited"} {formatWx(query.data?.wxAmount ?? 0)}
          </p>
        ) : status === "failed" ? (
          <p className="text-sm text-muted-foreground mb-4">
            {language === "ru" ? "Деньги не списаны, можно попробовать снова в магазине." : "Nothing was charged. You can try again in the shop."}
          </p>
        ) : !purchaseId ? (
          <p className="text-sm text-muted-foreground mb-4">
            {language === "ru" ? "Нет идентификатора платежа." : "Missing payment id."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-4">
            {language === "ru" ? "ЮKassa ещё подтверждает платёж." : "YooKassa is still confirming the payment."}
          </p>
        )}
        <Button asChild>
          <Link to="/shop">{language === "ru" ? "В магазин" : "Back to shop"}</Link>
        </Button>
      </div>
    </AppLayout>
  );
}
