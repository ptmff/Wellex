import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/config";
import { AuthContext, type AuthUser, type LoginInput, type RegisterInput, type RequestOptions } from "./useAuth";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./session";

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiError = {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
  requestId?: string;
};

function sessionChanged() {
  return new DOMException("Account session changed", "AbortError");
}

type AuthResult = TokenPair & {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    role: string;
  };
};

function toApiError(payload: unknown, status: number): ApiError {
  const error = (payload as { error?: Partial<ApiError> } | null)?.error;
  return {
    status,
    message: typeof error?.message === "string" ? error.message : "Request failed",
    code: typeof error?.code === "string" ? error.code : undefined,
    details: error?.details,
    requestId: typeof error?.requestId === "string" ? error.requestId : undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const sessionRevision = useRef(0);

  const rawRequest = useCallback(
    async <T,>(
      path: string,
      options: {
        method?: string;
        body?: unknown;
        authHeader?: string | null;
        signal?: AbortSignal;
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
        signal: options.signal,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      const payload: unknown = await res.json().catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") throw error;
        return null;
      });
      const json = payload as Partial<ApiSuccess<T>> | null;
      if (!res.ok || json?.success !== true) throw toApiError(payload, res.status);
      return (json as ApiSuccess<T>).data;
    },
    [],
  );

  const clearAndSetUnauthenticated = useCallback(() => {
    sessionRevision.current += 1;
    refreshPromiseRef.current = null;
    clearTokens();
    void queryClient.cancelQueries({ queryKey: ["account"] });
    queryClient.removeQueries({ queryKey: ["account"] });
    queryClient.getMutationCache().clear();
    setUser(null);
    setIsLoading(false);
  }, [queryClient]);

  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const revision = sessionRevision.current;

    refreshPromiseRef.current = (async () => {
      try {
        const tokens = await rawRequest<TokenPair>("/auth/refresh", {
          method: "POST",
          body: { refreshToken },
        });

        if (revision !== sessionRevision.current) return false;
        setTokens(tokens.accessToken, tokens.refreshToken);

        const me = await rawRequest<AuthUser>("/auth/me", {
          method: "GET",
          authHeader: `Bearer ${tokens.accessToken}`,
        });

        if (revision !== sessionRevision.current) return false;
        setUser(me);
        return true;
      } catch (error) {
        const status = (error as ApiError)?.status;
        if (revision === sessionRevision.current && (status === 401 || status === 403)) {
          clearAndSetUnauthenticated();
        }
        return false;
      } finally {
        if (revision === sessionRevision.current) refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  }, [clearAndSetUnauthenticated, rawRequest]);

  const request = useCallback(
    async <T,>(
      path: string,
      options?: RequestOptions,
    ): Promise<T> => {
      const authRequired = options?.authRequired ?? true;
      const skipRefresh = options?.skipRefresh ?? false;

      const accessToken = getAccessToken();
      const authHeader = authRequired ? (accessToken ? `Bearer ${accessToken}` : null) : null;
      const revision = sessionRevision.current;
      const ensureCurrentSession = () => {
        if (authRequired && revision !== sessionRevision.current) throw sessionChanged();
      };

      try {
        const data = await rawRequest<T>(path, {
          method: options?.method,
          body: options?.body,
          authHeader,
          signal: options?.signal,
        });
        ensureCurrentSession();
        return data;
      } catch (err) {
        ensureCurrentSession();
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

        if (accessToken === getAccessToken() && !(await refreshAccessToken())) throw err;
        ensureCurrentSession();

        const newAccessToken = getAccessToken();
        const retryAuthHeader = newAccessToken ? `Bearer ${newAccessToken}` : null;

        const data = await rawRequest<T>(path, {
          method: options?.method,
          body: options?.body,
          authHeader: retryAuthHeader,
          signal: options?.signal,
        });
        ensureCurrentSession();
        return data;
      }
    },
    [rawRequest, refreshAccessToken],
  );

  const login = useCallback(
    async (input: LoginInput): Promise<AuthUser> => {
      const revision = sessionRevision.current;
      const result = await rawRequest<AuthResult>("/auth/login", {
        method: "POST",
        body: input,
      });

      if (revision !== sessionRevision.current) throw sessionChanged();
      clearAndSetUnauthenticated();
      setTokens(result.accessToken, result.refreshToken);
      setUser(result.user);

      return result.user;
    },
    [clearAndSetUnauthenticated, rawRequest],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<AuthUser> => {
      const revision = sessionRevision.current;
      const result = await rawRequest<AuthResult>("/auth/register", {
        method: "POST",
        body: input,
      });

      if (revision !== sessionRevision.current) throw sessionChanged();
      clearAndSetUnauthenticated();
      setTokens(result.accessToken, result.refreshToken);
      setUser(result.user);

      return result.user;
    },
    [clearAndSetUnauthenticated, rawRequest],
  );

  const logout = useCallback(async () => {
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    clearAndSetUnauthenticated();

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

        await refreshAccessToken();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshAccessToken]);

  const value = useMemo(
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
