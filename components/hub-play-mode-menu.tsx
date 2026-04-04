"use client"

import { gameTabActive, gameTabRow, gameLabel, gameMuted } from "@/components/game-ui"
import { usePlayMode } from "@/components/play-mode-context"

/** Sélecteur de mode hub — à placer dans le menu (pas de barre globale). */
export function HubPlayModeMenu() {
  const { playMode, setPlayMode } = usePlayMode()

  return (
    <div className="space-y-3">
      <p className={gameLabel}>Réseau hub</p>
      <div className={gameTabRow}>
        <button
          type="button"
          onClick={() => setPlayMode("friendly")}
          className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider transition ${gameTabActive(playMode === "friendly")}`}
        >
          Friendly
        </button>
        <button
          type="button"
          onClick={() => setPlayMode("duel")}
          className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider transition ${gameTabActive(playMode === "duel")}`}
        >
          Duel
        </button>
      </div>
      <p className={`${gameMuted} text-xs`}>
        {playMode === "friendly" ? (
          <>Testnet (ex. Arbitrum Sepolia) — solde faucet / paires démo.</>
        ) : (
          <>Arbitrum One — soldes réels, duels créés sur mainnet.</>
        )}
      </p>
    </div>
  )
}
