-- Optionnel : autoriser NULL pour les chaînes non encore choisies (mode duel).
-- Sans cette migration, l’app utilise la sentinelle textuelle `unset` (voir lib/duel/play-mode.ts).
ALTER TABLE duels
  ALTER COLUMN creator_chain DROP NOT NULL,
  ALTER COLUMN opponent_chain DROP NOT NULL;
