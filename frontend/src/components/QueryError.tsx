import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";

export function QueryError({
  message,
  retry,
  busy,
}: {
  message: string;
  retry: () => void;
  busy?: boolean;
}) {
  const { language } = useI18n();
  return (
    <div className="rounded-lg border border-destructive/30 px-3 py-2 text-sm">
      <p role="status" className="break-words text-destructive">{message}</p>
      <Button variant="ghost" size="sm" className="mt-1 min-h-10" onClick={retry} disabled={busy}>
        {busy
          ? language === "ru" ? "Загрузка…" : "Loading…"
          : language === "ru" ? "Повторить" : "Try again"}
      </Button>
    </div>
  );
}
