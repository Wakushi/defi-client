"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  gameBtnGhost,
  gameBtnPrimary,
  gameInput,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
  gameTitle,
} from "@/components/game-ui";
import type { MobulaPortfolioPosition } from "@/types/mobula-portfolio";

type Props = {
  open: boolean;
  onClose: () => void;
  positions: MobulaPortfolioPosition[];
  onSuccess: () => void;
};

function explorerTxUrl(chainId: number, txHash: string): string | null {
  if (chainId === 42161) return `https://arbiscan.io/tx/${txHash}`;
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 1) return `https://etherscan.io/tx/${txHash}`;
  if (chainId === 421614) return `https://sepolia.arbiscan.io/tx/${txHash}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
  return null;
}

export function WalletWithdrawModal({
  open,
  onClose,
  positions,
  onSuccess,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [useMax, setUseMax] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [resultChainId, setResultChainId] = useState<number | null>(null);

  const selected = useMemo(
    () => positions.find((p) => p.id === selectedId) ?? positions[0] ?? null,
    [positions, selectedId],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTxHash(null);
    setResultChainId(null);
    setBusy(false);
    if (positions.length > 0) {
      setSelectedId((id) => (positions.some((p) => p.id === id) ? id : positions[0]!.id));
    }
  }, [open, positions]);

  const submit = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setTxHash(null);
    setResultChainId(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        chainId: selected.chainId,
        tokenAddress: selected.tokenAddress,
        recipient: recipient.trim(),
        amountMax: useMax,
      };
      if (!useMax) {
        body.amount = amount.trim();
      }
      const r = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as {
        error?: string;
        txHash?: string;
        chainId?: number;
      };
      if (!r.ok) {
        setError(data.error ?? "Withdrawal failed.");
        return;
      }
      if (data.txHash) {
        setTxHash(data.txHash);
        setResultChainId(typeof data.chainId === "number" ? data.chainId : null);
      }
      onSuccess();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }, [selected, recipient, amount, useMax, onSuccess]);

  if (!open) return null;

  const explorer =
    txHash && resultChainId != null ? explorerTxUrl(resultChainId, txHash) : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(4,2,12,0.82)] p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
      onClick={onClose}
    >
      <div
        className={`${gamePanel} ${gamePanelTopAccent} max-h-[90vh] w-full max-w-md overflow-y-auto shadow-[0_0_48px_rgba(65,245,240,0.15)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--game-cyan-dim)]/50 px-5 py-4 sm:px-6">
          <h2
            id="withdraw-modal-title"
            className={`${gameTitle} text-lg sm:text-xl`}
          >
            Withdraw funds
          </h2>
          <p className={`${gameMuted} mt-1 text-xs`}>
            Send ERC-20 tokens or native ETH from your embedded wallet. Double-check the network and
            recipient. For token withdrawals you still need a small amount of native gas on that chain.
          </p>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {positions.length === 0 ? (
            <p className={gameMuted}>No assets to withdraw.</p>
          ) : (
            <>
              <label className="block space-y-2">
                <span className={gameLabel}>Token</span>
                <select
                  value={selected?.id ?? ""}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className={gameInput}
                >
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.symbol} · {p.chainLabel ?? `chain ${p.chainId}`} ·{" "}
                      {p.balance.toLocaleString("en-US", { maximumFractionDigits: 8 })}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className={gameLabel}>Adresse destinataire</span>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x…"
                  className={gameInput}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <div className="space-y-2">
                <span className={gameLabel}>Amount</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setUseMax(false);
                    }}
                    disabled={useMax}
                    placeholder={selected ? `max ~ ${selected.balance}` : "0"}
                    className={`${gameInput} min-w-[8rem] flex-1`}
                  />
                  <button
                    type="button"
                    disabled={!selected}
                    onClick={() => {
                      setUseMax(true);
                      setAmount("");
                    }}
                    className={`${gameBtnGhost} !w-auto shrink-0`}
                  >
                    Withdraw max
                  </button>
                </div>
                <p className={`${gameMuted} text-xs`}>
                  “Withdraw max” sends 100% of the token’s on-chain balance (may differ slightly from the
                  amount shown by the indexer).
                </p>
              </div>
            </>
          )}

          {error ? (
            <p className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]">
              {error}
            </p>
          ) : null}

          {txHash ? (
            <div className="rounded-sm border border-[var(--game-cyan)]/40 bg-[rgba(65,245,240,0.08)] px-3 py-2 text-sm text-[var(--game-cyan)]">
              <p className="font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-wider">
                Transaction sent
              </p>
              <p className="mt-1 break-all font-[family-name:var(--font-share-tech)] text-xs">
                {txHash}
              </p>
              {explorer ? (
                <a
                  href={explorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs underline"
                >
                  View on explorer
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className={`${gameBtnGhost} w-full sm:w-auto`}
            >
              Close
            </button>
            {positions.length > 0 ? (
              <button
                type="button"
                disabled={
                  busy ||
                  !recipient.trim() ||
                  (!useMax && !amount.trim()) ||
                  Boolean(txHash)
                }
                onClick={() => void submit()}
                className={`${gameBtnPrimary} w-full sm:w-auto`}
              >
                {busy ? "Signing…" : "Confirm withdrawal"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
