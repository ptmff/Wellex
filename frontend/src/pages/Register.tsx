import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n/I18nContext";

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/, "Username can contain letters, numbers, _ and -"),
  password: z.string().min(8),
  displayName: z.string().max(100).optional().or(z.literal("")),
});

export default function Register() {
  const navigate = useNavigate();
  const { register, isLoading } = useAuth();
  const { language } = useI18n();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const schemaIssues = useMemo(() => {
    const parsed = RegisterSchema.safeParse({ email, username, password, displayName: displayName || undefined });
    if (parsed.success) return null;
    return parsed.error.issues[0]?.message ?? (language === "ru" ? "Некорректные данные" : "Invalid input");
  }, [displayName, email, password, username]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    const parsed = RegisterSchema.safeParse({
      email,
      username,
      password,
      displayName: displayName || undefined,
    });

    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? (language === "ru" ? "Некорректные данные" : "Invalid input"));
      return;
    }

    try {
      setSubmitting(true);
      await register(parsed.data);
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

  return (
    <AppLayout>
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-2">{language === "ru" ? "Создать аккаунт" : "Create account"}</h1>
        <p className="text-sm text-muted-foreground mb-6">{language === "ru" ? "Зарегистрируйтесь, чтобы начать торговать." : "Register to start trading."}</p>

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

          {fieldError && <div className="text-sm text-destructive">{fieldError}</div>}
          {!fieldError && schemaIssues && <div className="text-sm text-muted-foreground">{schemaIssues}</div>}

          <Button type="submit" className="w-full" disabled={submitting || isLoading || !email || !username || !password}>
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

