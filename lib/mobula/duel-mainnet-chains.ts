import type { MobulaPortfolioPosition } from "@/types/mobula-portfolio";

/**
 * Chaînes EVM mainnet prises en compte pour la valeur « duel » (exclut Sepolia, Base Sepolia, etc.).
 * Les `chainId` Mobula sont normalisés en chaîne numérique.
 */
export const DUEL_MAINNET_CHAIN_IDS = new Set([
  "1", // Ethereum
  "10", // Optimism
  "56", // BNB Chain
  "137", // Polygon
  "250", // Fantom
  "8453", // Base
  "42161", // Arbitrum One
  "43114", // Avalanche C-Chain
  "324", // zkSync Era
  "59144", // Linea
  "534352", // Scroll
  "5000", // Mantle
  "81457", // Blast
  "34443", // Mode
]);

/**
 * Extrait l’identifiant numérique de chaîne (évite de fusionner `eip155` + `42161` en un seul nombre).
 */
export function extractNumericChainId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const segments = s.split(/[:/]/);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!.trim();
    if (/^\d+$/.test(seg)) {
      return seg.replace(/^0+/, "") || "0";
    }
  }
  if (/^\d+$/.test(s)) {
    return s.replace(/^0+/, "") || "0";
  }
  return null;
}

export function isDuelMainnetChainId(chainId: string): boolean {
  const n = extractNumericChainId(chainId);
  if (n == null) return false;
  return DUEL_MAINNET_CHAIN_IDS.has(n);
}

export function filterMainnetPortfolioPositions(
  positions: MobulaPortfolioPosition[],
): MobulaPortfolioPosition[] {
  return positions.filter((p) => isDuelMainnetChainId(p.chainId));
}

export function sumPositionsEstimatedUsd(
  positions: MobulaPortfolioPosition[],
): number {
  let s = 0;
  for (const p of positions) {
    if (Number.isFinite(p.estimatedUsd)) s += p.estimatedUsd;
  }
  return s;
}
