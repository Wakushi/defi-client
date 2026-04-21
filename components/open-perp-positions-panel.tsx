"use client"

import { useCallback, useEffect, useState } from "react"

import {
  gameBtnDanger,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
} from "@/components/game-ui"

type PerpPosition = {
  id: string
  marketId: string
  exchange: string
  chainId: string
  side: "BUY" | "SELL" | string
  currentLeverage?: number
  entryPriceQuote?: number
  currentPriceQuote?: number
  liquidationPriceQuote?: number
  collateral?: number
  amountUSD?: number
  unrealizedPnlUSD?: number
  unrealizedPnlPercent?: number
  address: string
}

function fmtUsd(n: number, maxFrac = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(n)
}

function fmtSignedPct(n: number): string {
  const s = n >= 0 ? "+" : ""
  return `${s}${n.toFixed(2)}%`
}

function prettyMarket(marketId: string): string {
  const parts = marketId.split("-")
  if (parts.length >= 2) {
    return parts.slice(1).join("/").toUpperCase()
  }
  return marketId.toUpperCase()
}

/** Mobula id shape: `pos-<market>-<wallet>-<suffix>`; `<suffix>` is the V2 positionId. */
function extractPositionId(id: string, walletAddress: string): string {
  const addrLower = walletAddress.toLowerCase()
  const idx = id.toLowerCase().lastIndexOf(addrLower)
  if (idx < 0) return id
  return id.slice(idx + addrLower.length).replace(/^-/, "") || id
}

