-- Cycle de vie duel : `start` WS → live ; fin chrono → fermé (reload sans re-attendre start).
ALTER TABLE duels
  ADD COLUMN IF NOT EXISTS duel_live_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS duel_closed_at TIMESTAMPTZ NULL;
