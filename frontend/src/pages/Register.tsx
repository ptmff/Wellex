import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n/I18nContext";
import { LEGAL_DOCS_VERSION, legalRoutes } from "@/legal/config";

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/, "Username can contain letters, numbers, _ and -"),
  password: z.string().min(8),
  displayName: z.string().max(100).optional().or(z.literal("")),
  legalConsent: z.literal(true),
});

export default function Register() {
  const navigate = useNavigate();
  const { register, isLoading } = useAuth();
  const { language } = useI18n();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [legalConsent, setLegalConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const schemaIssues = useMemo(() => {
    const parsed = RegisterSchema.safeParse({
      email,
      username,
      password,
      displayName: displayName || undefined,
      legalConsent: legalConsent ? true : undefined,
    });
    if (parsed.success) return null;
    return parsed.error.issues[0]?.message ?? (language === "ru" ? "Некорректные данные" : "Invalid input");
  }, [displayName, email, legalConsent, password, username, language]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    const parsed = RegisterSchema.safeParse({
      email,
      username,
      password,
      displayName: displayName || undefined,
      legalConsent: legalConsent ? true : undefined,
    });

    if (!parsed.success) {
      const msg =
        !legalConsent && language === "ru"
          ? "Примите пользовательское соглашение и политику персональных данных"
          : !legalConsent
            ? "Accept the Terms and Privacy Policy"
            : (parsed.error.issues[0]?.message ?? (language === "ru" ? "Некорректные данные" : "Invalid input"));
      setFieldError(msg);
      return;
    }

    try {
      setSubmitting(true);
      await register({
        ...parsed.data,
        legalConsent: true,
        legalDocsVersion: LEGAL_DOCS_VERSION,
      });
      navigate("/portfolio");
    } catch (err) {
      const maybe = err as { message?: unknown };
      const message =
        typeof maybe?.message === "string" ? maybe.message : language === "ru" ? "Не удалось зарегистрироваться" : "Registration failed";
      toast.error(message);
      setFieldError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const termsLabel = language === "ru" ? legalRoutes.terms.titleRu : legalRoutes.terms.titleEn;
  const privacyLabel = language === "ru" ? legalRoutes.privacy.titleRu : legalRoutes.privacy.titleEn;

  return (
    <AppLayout>
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-2">{language === "ru" ? "Создать аккаунт" : "Create account"}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {language === "ru"
            ? "Новым игрокам начисляется 1000 WX. Это игровая валюта, не реальные деньги. Регистрация доступна с 18 лет."
            : "New players receive 1000 WX. In-game currency only. You must be 18+."}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{language === "ru" ? "Почта" : "Email"}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">{language === "ru" ? "Имя пользователя" : "Username"}</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={language === "ru" ? "логин" : "username"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">{language === "ru" ? "Отображаемое имя (необязательно)" : "Display name (optional)"}</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={language === "ru" ? "Как вас будут видеть другие?" : "What should other users see?"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{language === "ru" ? "Пароль" : "Password"}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={language === "ru" ? "Минимум 8 символов" : "At least 8 characters"}
            />
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
            <Checkbox
              id="legal-consent"
              checked={legalConsent}
              onCheckedChange={(v) => setLegalConsent(v === true)}
              aria-describedby="legal-consent-desc"
            />
            <div className="space-y-1">
              <Label htmlFor="legal-consent" className="text-sm font-normal leading-snug cursor-pointer">
                {language === "ru" ? "Согласие на обработку данных и условия сервиса" : "Terms and personal data consent"}
              </Label>
              <p id="legal-consent-desc" className="text-xs text-muted-foreground leading-relaxed">
                {language === "ru" ? "Я подтверждаю, что мне исполнилось 18 лет, и принимаю " : "I confirm I am 18+ and accept the "}
                <Link to={legalRoutes.terms.path} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  {termsLabel}
                </Link>
                {language === "ru" ? " и " : " and "}
                <Link to={legalRoutes.privacy.path} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  {privacyLabel}
                </Link>
                {language === "ru"
                  ? ", даю согласие на обработку персональных данных в соответствии с 152-ФЗ."
                  : " and consent to personal data processing under applicable law."}
              </p>
            </div>
          </div>

          {fieldError && <div className="text-sm text-destructive">{fieldError}</div>}
          {!fieldError && schemaIssues && <div className="text-sm text-muted-foreground">{schemaIssues}</div>}

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || isLoading || !email || !username || !password || !legalConsent}
          >
            {submitting ? (language === "ru" ? "Создаем..." : "Creating...") : language === "ru" ? "Создать аккаунт" : "Create account"}
          </Button>

          <div className="text-sm text-muted-foreground text-center">
            {language === "ru" ? "Уже есть аккаунт?" : "Already have an account?"}{" "}
            <Link className="text-primary hover:underline" to="/login">
              {language === "ru" ? "Войти" : "Log in"}
            </Link>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
