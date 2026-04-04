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
  /** Ex. duel : la chaîne d’exécution est imposée par le match, seules les paires changent. */
  chainSelectDisabled?: boolean;
  /** Sous-ensemble de chaînes (ex. mode duel = Arbitrum + Base). */
  chainOptions?: GainsApiChain[];
};

export function GainsPairPicker({
  chain,
  onChainChange,
  selectedPairIndex,
  onSelectPair,
  disabled,
  chainSelectDisabled,
  chainOptions,
}: Props) {
  const options = chainOptions?.length ? chainOptions : CHAINS;

  const [pairs, setPairs] = useState<GainsTradingPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optKey = options.join(",");
  useEffect(() => {
    if (!options.includes(chain)) {
      const first = options[0];
      if (first) onChainChange(first);
    }
    // onChainChange souvent recréé côté parent ; on corrige seulement chain vs options.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optKey + chain suffisent
  }, [optKey, chain]);

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
        <table className="w-full table-fixed border-collapse text-left text-xs">
          <colgroup>
            <col className="w-[50%]" />
            <col className="w-[28%]" />
            <col className="w-[22%]" />
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-[rgba(4,2,12,0.95)] text-[var(--game-text-muted)]">
            <tr>
              <th className="px-2 py-2 text-left font-[family-name:var(--font-orbitron)] uppercase tracking-wider">
                Pair
              </th>
              <th className="px-2 py-2 text-right font-[family-name:var(--font-orbitron)] uppercase tracking-wider">
                Price
              </th>
              <th className="px-2 py-2 text-right font-[family-name:var(--font-orbitron)] uppercase tracking-wider">
                24h
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const selected = p.pairIndex === selectedPairIndex;
              const pct = p.percentChange;
              const pctLabel = Number.isFinite(pct)
                ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
                : "—";
              return (
                <tr
                  key={`${p.pairIndex}-${p.name}`}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  onClick={() => {
                    if (!disabled) onSelectPair(p);
                  }}
                  onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectPair(p);
                    }
                  }}
                  className={`border-t border-[var(--game-cyan-dim)]/40 transition first:border-t-0 ${
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[rgba(65,245,240,0.06)]"
                  } ${
                    selected
                      ? "bg-[rgba(65,245,240,0.12)] ring-1 ring-inset ring-[var(--game-cyan)]/40"
                      : ""
                  }`}
                >
                  <td className="min-w-0 px-2 py-2 align-middle">
                    <div className="flex min-w-0 items-center gap-2">
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
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--game-text)]">{p.name}</p>
                        <p className="truncate text-[10px] text-[var(--game-text-muted)]">
                          #{p.pairIndex} · {p.from}/{p.to}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 align-middle text-right font-[family-name:var(--font-share-tech)] tabular-nums text-[var(--game-cyan)]">
                    {Number.isFinite(p.price) && p.price > 0 ? p.price.toLocaleString() : "—"}
                  </td>
                  <td
                    className={`px-2 py-2 align-middle text-right tabular-nums ${
                      !Number.isFinite(pct)
                        ? "text-[var(--game-text-muted)]"
                        : pct >= 0
                          ? "text-emerald-400"
                          : "text-[var(--game-danger)]"
                    }`}
                  >
                    {pctLabel}
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
