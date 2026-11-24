import { createContext, useContext } from "react";

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string;
  status?: string;
  displayName?: string | null;
};

export type RegisterInput = {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  legalConsent: true;
  legalDocsVersion: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  authRequired?: boolean;
  skipRefresh?: boolean;
  signal?: AbortSignal;
};

export type AuthRequest = <T>(path: string, options?: RequestOptions) => Promise<T>;

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  request: AuthRequest;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
