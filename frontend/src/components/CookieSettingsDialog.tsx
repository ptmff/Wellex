import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/i18n/I18nContext";
import type { CookieConsent } from "@/hooks/useCookieConsent";

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (consent: CookieConsent) => void;
  initialConsent: CookieConsent;
};

export function CookieSettingsDialog({ open, onClose, onSave, initialConsent }: Props) {
  const { t } = useI18n();
  const [analytics, setAnalytics] = useState(initialConsent.analytics);
  const [functional, setFunctional] = useState(initialConsent.functional);

  function handleSave() {
    onSave({ necessary: true, analytics, functional });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("cookie.settings.title")}</DialogTitle>
          <DialogDescription>{t("cookie.settings.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Necessary */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("cookie.category.necessary")}</Label>
              <p className="text-xs text-muted-foreground">{t("cookie.category.necessary.desc")}</p>
            </div>
            <Switch checked disabled aria-label={t("cookie.category.necessary")} />
          </div>

          <Separator />

          {/* Functional */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="cookie-functional" className="text-sm font-medium">
                {t("cookie.category.functional")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("cookie.category.functional.desc")}</p>
            </div>
            <Switch
              id="cookie-functional"
              checked={functional}
              onCheckedChange={setFunctional}
              aria-label={t("cookie.category.functional")}
            />
          </div>

          <Separator />

          {/* Analytics */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="cookie-analytics" className="text-sm font-medium">
                {t("cookie.category.analytics")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("cookie.category.analytics.desc")}</p>
            </div>
            <Switch
              id="cookie-analytics"
              checked={analytics}
              onCheckedChange={setAnalytics}
              aria-label={t("cookie.category.analytics")}
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("cookie.settings.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("cookie.settings.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
