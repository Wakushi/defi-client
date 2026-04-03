-- Exécuter sur la base Defiduel (psql, DataGrip, etc.)
-- `users.id` est en UUID : les FK doivent être UUID aussi (pas TEXT).
-- Si une ancienne table `duels` existe avec TEXT : DROP TABLE duels; puis relancer ce script.
CREATE TABLE IF NOT EXISTS duels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  opponent_id UUID REFERENCES users (id) ON DELETE SET NULL,
  stake_usdc NUMERIC(20, 6) NOT NULL,
  duration_seconds INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT duels_duration_positive CHECK (duration_seconds > 0),
  CONSTRAINT duels_stake_usdc_positive CHECK (stake_usdc > 0)
);

CREATE INDEX IF NOT EXISTS duels_creator_id_idx ON duels (creator_id);