export function OpenPerpPositionsPanel() {
  const [positions, setPositions] = useState<PerpPosition[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [closeTx, setCloseTx] = useState<string | null>(null)
  const [closeErr, setCloseErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const r = await fetch("/api/perp-positions/open", {
        credentials: "include",
        cache: "no-store",
      })
      const data = (await r.json()) as PerpPosition[] | { error?: string }
      if (!r.ok || !Array.isArray(data)) {
        const msg = (data as { error?: string })?.error
        setErr(msg ?? "Could not load positions.")
        setPositions([])
        return
      }
      setPositions(data)
    } catch {
      setErr("Network error.")
      setPositions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const closePosition = useCallback(
    async (p: PerpPosition) => {
      if (closingId === p.id) {
        console.warn("[home-panel-close] duplicate click ignored", { id: p.id })
        return
      }
      setCloseErr(null)
      setCloseTx(null)
      setClosingId(p.id)
      const positionId = extractPositionId(p.id, p.address)
      const body = {
        dex: p.exchange,
        chainId: p.chainId,
        marketId: p.marketId,
        positionId,
        trigger: "home-panel" as const,
      }
      console.log("[home-panel-close] POST /api/perp-positions/close", { id: p.id, ...body })
      const t0 = performance.now()
      try {
        const r = await fetch("/api/perp-positions/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        })
        const data = (await r.json()) as {
          error?: string
          txHash?: string
          rateLimited?: boolean
        }
        const durationMs = Math.round(performance.now() - t0)
        if (!r.ok) {
          if (data.rateLimited) {
            console.error("[home-panel-close] DYNAMIC_RATE_LIMITED", {
              id: p.id,
              status: r.status,
              error: data.error,
              durationMs,
            })
          } else {
            console.error("[home-panel-close] failed", {
              id: p.id,
              status: r.status,
              error: data.error,
              durationMs,
            })
          }
          setCloseErr(data.error ?? "Close failed.")
          return
        }
        console.log("[home-panel-close] ok", {
          id: p.id,
          txHash: data.txHash,
          durationMs,
        })
        if (data.txHash) setCloseTx(data.txHash)
        await load()
      } catch (e) {
        console.error("[home-panel-close] network error", {
          id: p.id,
          error: e,
          durationMs: Math.round(performance.now() - t0),
        })
        setCloseErr("Network error.")
      } finally {
        setClosingId(null)
      }
    },
    [closingId, load],
  )

  return (
    <div className={`${gamePanel} ${gamePanelTopAccent} p-4 sm:p-5`}>
      <div className="mb-3 flex items-center justify-between">
        <p className={gameLabel}>Open positions</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          className="font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-widest text-[var(--game-cyan)] hover:brightness-110"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className={gameMuted}>Loading…</p>
      ) : err ? (
        <p className="text-sm text-[var(--game-danger)]">{err}</p>
      ) : positions && positions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {positions.map((p) => {
            const isLong = p.side === "BUY"
            const pnl =
              typeof p.unrealizedPnlUSD === "number" ? p.unrealizedPnlUSD : 0
            const pnlPct =
              typeof p.unrealizedPnlPercent === "number"
                ? p.unrealizedPnlPercent
                : 0
            const pnlPos = pnl >= 0
            const closing = closingId === p.id
            const lev =
              typeof p.currentLeverage === "number" ? p.currentLeverage : null
            return (
              <li
                key={p.id}
                className="rounded-sm border border-[var(--game-cyan-dim)] bg-[rgba(4,2,12,0.6)] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase tracking-wide text-[var(--game-text)]">
                      {prettyMarket(p.marketId)}
                    </p>
                    <p className="font-[family-name:var(--font-share-tech)] text-[11px] text-[var(--game-text-muted)]">
                      {p.exchange} · {p.chainId}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <span
                      className={`rounded-sm border px-2 py-0.5 font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-wider ${
                        isLong
                          ? "border-[var(--game-cyan)]/60 bg-[rgba(129,140,248,0.12)] text-[var(--game-cyan)]"
                          : "border-[var(--game-magenta)]/60 bg-[rgba(251,191,36,0.12)] text-[var(--game-magenta)]"
                      }`}
                    >
                      {isLong ? "Long" : "Short"}
                    </span>
                    {lev != null ? (
                      <span className="rounded-sm border border-[var(--game-amber)]/50 bg-[rgba(255,200,74,0.1)] px-2 py-0.5 font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-wider text-[var(--game-amber)]">
                        {lev >= 10 ? lev.toFixed(0) : lev.toFixed(1)}×
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <p className={gameLabel}>PnL</p>
                    <p
                      className={`font-[family-name:var(--font-share-tech)] text-sm font-semibold tabular-nums ${
                        pnlPos
                          ? "text-[var(--game-cyan)]"
                          : "text-[var(--game-magenta)]"
                      }`}
                    >
                      {pnlPos ? "+" : ""}
                      {fmtUsd(pnl, 2)} $
                    </p>
                    <p
                      className={`text-[11px] tabular-nums ${
                        pnlPos
                          ? "text-[var(--game-cyan)]/80"
                          : "text-[var(--game-magenta)]/80"
                      }`}
                    >
                      {fmtSignedPct(pnlPct)}
                    </p>
                  </div>
                  <div>
                    <p className={gameLabel}>Entry</p>
                    <p className="font-[family-name:var(--font-share-tech)] text-sm tabular-nums text-[var(--game-text)]">
                      {typeof p.entryPriceQuote === "number"
                        ? `$${fmtUsd(p.entryPriceQuote, 4)}`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className={gameLabel}>Collateral</p>
                    <p className="font-[family-name:var(--font-share-tech)] text-sm tabular-nums text-[var(--game-text)]">
                      {typeof p.collateral === "number"
                        ? fmtUsd(p.collateral, 2)
                        : "—"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={closing}
                  onClick={() => void closePosition(p)}
                  className={`${gameBtnDanger} mt-3 w-full py-1.5 text-[11px]`}
                >
                  {closing ? "Closing…" : "Close position"}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className={gameMuted}>No open positions.</p>
      )}

      {closeErr ? (
        <p className="mt-3 text-sm text-[var(--game-danger)]">{closeErr}</p>
      ) : null}
      {closeTx ? (
        <p className="mt-3 break-all font-[family-name:var(--font-share-tech)] text-[11px] text-[var(--game-cyan)]">
          Close tx: {closeTx}
        </p>
      ) : null}
    </div>
  )
}
