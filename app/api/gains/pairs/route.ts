import { type NextRequest, NextResponse } from "next/server";

import { getDuelDefiApiBaseUrl } from "@/lib/duel-defi/api-base";
import { normalizeTradingPair } from "@/lib/gains/normalize-trading-pair";
import type { GainsApiChain, GainsTradingPair } from "@/types/gains-api";

export const runtime = "nodejs";

const CHAINS: GainsApiChain[] = ["Testnet", "Arbitrum", "Base"];

function isGainsChain(s: string | null): s is GainsApiChain {
  return s !== null && (CHAINS as string[]).includes(s);
}

export async function GET(request: NextRequest) {
  const chain = request.nextUrl.searchParams.get("chain");
  if (!isGainsChain(chain)) {
    return NextResponse.json(
      { error: "Query chain must be Testnet, Arbitrum, or Base." },
      { status: 400 },
    );
  }

  const base = getDuelDefiApiBaseUrl();
  const url = `${base}/gains/pairs?chain=${encodeURIComponent(chain)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Upstream ${res.status}`, detail: text.slice(0, 200) },
        { status: 502 },
      );
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      return NextResponse.json({ error: "Invalid pairs payload." }, { status: 502 });
    }
    const normalized: GainsTradingPair[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const row = normalizeTradingPair(item as Record<string, unknown>);
      if (row) normalized.push(row);
    }
    return NextResponse.json(normalized);
  } catch (e) {
    console.error("[gains/pairs]", e);
    return NextResponse.json({ error: "Failed to fetch pairs." }, { status: 502 });
  }
}
