-- Ouverture de position duel par joueur (évite re-POST execute-trade au reload).
ALTER TABLE duels
  ADD COLUMN IF NOT EXISTS creator_trade_opened_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS opponent_trade_opened_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS creator_open_trade_tx_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS opponent_open_trade_tx_hash TEXT NULL;
