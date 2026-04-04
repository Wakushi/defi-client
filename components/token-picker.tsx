"use client"

import { useCallback, useEffect, useState } from "react"

import {
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
} from "@/components/game-ui"
import type { MobulaPortfolioPosition } from "@/types/mobula-portfolio"

/** Arbitrum native USDC address (checksummed). */
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"

/** Chain IDs we support for swaps. */
const SUPPORTED_CHAIN_IDS = new Set(["42161"])

/** Extract numeric chain ID from Mobula format like "evm:42161" or plain "42161". */
export function extractNumericChainId(raw: string): string | null {
  const segments = raw.trim().split(/[:/]/)
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!.trim()
    if (/^\d+$/.test(seg)) return seg.replace(/^0+/, "") || "0"
  }
  return null
}

type SwapQuote = {
  loading: boolean
  amountIn: string | null
  error: string | null
}

export type SelectedToken = {
  /** Token contract address (or 0x000…0 for native ETH). */
  tokenAddress: string
  symbol: string
  chainId: string
  /** Whether this is already USDC (no swap needed). */
  isCollateral: boolean
  decimals?: number
}

export function TokenPicker({
  stakeUsdc,
  chainId,
  onSelect,
  selected,
}: {
  /** Human-readable stake amount, e.g. "10". */
  stakeUsdc: string
  /** Chain ID string to filter tokens, e.g. "42161". */
  chainId: string
  onSelect: (token: SelectedToken | null) => void
  selected: SelectedToken | null
}) {
  const [positions, setPositions] = useState<MobulaPortfolioPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<SwapQuote>({
    loading: false,
    amountIn: null,
    error: null,
  })

  const fetchPortfolio = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/wallet/portfolio?playMode=duel", {
        credentials: "include",
      })
      const data = (await res.json()) as {
        positions?: MobulaPortfolioPosition[]
        error?: string
      }
      console.log(data)
      if (!res.ok) {
        setError(data.error ?? "Failed to load portfolio.")
        return
      }
      setPositions(data.positions ?? [])
    } catch {
      setError("Network error.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPortfolio()
  }, [fetchPortfolio])

  // Filter positions by supported chains (Mobula returns "evm:42161" format)
  const filtered = positions.filter((p) => {
    const numeric = extractNumericChainId(p.chainId)
    return numeric != null && SUPPORTED_CHAIN_IDS.has(numeric)
  })

  // Sort: USDC first, then by USD value
  const sorted = [...filtered].sort((a, b) => {
    const aIsUsdc = isUsdcToken(a)
    const bIsUsdc = isUsdcToken(b)
    if (aIsUsdc && !bIsUsdc) return -1
    if (!aIsUsdc && bIsUsdc) return 1
    return b.estimatedUsd - a.estimatedUsd
  })

  const stakeNum = Number(stakeUsdc) || 0

  // Fetch quote when a non-USDC token is selected
  useEffect(() => {
    if (!selected || selected.isCollateral) {
      setQuote({ loading: false, amountIn: null, error: null })
      return
    }

    const raw6 = Math.round(stakeNum * 1e6).toString()
    if (stakeNum <= 0) return

    let cancelled = false
    setQuote({ loading: true, amountIn: null, error: null })

    void (async () => {
      try {
        const params = new URLSearchParams({
          tokenIn: selected.tokenAddress,
          amount: raw6,
          chainId: extractNumericChainId(selected.chainId) ?? "42161",
        })
        const res = await fetch(`/api/trade/swap-quote?${params}`, {
          credentials: "include",
        })
        const data = (await res.json()) as {
          amountIn?: string
          error?: string
          noSwapNeeded?: boolean
        }
        if (cancelled) return
        if (!res.ok) {
          setQuote({
            loading: false,
            amountIn: null,
            error: data.error ?? "Quote failed.",
          })
          return
        }
        if (data.noSwapNeeded) {
          setQuote({ loading: false, amountIn: null, error: null })
          return
        }
        setQuote({
          loading: false,
          amountIn: typeof data.amountIn === "string" ? data.amountIn : null,
          error: null,
        })
      } catch {
        if (!cancelled) {
          setQuote({ loading: false, amountIn: null, error: "Network error." })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selected, stakeNum])

  function handleSelect(pos: MobulaPortfolioPosition) {
    const isCol = isUsdcToken(pos)
    onSelect({
      tokenAddress: pos.tokenAddress,
      symbol: pos.symbol,
      chainId: pos.chainId,
      isCollateral: isCol,
      decimals: pos.decimals,
    })
  }

  return (
    <div className={`${gamePanel} ${gamePanelTopAccent} space-y-3 p-6`}>
      <h2 className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase tracking-wider text-[var(--game-amber)]">
        Pay with
      </h2>
      <p className={`${gameMuted} text-xs`}>
        Select which token to use as collateral. Non-USDC tokens will be swapped
        via Uniswap before the trade opens.
      </p>

      {loading ? (
        <p className={`${gameMuted} text-xs`}>Loading wallet tokens…</p>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--game-danger)]">{error}</p>
          <button
            type="button"
            onClick={() => void fetchPortfolio()}
            className="text-xs text-[var(--game-cyan)] underline"
          >
            Retry
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <p className={`${gameMuted} text-xs`}>
          No tokens found on Arbitrum. Fund your wallet first.
        </p>
      ) : (
        <div className="space-y-1">
          {sorted.map((pos) => {
            const isCol = isUsdcToken(pos)
            const isSelected =
              selected?.tokenAddress.toLowerCase() ===
              pos.tokenAddress.toLowerCase()
            const hasEnough = isCol
              ? pos.estimatedUsd >= stakeNum * 0.99
              : pos.estimatedUsd >= stakeNum * 1.02 // need buffer for slippage + fees
            return (
              <button
                key={pos.id}
                type="button"
                disabled={!hasEnough}
                onClick={() => handleSelect(pos)}
                className={`flex w-full items-center gap-3 rounded-sm border px-3 py-2.5 text-left text-sm transition ${
                  isSelected
                    ? "border-[var(--game-cyan)] bg-[rgba(65,245,240,0.1)]"
                    : hasEnough
                      ? "border-[var(--game-cyan-dim)]/30 bg-transparent hover:border-[var(--game-cyan-dim)] hover:bg-[rgba(65,245,240,0.04)]"
                      : "cursor-not-allowed border-[var(--game-cyan-dim)]/10 bg-transparent opacity-40"
                }`}
              >
                {pos.logo ? (
                  <img
                    src={pos.logo}
                    alt={pos.symbol}
                    className="size-6 shrink-0 rounded-full"
                  />
                ) : (
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--game-cyan-dim)]/30 text-[10px] font-bold text-[var(--game-cyan)]">
                    {pos.symbol.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-[family-name:var(--font-share-tech)] font-semibold text-[var(--game-text)]">
                      {pos.symbol}
                    </span>
                    <span className="font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
                      ${pos.estimatedUsd.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
                      {formatBalance(pos.balance, pos.symbol)}
                    </span>
                    {isCol ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--game-cyan)]">
                        No swap
                      </span>
                    ) : !hasEnough ? (
                      <span className="text-[10px] text-[var(--game-danger)]">
                        Insufficient
                      </span>
                    ) : null}
                  </div>
                </div>
                {isSelected ? (
                  <div className="size-3 shrink-0 rounded-full bg-[var(--game-cyan)]" />
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      {/* Quote preview for non-USDC selection */}
      {selected && !selected.isCollateral ? (
        <div className="rounded-sm border border-[var(--game-cyan-dim)]/40 bg-[rgba(0,0,0,0.3)] px-3 py-2">
          <p className={gameLabel}>Swap preview</p>
          {quote.loading ? (
            <p className="mt-1 font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
              Fetching Uniswap quote…
            </p>
          ) : quote.error ? (
            <p className="mt-1 text-xs text-[var(--game-danger)]">
              {quote.error}
            </p>
          ) : quote.amountIn ? (
            <p className="mt-1 font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text)]">
              ≈ {formatRawAmount(quote.amountIn, selected.decimals ?? 18)} {selected.symbol} → {stakeUsdc} USDC
            </p>
          ) : (
            <p className="mt-1 font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
              Quote unavailable
            </p>
          )}
          <p className="mt-1 text-[10px] text-[var(--game-text-muted)]">
            Swap executes when you click Ready. 0.5% slippage tolerance.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function isUsdcToken(pos: MobulaPortfolioPosition): boolean {
  try {
    return pos.tokenAddress.toLowerCase() === ARBITRUM_USDC.toLowerCase()
  } catch {
    return false
  }
}

function formatRawAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return raw
  const s = raw.padStart(decimals + 1, "0")
  const whole = s.slice(0, s.length - decimals)
  const frac = s.slice(s.length - decimals)
  const trimmed = frac.replace(/0+$/, "").slice(0, 6)
  return trimmed ? `${whole}.${trimmed}` : whole
}

function formatBalance(bal: number, symbol: string): string {
  if (bal >= 1000) return `${bal.toFixed(2)} ${symbol}`
  if (bal >= 1) return `${bal.toFixed(4)} ${symbol}`
  if (bal >= 0.0001) return `${bal.toFixed(6)} ${symbol}`
  return `${bal.toExponential(2)} ${symbol}`
}
