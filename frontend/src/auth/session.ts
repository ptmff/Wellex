const ACCESS_TOKEN_KEY = "wellex.accessToken";
const REFRESH_TOKEN_KEY = "wellex.refreshToken";

let accessTokenMemory = "";

export function getAccessToken(): string {
  return accessTokenMemory;
}

export function getRefreshToken(): string {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setTokens(accessToken: string, refreshToken: string): void {
  accessTokenMemory = accessToken;
  try {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch {
    // The current access token remains available in memory.
  }
  removeLegacyAccessToken();
}

export function clearTokens(): void {
  accessTokenMemory = "";
  try {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // The storage may be unavailable in this browser.
  }
  removeLegacyAccessToken();
}

function removeLegacyAccessToken(): void {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // The storage may be unavailable in this browser.
  }
}
