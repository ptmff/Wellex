import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "@/config";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./session";

type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string;
  status?: string;
  displayName?: string | null;
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
    requestId?: string;
  };
};

type ApiError = {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
  requestId?: string;
};

export type RegisterInput = {
  email: string;
  username: string;
  password: string;
  displayName?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

type AuthResult = TokenPair & {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    role: string;
  };
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  // Generic request wrapper for authenticated API calls.
  request: <T>(
    path: string,
    options?: {
      method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      body?: unknown;
      authRequired?: boolean;
      skipRefresh?: boolean;
    },
  ) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toApiError(payload: unknown, status: number): ApiError {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = payload as ApiErrorResponse;
    return {
      status,
      code: err.error.code,
      message: err.error.message,
      details: err.error.details,
      requestId: err.error.requestId,
    };
  }

  return {
    status,
    message: "Request failed",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

  const rawRequest = useCallback(
    async <T,>(
      path: string,
      options: {
        method?: string;
        body?: unknown;
        authHeader?: string | null;
      } = {},
    ): Promise<T> => {
      const url = `${API_BASE_URL}${path}`;
      const headers: Record<string, string> = {};

      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      if (options.authHeader) {
        headers["Authorization"] = options.authHeader;
      }

      const res = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      const payload = await res
        .json()
        .catch(() => null as unknown as ApiErrorResponse | null);

      if (!res.ok) {
        throw toApiError(payload, res.status);
      }

      const json = payload as ApiSuccess<T>;
      return json.data;
    },
    [],
  );

  const clearAndSetUnauthenticated = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    refreshPromiseRef.current = (async () => {
      try {
        const tokens = await rawRequest<TokenPair>("/auth/refresh", {
          method: "POST",
          body: { refreshToken },
        });

        setTokens(tokens.accessToken, tokens.refreshToken);

        const me = await rawRequest<AuthUser>("/auth/me", {
          method: "GET",
          authHeader: `Bearer ${tokens.accessToken}`,
        });

        setUser(me);
        return true;
      } catch {
        clearAndSetUnauthenticated();
        return false;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  }, [clearAndSetUnauthenticated, rawRequest]);

  const request = useCallback(
    async <T,>(
      path: string,
      options?: {
        method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
        body?: unknown;
        authRequired?: boolean;
        skipRefresh?: boolean;
      },
    ): Promise<T> => {
      const authRequired = options?.authRequired ?? true;
      const skipRefresh = options?.skipRefresh ?? false;

      const accessToken = getAccessToken();
      const authHeader = authRequired ? (accessToken ? `Bearer ${accessToken}` : null) : null;

      try {
        return await rawRequest<T>(path, {
          method: options?.method,
          body: options?.body,
          authHeader,
        });
      } catch (err) {
        const apiError = err as ApiError;
        const shouldRefresh =
          authRequired &&
          !skipRefresh &&
          apiError?.status === 401 &&
          // Avoid refresh loops when refresh itself fails.
          !path.startsWith("/auth/refresh") &&
          !path.startsWith("/auth/login") &&
          !path.startsWith("/auth/register");

        if (!shouldRefresh) throw err;

        const refreshed = await refreshAccessToken();
        if (!refreshed) throw err;

        const newAccessToken = getAccessToken();
        const retryAuthHeader = newAccessToken ? `Bearer ${newAccessToken}` : null;

        return rawRequest<T>(path, {
          method: options?.method,
          body: options?.body,
          authHeader: retryAuthHeader,
        });
      }
    },
    [rawRequest, refreshAccessToken],
  );

  const login = useCallback(
    async (input: LoginInput): Promise<AuthUser> => {
      const result = await rawRequest<AuthResult>("/auth/login", {
        method: "POST",
        body: input,
      });

      setTokens(result.accessToken, result.refreshToken);
      setUser(result.user);

      return result.user;
    },
    [rawRequest],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<AuthUser> => {
      const result = await rawRequest<AuthResult>("/auth/register", {
        method: "POST",
        body: input,
      });

      setTokens(result.accessToken, result.refreshToken);
      setUser(result.user);

      return result.user;
    },
    [rawRequest],
  );

  const logout = useCallback(async () => {
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();

    try {
      if (accessToken) {
        await rawRequest<void>("/auth/logout", {
          method: "POST",
          authHeader: `Bearer ${accessToken}`,
          body: { refreshToken },
        });
      }
    } catch {
      // Best-effort logout: regardless of server response, clear local session.
    } finally {
      clearAndSetUnauthenticated();
    }
  }, [clearAndSetUnauthenticated, rawRequest]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const hasRefresh = !!getRefreshToken();
        if (!hasRefresh) {
          setIsLoading(false);
          return;
        }

        const ok = await refreshAccessToken();
        if (cancelled) return;
        if (!ok) clearAndSetUnauthenticated();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearAndSetUnauthenticated, refreshAccessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      login,
      register,
      logout,
      request,
    }),
    [isLoading, login, logout, register, request, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

