const DEFAULT_BASE = "http://46.202.173.162:3001";

export function getDuelDefiApiBaseUrl(): string {
  const raw = process.env.DUEL_DEFI_API_BASE_URL?.trim();
  if (raw) {
    return raw.replace(/\/$/, "");
  }
  return DEFAULT_BASE;
}
