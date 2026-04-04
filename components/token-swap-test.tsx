"use client"

import { useCallback, useEffect, useState } from "react"

import {
  gameBtnPrimary,
  gameInput,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
} from "@/components/game-ui"
import type { MobulaPortfolioPosition } from "@/types/mobula-portfolio"

const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
const SUPPORTED_CHAIN_IDS = new Set(["42161"])

function extractNumericChainId(raw: string): string | null {
  const segments = raw.trim().split(/[:/]/)
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!.trim()
    if (/^\d+$/.test(seg)) return seg.replace(/^0+/, "") || "0"
  }
  return null
}

function isUsdcToken(pos: MobulaPortfolioPosition): boolean {
  return pos.tokenAddress.toLowerCase() === ARBITRUM_USDC.toLowerCase()
}

/** Format raw wei string to human-readable using token decimals. */
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

export function TokenSwapTest() {
  const [stakeUsdc, setStakeUsdc] = useState("1")
  const [positions, setPositions] = useState<MobulaPortfolioPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteAmountIn, setQuoteAmountIn] = useState<string | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)

  const fetchPortfolio = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/wallet/portfolio?playMode=duel", {
        credentials: "include",
      })
      const data = (await res.json()) as {
        positions?: MobulaPortfolioPosition[]
        error?: string
      }
      if (!res.ok) {
        setLoadError(data.error ?? "Failed to load portfolio.")
        return
      }
      setPositions(data.positions ?? [])
    } catch {
      setLoadError("Network error.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPortfolio()
  }, [fetchPortfolio])

  const filtered = positions.filter((p) => {
    const numeric = extractNumericChainId(p.chainId)
    return numeric != null && SUPPORTED_CHAIN_IDS.has(numeric)
  })

  const sorted = [...filtered].sort((a, b) => {
    const aIsUsdc = isUsdcToken(a)
    const bIsUsdc = isUsdcToken(b)
    if (aIsUsdc && !bIsUsdc) return -1
    if (!aIsUsdc && bIsUsdc) return 1
    return b.estimatedUsd - a.estimatedUsd
  })

  const selected = selectedIdx != null ? sorted[selectedIdx] ?? null : null
  const selectedIsUsdc = selected ? isUsdcToken(selected) : false
  const stakeNum = Number(stakeUsdc) || 0

  // Fetch quote when a non-USDC token is selected
  useEffect(() => {
    if (!selected || selectedIsUsdc) {
      setQuoteAmountIn(null)
      setQuoteError(null)
      setQuoteLoading(false)
      return
    }
    const raw6 = Math.round(stakeNum * 1e6).toString()
    if (stakeNum <= 0) return

    let cancelled = false
    setQuoteLoading(true)
    setQuoteAmountIn(null)
    setQuoteError(null)

    void (async () => {
      try {
        const numericChain = extractNumericChainId(selected.chainId) ?? "42161"
        const params = new URLSearchParams({
          tokenIn: selected.tokenAddress,
          amount: raw6,
          chainId: numericChain,
        })
        console.log("[swap-quote-client] fetching quote:", {
          tokenIn: selected.tokenAddress,
          symbol: selected.symbol,
          amount: raw6,
          chainId: numericChain,
        })
        const res = await fetch(`/api/trade/swap-quote?${params}`, {
          credentials: "include",
        })
        const data = (await res.json()) as Record<string, unknown>
        console.log("[swap-quote-client] response status:", res.status, "body:", data)
        if (cancelled) return
        if (!res.ok) {
          setQuoteError((data.error as string) ?? "Quote failed.")
        } else if (!data.noSwapNeeded && typeof data.amountIn === "string") {
          setQuoteAmountIn(data.amountIn)
        } else {
          console.log("[swap-quote-client] no amountIn found, noSwapNeeded:", data.noSwapNeeded, "amountIn type:", typeof data.amountIn, "value:", data.amountIn)
        }
      } catch (e) {
        console.error("[swap-quote-client] error:", e)
        if (!cancelled) setQuoteError("Network error.")
      } finally {
        if (!cancelled) setQuoteLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selected, selectedIsUsdc, stakeNum])

  async function handleSwap() {
    if (!selected) return
    setSwapError(null)
    setResult(null)
    setBusy(true)
    try {
      if (selectedIsUsdc) {
        setResult("Token is already USDC — no swap needed.")
        return
      }
      const res = await fetch("/api/trade/swap-to-collateral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          tokenIn: selected.tokenAddress,
          stakeUsdc,
          chainId: Number(extractNumericChainId(selected.chainId) ?? "42161"),
        }),
      })
      const data = (await res.json()) as {
        error?: string
        swapTxHash?: string
        approvalTxHash?: string
        noSwapNeeded?: boolean
      }
      if (!res.ok) {
        setSwapError(data.error ?? `HTTP ${res.status}`)
        return
      }
      if (data.noSwapNeeded) {
        setResult("No swap needed (already USDC).")
        return
      }
      setResult(
        [
          data.swapTxHash ? `Swap tx: ${data.swapTxHash}` : null,
          data.approvalTxHash ? `Approval tx: ${data.approvalTxHash}` : null,
        ]
          .filter(Boolean)
          .join("\n") || "Swap completed.",
      )
      // Reset selection and refresh balances after a short delay
      setSelectedIdx(null)
      setTimeout(() => void fetchPortfolio(), 3000)
    } catch {
      setSwapError("Network error.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${gamePanel} ${gamePanelTopAccent} space-y-5 p-6 sm:p-8`}>
      {/* Header */}
      <div>
        <p className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase tracking-wider text-[var(--game-amber)]">
          Swap test
        </p>
        <p className={`${gameMuted} mt-1 text-xs`}>
          Pick a token, set a USDC target, and execute a real Uniswap swap on
          Arbitrum.
        </p>
      </div>

      {/* USDC amount input */}
      <label className="block space-y-1">
        <span className={gameLabel}>USDC amount out</span>
        <input
          type="text"
          value={stakeUsdc}
          onChange={(e) => setStakeUsdc(e.target.value)}
          placeholder="e.g. 10"
          className={gameInput}
        />
      </label>

      {/* Token list */}
      <div className="space-y-1">
        <span className={gameLabel}>Your Arbitrum tokens</span>

        {loading ? (
          <p className={`${gameMuted} text-xs`}>Loading…</p>
        ) : loadError ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--game-danger)]">{loadError}</p>
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
            No tokens found on Arbitrum.
          </p>
        ) : (
          <div className="space-y-1">
            {sorted.map((pos, idx) => {
              const isCol = isUsdcToken(pos)
              const isSelected = selectedIdx === idx
              const hasEnough = isCol
                ? pos.estimatedUsd >= stakeNum * 0.99
                : pos.estimatedUsd >= stakeNum * 1.02
              return (
                <button
                  key={pos.id}
                  type="button"
                  disabled={!hasEnough}
                  onClick={() => setSelectedIdx(idx)}
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
      </div>

      {/* Quote + swap section */}
      {selected ? (
        <div className="space-y-3 border-t border-[var(--game-cyan-dim)]/20 pt-4">
          {/* Quote preview */}
          {!selectedIsUsdc ? (
            <div className="rounded-sm border border-[var(--game-cyan-dim)]/40 bg-[rgba(0,0,0,0.3)] px-3 py-2">
              {quoteLoading ? (
                <p className="font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
                  Fetching Uniswap quote…
                </p>
              ) : quoteError ? (
                <p className="text-xs text-[var(--game-danger)]">
                  {quoteError}
                </p>
              ) : quoteAmountIn ? (
                <p className="font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text)]">
                  ≈ {formatRawAmount(quoteAmountIn, selected.decimals ?? 18)} {selected.symbol} → {stakeUsdc} USDC
                </p>
              ) : (
                <p className="font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
                  Quote unavailable
                </p>
              )}
            </div>
          ) : null}

          {/* Swap button */}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSwap()}
            className={gameBtnPrimary}
          >
            {busy
              ? "Swapping…"
              : selectedIsUsdc
                ? "Already USDC"
                : `Swap ${selected.symbol} → USDC`}
          </button>

          {swapError ? (
            <p className="text-sm text-[var(--game-danger)]">{swapError}</p>
          ) : null}

          {result ? (
            <p className="whitespace-pre-wrap break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
              {result}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
