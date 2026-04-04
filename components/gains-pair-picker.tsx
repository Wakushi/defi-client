"use client";

import { useCallback, useEffect, useState } from "react";

import {
  gameBtnGhost,
  gameInput,
  gameLabel,
  gameMuted,
} from "@/components/game-ui";
import type { GainsApiChain, GainsTradingPair } from "@/types/gains-api";

const CHAINS: GainsApiChain[] = ["Testnet", "Arbitrum", "Base"];

type Props = {
  chain: GainsApiChain;
  onChainChange: (c: GainsApiChain) => void;
  selectedPairIndex: number;
  onSelectPair: (pair: GainsTradingPair) => void;
  disabled?: boolean;
};

export function GainsPairPicker({
  chain,
  onChainChange,
  selectedPairIndex,
  onSelectPair,
  disabled,
}: Props) {
  const [pairs, setPairs] = useState<GainsTradingPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/gains/pairs?chain=${encodeURIComponent(chain)}`,
        { credentials: "include" },
      );
      const data = (await r.json()) as GainsTradingPair[] & { error?: string };
      if (!r.ok) {
        setPairs([]);
        setError(data.error ?? "Could not load pairs.");
        return;
      }
      setPairs(Array.isArray(data) ? data : []);
    } catch {
      setPairs([]);
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [chain]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[10rem] flex-1 space-y-1">
          <span className={gameLabel}>Gains API chain</span>
          <select
            value={chain}
            disabled={disabled}
            onChange={(e) => onChainChange(e.target.value as GainsApiChain)}
            className={gameInput}
          >
            {CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void load()}
          className={`${gameBtnGhost} !w-auto shrink-0`}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-[var(--game-danger)]">{error}</p>
      ) : null}

      <div className="max-h-56 overflow-y-auto rounded-sm border-2 border-[var(--game-cyan-dim)]">
        {loading && pairs.length === 0 ? (
          <p className={`${gameMuted} p-4 text-xs`}>Loading pairs…</p>
        ) : null}
        {!loading && pairs.length === 0 && !error ? (
          <p className={`${gameMuted} p-4 text-xs`}>No pairs.</p>
        ) : null}
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[rgba(4,2,12,0.95)] text-[var(--game-text-muted)]">
            <tr>
              <th className="px-2 py-2 font-[family-name:var(--font-orbitron)] uppercase tracking-wider">
                Pair
              </th>
              <th className="px-2 py-2">Price</th>
              <th className="px-2 py-2">24h</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const selected = p.pairIndex === selectedPairIndex;
              return (
                <tr key={`${p.pairIndex}-${p.name}`}>
                  <td colSpan={3} className="p-0">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSelectPair(p)}
                      className={`flex w-full items-center gap-2 px-2 py-2 text-left transition enabled:hover:bg-[rgba(65,245,240,0.08)] disabled:opacity-50 ${
                        selected
                          ? "bg-[rgba(65,245,240,0.12)] ring-1 ring-[var(--game-cyan)]/40"
                          : ""
                      }`}
                    >
                      {p.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.logo}
                          alt=""
                          className="size-7 shrink-0 rounded-full"
                          width={28}
                          height={28}
                        />
                      ) : (
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--game-cyan-dim)] text-[10px] font-bold text-[var(--game-cyan)]">
                          {p.from.slice(0, 2)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[var(--game-text)]">{p.name}</p>
                        <p className="truncate text-[10px] text-[var(--game-text-muted)]">
                          #{p.pairIndex} · {p.from}/{p.to}
                        </p>
                      </div>
                      <div className="shrink-0 text-right font-[family-name:var(--font-share-tech)] tabular-nums text-[var(--game-cyan)]">
                        {Number.isFinite(p.price) ? p.price.toLocaleString() : "—"}
                      </div>
                      <div
                        className={`w-14 shrink-0 text-right tabular-nums ${
                          p.percentChange >= 0 ? "text-emerald-400" : "text-[var(--game-danger)]"
                        }`}
                      >
                        {Number.isFinite(p.percentChange)
                          ? `${(p.percentChange * 100).toFixed(2)}%`
                          : "—"}
                      </div>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
