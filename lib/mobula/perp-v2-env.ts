const DEFAULT_MOBULA_URL = "https://api.mobula.io"

export function getMobulaApiKey(): string {
  const key = process.env.MOBULA_API_KEY?.trim()
  if (!key) {
    throw new Error("MOBULA_API_KEY is required for the Mobula Perp V2 API.")
  }
  return key
}

export function getMobulaBaseUrl(): string {
  return (process.env.MOBULA_URL?.trim() || DEFAULT_MOBULA_URL).replace(
    /\/$/,
    "",
  )
}
