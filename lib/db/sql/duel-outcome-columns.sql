-- Résultat duel : PnL finaux et vainqueur (côté créateur vs adversaire).
ALTER TABLE duels
  ADD COLUMN IF NOT EXISTS creator_pnl_usdc NUMERIC(24, 12) NULL,
  ADD COLUMN IF NOT EXISTS opponent_pnl_usdc NUMERIC(24, 12) NULL,
  ADD COLUMN IF NOT EXISTS creator_pnl_pct DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS opponent_pnl_pct DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS duel_winner_side TEXT NULL;

-- Pas de contrainte CHECK nommée pour rester idempotent sur vieilles DB.
-- Valeurs attendues : creator | opponent | tie
