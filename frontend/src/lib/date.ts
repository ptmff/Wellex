function isValidDate(d: Date): boolean {
  return Number.isFinite(d.getTime());
}

function normalizeTimestampString(input: string): string {
  // Handle common non-ISO formats coming from some serializers, e.g.:
  // - "YYYY-MM-DD HH:mm:ss.SSS+00"
  // - "YYYY-MM-DD HH:mm:ss"
  let out = input.trim();

  // Replace space between date and time with "T"
  // Examples:
  // - 2026-03-19 12:34:56 => 2026-03-19T12:34:56
  // - 2026-03-19 12:34:56.789 => 2026-03-19T12:34:56.789
  out = out.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(.*)$/, "$1T$2$3");

  // Convert timezone offset without colon:
  // - +0000 => +00:00
  // - -0300 => -03:00
  out = out.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

  // Convert timezone offset like "+00" at the end to "+00:00"
  out = out.replace(/([+-]\d{2})$/, "$1:00");

  return out;
}

export function parseDate(input: unknown): Date | null {
  if (input === null || input === undefined) return null;

  if (input instanceof Date) {
    return isValidDate(input) ? input : null;
  }

  if (typeof input === "number") {
    // Heuristic: epoch seconds are ~10 digits, epoch millis are 13 digits.
    const ms = input < 1e12 ? input * 1000 : input;
    const d = new Date(ms);
    return isValidDate(d) ? d : null;
  }

  if (typeof input === "string") {
    const raw = input.trim();
    if (!raw) return null;

    // Numeric strings could be unix timestamps.
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const num = Number(raw);
      if (Number.isFinite(num)) {
        const ms = num < 1e12 ? num * 1000 : num;
        const d = new Date(ms);
        return isValidDate(d) ? d : null;
      }
    }

    const d1 = new Date(raw);
    if (isValidDate(d1)) return d1;

    const normalized = normalizeTimestampString(raw);
    const d2 = new Date(normalized);
    return isValidDate(d2) ? d2 : null;
  }

  if (typeof input === "object") {
    const any = input as Record<string, unknown>;

    // Handle common timestamp object shapes.
    const seconds =
      typeof any.seconds === "number"
        ? any.seconds
        : typeof any._seconds === "number"
          ? any._seconds
          : typeof any.unix === "number"
            ? any.unix
            : null;
    if (seconds !== null) return parseDate(seconds);

    // If it has an ISO string-ish representation, try that.
    const maybeToISOString = (input as { toISOString?: unknown }).toISOString;
    if (typeof maybeToISOString === "function") {
      const iso = maybeToISOString.call(input);
      if (typeof iso === "string") return parseDate(iso);
    }
  }

  return null;
}

export function formatDateToLocaleDateString(
  input: unknown,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = parseDate(input);
  if (!d) return "TBD";
  return d.toLocaleDateString(locale, options);
}

export function formatDateToLocaleString(
  input: unknown,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = parseDate(input);
  if (!d) return "TBD";
  return d.toLocaleString(locale, options);
}

export function formatRelativeTime(input: unknown): string {
  const d = parseDate(input);
  if (!d) return "";
  const diffMs = Date.now() - d.getTime();
  if (!Number.isFinite(diffMs)) return "";

  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

