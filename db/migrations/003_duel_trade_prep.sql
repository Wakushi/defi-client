-- Préparation trade : flags prêt + configs JSON par joueur.
ALTER TABLE duels
  ADD COLUMN IF NOT EXISTS ready_state JSONB NOT NULL DEFAULT '[0,0]'::jsonb,
  ADD COLUMN IF NOT EXISTS ready_both_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS creator_trade_config JSONB,
  ADD COLUMN IF NOT EXISTS opponent_trade_config JSONB;
