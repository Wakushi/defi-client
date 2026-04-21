"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import {
  gameBtnGhost,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
  gameTabActive,
  gameTabRow,
} from "@/components/game-ui"
import { LoginForm } from "@/components/login-form"
import { SignupForm } from "@/components/signup-form"
import { HubPlayModeMenu } from "@/components/hub-play-mode-menu"
import { OpenDuelsMenu } from "@/components/open-duels-menu"
import { OpenPerpPositionsPanel } from "@/components/open-perp-positions-panel"
import { WalletProfile } from "@/components/wallet-profile"

type MeUser = {
  id: string
  username: string
  walletAddress: string | null
}

export function HomeAuth() {
  const [user, setUser] = useState<MeUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<"signup" | "login">("login")

  const refresh = useCallback(async () => {
    const r = await fetch("/api/auth/me", { credentials: "include" })
    const data = (await r.json()) as { user: MeUser | null }
    setUser(data.user ?? null)
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect -- initial /api/auth/me load */
  useEffect(() => {
    let cancelled = false
    void refresh().finally(() => {
      if (!cancelled) queueMicrotask(() => setLoading(false))
    })
    return () => {
      cancelled = true
    }
  }, [refresh])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    setUser(null)
  }

  async function fetchGainsPairs() {
    try {
      const r = await fetch(`/api/gains/pairs?chain=Testnet`)
      const data = (await r.json()) as any[] & { error?: string }
      console.log(data)
    } catch (error) {
      console.error(error)
    }
  }

  if (loading) {
    return (
      <p
        className={`${gameMuted} text-center font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-widest`}
      >
        Loading…
      </p>
    )
  }

  if (user) {
    const initial = user.username.trim().charAt(0).toUpperCase() || "?"
    const shortAddr = user.walletAddress
      ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`
      : null

    return (
      <div className="flex w-full max-w-5xl flex-col gap-4">
        {/* ── Compact profile bar ── */}
        <div
          className={`${gamePanel} ${gamePanelTopAccent} relative overflow-visible`}
          onClick={() => fetchGainsPairs()}
        >
          <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-sm border-2 border-[var(--game-cyan)] bg-[linear-gradient(145deg,rgba(129,140,248,0.2),rgba(251,191,36,0.12))] font-[family-name:var(--font-orbitron)] text-sm font-black text-[var(--game-amber)] shadow-[0_0_14px_rgba(129,140,248,0.25)]"
              aria-hidden
            >
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase tracking-wide text-[var(--game-text)] [text-shadow:0_0_24px_rgba(129,140,248,0.35)]">
                {user.username}
              </p>
              {shortAddr ? (
                <p className="font-[family-name:var(--font-share-tech)] text-[11px] text-[var(--game-text-muted)]">
                  {shortAddr}
                </p>
              ) : (
                <p className="text-[11px] text-[var(--game-text-muted)]">
                  No wallet
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className={`${gameBtnGhost} shrink-0`}
            >
              Log out
            </button>
          </div>
        </div>

        {/* ── Compact Duel CTA ── */}
        <Link
          href="/duel/new"
          className="group relative block w-full overflow-hidden rounded-sm border-2 border-[var(--game-magenta)] bg-[linear-gradient(180deg,rgba(251,191,36,0.22),rgba(20,8,40,0.98))] px-5 py-5 text-center shadow-[0_0_40px_rgba(251,191,36,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:brightness-110 hover:shadow-[0_0_56px_rgba(251,191,36,0.45)]"
        >
          <span className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-55deg,transparent,transparent_6px,rgba(255,255,255,0.02)_6px,rgba(255,255,255,0.02)_7px)] opacity-60" />
          <span className="relative font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.45em] text-[var(--game-amber)]">
            Enter arena
          </span>
          <span className="relative mt-1 block font-[family-name:var(--font-orbitron)] text-2xl font-black uppercase tracking-[0.15em] text-[var(--game-amber)] [text-shadow:0_0_28px_rgba(252,211,77,0.9),0_0_48px_rgba(251,191,36,0.55)] sm:text-3xl">
            Duel
          </span>
          <span className="relative mt-1 block text-xs text-[var(--game-text-muted)]">
            Create a match · set stake · invite your opponent
          </span>
        </Link>

        {/* ── Two-column content: Menu + Wallet ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Left: Menu & Duels */}
          <div className="flex flex-col gap-4">
            <div className={`${gamePanel} ${gamePanelTopAccent} p-4 sm:p-5`}>
              <HubPlayModeMenu />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href="/duel/history"
                  className={`${gameBtnGhost} border-[var(--game-cyan-dim)] text-[var(--game-cyan)]`}
                >
                  Duel history
                </Link>
              </div>
              <OpenDuelsMenu />
            </div>
          </div>

          {/* Right: Wallet */}
          {user.walletAddress ? (
            <WalletProfile walletAddress={user.walletAddress} />
          ) : null}
        </div>

        {user.walletAddress ? <OpenPerpPositionsPanel /> : null}
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className={gameTabRow}>
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider transition ${gameTabActive(mode === "login")}`}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider transition ${gameTabActive(mode === "signup")}`}
        >
          Sign up
        </button>
      </div>
      {mode === "login" ? (
        <LoginForm onSuccess={() => void refresh()} />
      ) : (
        <SignupForm onSuccess={() => void refresh()} />
      )}
    </div>
  )
}
