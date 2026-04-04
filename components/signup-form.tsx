"use client"

import { type FormEvent, useState } from "react"

import {
  gameBtnPrimary,
  gameInput,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
  gameTitle,
} from "@/components/game-ui"

export type SignupSuccessPayload = {
  faucetStatus: "sent" | "not_configured" | "failed"
  faucetError?: string
  walletAddress: string
}

type Props = {
  onSuccess?: (info?: SignupSuccessPayload) => void | Promise<void>
}

export function SignupForm({ onSuccess }: Props) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pseudo: username, password }),
      })
      const data = (await res.json()) as {
        error?: string
        walletAddress?: string
        faucetStatus?: SignupSuccessPayload["faucetStatus"]
        faucetError?: string
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.")
        return
      }
      setUsername("")
      setPassword("")
      const walletAddress =
        typeof data.walletAddress === "string" ? data.walletAddress : ""
      const faucetStatus = data.faucetStatus ?? "not_configured"
      await onSuccess?.({
        walletAddress,
        faucetStatus,
        ...(typeof data.faucetError === "string"
          ? { faucetError: data.faucetError }
          : {}),
      })
    } catch {
      setError("Network error. Check your connection.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`${gamePanel} ${gamePanelTopAccent} mx-auto w-full max-w-md space-y-6 p-8`}
    >
      <div className="space-y-2">
        <p className={gameLabel}>New fighter</p>
        <h1 className={`${gameTitle} text-xl sm:text-2xl`}>Create account</h1>
        <p className={gameMuted}>
          Pick a username and password for your account. A Dynamic wallet is
          created for you on sign-up.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="username" className={gameLabel}>
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            minLength={2}
            maxLength={32}
            value={username}
            onChange={(ev) => setUsername(ev.target.value)}
            className={gameInput}
            placeholder="your_username"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className={gameLabel}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            className={gameInput}
            placeholder="At least 8 characters"
          />
        </div>
      </div>

      {error ? (
        <p
          className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={loading} className={gameBtnPrimary}>
        {loading ? "Creating…" : "Create account & wallet"}
      </button>
    </form>
  )
}
