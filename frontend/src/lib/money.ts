export const CURRENCY_CODE = "WX";

export function formatWx(
  value: number,
  options?: { digits?: number; signed?: boolean; compact?: boolean },
): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  const digits = options?.digits ?? 2;

  if (options?.compact) {
    const abs = Math.abs(safe);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M ${CURRENCY_CODE}`;
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(0)}K ${CURRENCY_CODE}`;
  }

  const absLabel = Math.abs(safe).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });

  let sign = "";
  if (options?.signed) {
    if (safe > 0) sign = "+";
    else if (safe < 0) sign = "-";
  } else if (safe < 0) {
    sign = "-";
  }

  return `${sign}${absLabel} ${CURRENCY_CODE}`;
}

export function isStaffRole(role: string | null | undefined): boolean {
  return role === "moderator" || role === "admin";
}
