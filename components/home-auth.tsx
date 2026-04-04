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
  gameTitle,
} from "@/components/game-ui"
import { LoginForm } from "@/components/login-form"
import { SignupForm } from "@/components/signup-form"
import { HubPlayModeMenu } from "@/components/hub-play-mode-menu"
import { OpenDuelsMenu } from "@/components/open-duels-menu"
import { TokenSwapTest } from "@/components/token-swap-test"
import { UniswapMainnetDemo } from "@/components/uniswap-mainnet-demo"
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

    return (
      <div className="flex w-full max-w-2xl flex-col gap-8">
        <div
          className={`${gamePanel} ${gamePanelTopAccent} relative overflow-visible`}
        >
          <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
            <div className="flex items-start gap-4">
              <div
                className="flex size-16 shrink-0 items-center justify-center rounded-sm border-2 border-[var(--game-cyan)] bg-[linear-gradient(145deg,rgba(65,245,240,0.2),rgba(255,61,154,0.12))] font-[family-name:var(--font-orbitron)] text-2xl font-black text-[var(--game-amber)] shadow-[0_0_24px_rgba(65,245,240,0.25)] sm:size-20 sm:text-3xl"
                aria-hidden
              >
                {initial}
              </div>
              <div>
                <p className={gameLabel}>Fighter profile</p>
                <p className={`${gameTitle} mt-1 text-2xl sm:text-3xl`}>
                  {user.username}
                </p>
                {user.walletAddress ? (
                  <p className="mt-2 max-w-md break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
                    {user.walletAddress}
                  </p>
                ) : (
                  <p className={`${gameMuted} mt-2`}>No wallet on file.</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className={`${gameBtnGhost} self-start sm:!w-auto`}
            >
              Log out
            </button>
          </div>
        </div>

        <div className={`${gamePanel} ${gamePanelTopAccent} p-6 sm:p-8`}>
          <p className={`${gameTitle} mb-4 text-lg sm:text-xl`}>Menu</p>
          <HubPlayModeMenu />
          <div className="mt-4">
            <Link
              href="/duel/history"
              className={`${gameBtnGhost} inline-flex !w-full border-[var(--game-cyan-dim)] text-[var(--game-cyan)] sm:!w-auto`}
            >
              Duel history
            </Link>
          </div>
          <OpenDuelsMenu />
        </div>

        <Link
          href="/duel/new"
          className="group relative block w-full overflow-hidden rounded-sm border-2 border-[var(--game-magenta)] bg-[linear-gradient(180deg,rgba(255,61,154,0.22),rgba(20,8,40,0.98))] px-6 py-8 text-center shadow-[0_0_40px_rgba(255,61,154,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:brightness-110 hover:shadow-[0_0_56px_rgba(255,61,154,0.45)] sm:py-10"
        >
          <span className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-55deg,transparent,transparent_6px,rgba(255,255,255,0.02)_6px,rgba(255,255,255,0.02)_7px)] opacity-60" />
          <span className="relative font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-[0.45em] text-[var(--game-amber)]">
            Enter arena
          </span>
          <span className="relative mt-2 block font-[family-name:var(--font-orbitron)] text-3xl font-black uppercase tracking-[0.15em] text-[var(--game-magenta)] [text-shadow:0_0_32px_rgba(255,61,154,0.75)] sm:text-4xl md:text-5xl">
            Duel
          </span>
          <span className="relative mt-2 block text-sm text-[var(--game-text-muted)]">
            Create a match · set stake · invite your opponent
          </span>
        </Link>

        {user.walletAddress ? (
          <>
            <TokenSwapTest />
            <WalletProfile walletAddress={user.walletAddress} />
          </>
        ) : null}
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
