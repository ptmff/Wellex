const DEFAULT_API_BASE_URL = "/api/v1";
const DEFAULT_WS_PATH = "/ws";

function normalizePath(path: string): string {
  if (path.startsWith("/")) return path;
  return `/${path}`;
}

function buildDefaultWebSocketUrl(path: string): string {
  if (typeof window === "undefined") return `ws://localhost:3000${path}`;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;

export const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? buildDefaultWebSocketUrl(normalizePath(DEFAULT_WS_PATH));

