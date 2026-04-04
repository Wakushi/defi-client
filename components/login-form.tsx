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

type Props = {
  onSuccess?: () => void | Promise<void>
}

export function LoginForm({ onSuccess }: Props) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pseudo: username, password }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? "Login failed.")
        return
      }
      setUsername("")
      setPassword("")
      await onSuccess?.()
    } catch {
      setError("Network error.")
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
        <p className={gameLabel}>Player access</p>
        <h1 className={`${gameTitle} text-xl sm:text-2xl`}>Log in</h1>
        <p className={gameMuted}>
          Same username and password you used at sign-up.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="login-username" className={gameLabel}>
            Username
          </label>
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(ev) => setUsername(ev.target.value)}
            className={gameInput}
            placeholder="your_username"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="login-password" className={gameLabel}>
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            className={gameInput}
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
        {loading ? "Signing in…" : "Enter the arena"}
      </button>
    </form>
  )
}
