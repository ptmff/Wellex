import type { QueryClient } from "@tanstack/react-query";

export function accountKey(userId: string | undefined, ...parts: (string | number | null | undefined)[]) {
  return ["account", userId, ...parts] as const;
}

export function invalidatePortfolio(client: QueryClient, userId: string | undefined) {
  return Promise.all(
    ["portfolio", "portfolio-positions", "portfolio-pnl", "portfolio-trades", "portfolio-balance-history"].map(
      (key) => client.invalidateQueries({ queryKey: accountKey(userId, key) }),
    ),
  );
}
