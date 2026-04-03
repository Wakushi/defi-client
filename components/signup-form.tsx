"use client";

import { type FormEvent, useState } from "react";

type SuccessPayload = {
  username: string;
  walletAddress: string;
};

export function SignupForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessPayload | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pseudo: username, password }),
      });
      const data = (await res.json()) as {
        error?: string;
        walletAddress?: string;
        username?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      if (data.walletAddress && data.username) {
        setSuccess({ username: data.username, walletAddress: data.walletAddress });
        setUsername("");
        setPassword("");
      }
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-8">
        <p className="text-lg font-medium tracking-tight">Account created</p>
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
          Welcome, <span className="font-medium text-foreground">{success.username}</span>.
          Your EVM wallet has been created.
        </p>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
            Wallet address
          </p>
          <p className="break-all rounded-lg bg-[color-mix(in_oklab,var(--foreground)8%,transparent)] px-3 py-2 font-mono text-sm">
            {success.walletAddress}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSuccess(null)}
          className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)18%,transparent)] py-2.5 text-sm font-medium transition hover:bg-[color-mix(in_oklab,var(--foreground)8%,transparent)]"
        >
          Create another account
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-md space-y-6 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-8"
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)65%,transparent)]">
          Pick a username and password. A wallet will be created automatically (the same password secures your Dynamic wallet).
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="username" className="text-sm font-medium">
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
            className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-background px-3 py-2.5 text-sm outline-none ring-offset-background transition focus:ring-2 focus:ring-[color-mix(in_oklab,var(--foreground)35%,transparent)]"
            placeholder="your_username"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
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
            className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-background px-3 py-2.5 text-sm outline-none ring-offset-background transition focus:ring-2 focus:ring-[color-mix(in_oklab,var(--foreground)35%,transparent)]"
            placeholder="At least 8 characters"
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-500/12 px-3 py-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-foreground py-2.5 text-sm font-medium text-background transition enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Creating…" : "Create account & wallet"}
      </button>
    </form>
  );
}
