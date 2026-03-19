import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/auth/AuthContext";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default function Login() {
  const navigate = useNavigate();
  const { login, isLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const schemaIssues = useMemo(() => {
    const parsed = LoginSchema.safeParse({ email, password });
    if (parsed.success) return null;
    return parsed.error.issues[0]?.message ?? "Invalid input";
  }, [email, password]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    try {
      setSubmitting(true);
      await login(parsed.data);
      navigate("/portfolio");
    } catch (err) {
      const maybe = err as { message?: unknown };
      const message = typeof maybe?.message === "string" ? maybe.message : "Login failed";
      toast.error(message);
      setFieldError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-2">Log in</h1>
        <p className="text-sm text-muted-foreground mb-6">Access your portfolio and trade history.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {fieldError && <div className="text-sm text-destructive">{fieldError}</div>}
          {!fieldError && schemaIssues && <div className="text-sm text-muted-foreground">{schemaIssues}</div>}

          <Button type="submit" className="w-full" disabled={submitting || isLoading || !email || !password}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>

          <div className="text-sm text-muted-foreground text-center">
            No account?{" "}
            <Link className="text-primary hover:underline" to="/register">
              Create one
            </Link>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}

