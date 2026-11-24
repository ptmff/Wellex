import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPurchase, purchasePollInterval } from "@/api/economy";
import { accountKey, invalidatePortfolio } from "@/auth/accountQueries";
import { useAuth } from "@/auth/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";
import { formatWx } from "@/lib/money";

export default function PaymentResult() {
  const { request, user } = useAuth();
  const userId = user?.id;
  const { language } = useI18n();
  const ru = language === "ru";
  const [params] = useSearchParams();
  const purchaseId = params.get("purchase")?.trim();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: accountKey(userId, "economy-purchase", purchaseId),
    queryFn: () => getPurchase(request, purchaseId!),
    enabled: !!userId && !!purchaseId,
    refetchInterval: ({ state }) => purchasePollInterval(state),
  });
  const purchase = query.data;
  const status = purchase?.status;

  useEffect(() => {
    if (status !== "succeeded") return;
    void client.invalidateQueries({ queryKey: accountKey(userId, "economy-me") });
    void invalidatePortfolio(client, userId);
  }, [client, purchaseId, status, userId]);

  const title = status === "succeeded"
    ? ru ? "Оплата прошла" : "Payment succeeded"
    : status === "failed"
      ? ru ? "Оплата не прошла" : "Payment failed"
      : ru ? "Статус оплаты" : "Payment status";

  return (
    <AppLayout>
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border/50 bg-card p-5">
        <h1 className="text-xl font-bold">{title}</h1>
        {purchase?.status === "succeeded" ? (
          <p className="text-sm text-muted-foreground">{ru ? "Зачислено" : "Credited"} {formatWx(purchase.wxAmount)}</p>
        ) : status === "failed" ? (
          <p className="text-sm text-muted-foreground">{ru ? "Зачисление по этому платежу не подтверждено." : "Credit for this payment was not confirmed."}</p>
        ) : !purchaseId ? (
          <p className="text-sm text-muted-foreground">{ru ? "В ссылке нет идентификатора платежа." : "The payment link is missing its ID."}</p>
        ) : query.isError ? (
          <QueryError
            message={ru ? "Не удалось проверить оплату. Статус платежа пока неизвестен." : "Could not verify the payment. Its status is unknown."}
            retry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : query.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">{ru ? "Проверяем оплату…" : "Checking payment…"}</p>
        ) : (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {status === "pending" ? ru ? "Платёж ожидает подтверждения." : "Payment is awaiting confirmation."
                : ru ? "Статус платежа пока неизвестен." : "The payment status is unknown."}
            </p>
            <Button variant="outline" className="min-h-11" disabled={query.isFetching} onClick={() => void query.refetch()}>
              {ru ? "Проверить статус" : "Check status"}
            </Button>
          </>
        )}
        <div><Button asChild className="min-h-11"><Link to="/shop">{ru ? "В магазин" : "Back to shop"}</Link></Button></div>
      </div>
    </AppLayout>
  );
}
