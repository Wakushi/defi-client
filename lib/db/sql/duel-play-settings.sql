-- Mode global du match + chaîne Gains par rôle (évolution : Base vs Arbitrum par joueur).
ALTER TABLE duels
  ADD COLUMN IF NOT EXISTS play_mode TEXT NOT NULL DEFAULT 'friendly',
  ADD COLUMN IF NOT EXISTS creator_chain TEXT NOT NULL DEFAULT 'Testnet',
  ADD COLUMN IF NOT EXISTS opponent_chain TEXT NOT NULL DEFAULT 'Testnet';
