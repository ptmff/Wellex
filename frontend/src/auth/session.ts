export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
};

const ACCESS_TOKEN_KEY = "wellex.accessToken";
const REFRESH_TOKEN_KEY = "wellex.refreshToken";

// Keep access token in memory when possible.
let accessTokenMemory = "";

export function getAccessToken(): string {
  return accessTokenMemory;
}

export function setAccessToken(token: string | null): void {
  accessTokenMemory = token ?? "";

  // Optional persistence fallback (helps refresh after full reload).
  // If you want pure in-memory access token, remove this localStorage write/read.
  try {
    if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
    else localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getRefreshToken(): string {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
    else sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getStoredTokens(): StoredTokens | null {
  try {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY) ?? "";
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

export function setTokens(accessToken: string, refreshToken: string): void {
  setAccessToken(accessToken);
  setRefreshToken(refreshToken);
}

export function clearTokens(): void {
  accessTokenMemory = "";
  setRefreshToken(null);
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // ignore
  }
}

