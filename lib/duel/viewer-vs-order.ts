/**
 * Bannière VS : celui qui consulte est toujours à gauche.
 * - Créateur : son pseudo à gauche, adversaire ou « attente » à droite.
 * - Adversaire : son pseudo à gauche (fallback compte si pseudo duel absent), créateur à droite.
 * - Pas encore dans le match : à gauche ton pseudo si connecté·e, sinon le libellé d’attente ; créateur à droite.
 */

export type DuelVsBannerSides = {
  left: string;
  right: string;
  leftTag: string;
  rightTag: string;
};

export function duelVsBannerForViewer(
  creatorPseudo: string,
  opponentPseudo: string | null,
  viewer: { isCreator: boolean; isOpponent: boolean } | null,
  waitingLabel = "En attente…",
  /** Pseudo du compte connecté (session) — invité pas encore joint, ou secours si adversaire sans pseudo duel. */
  accountPseudo: string | null = null,
): DuelVsBannerSides {
  const opp = opponentPseudo ?? null;
  const meLeft = (accountPseudo ?? "").trim() || null;

  // 1) Créateur en premier : évite toute confusion avec un état « adversaire » incomplet.
  if (viewer?.isCreator) {
    return {
      left: creatorPseudo,
      right: opp ?? waitingLabel,
      leftTag: "Toi",
      rightTag: opp ? "Adversaire" : "En attente",
    };
  }

  // 2) Adversaire inscrit au duel
  if (viewer?.isOpponent) {
    return {
      left: opp ?? meLeft ?? waitingLabel,
      right: creatorPseudo,
      leftTag: "Toi",
      rightTag: "Adversaire",
    };
  }

  // 3) Pas dans le match
  if (opp) {
    // Duel complet, compte tiers : affichage neutre (pas le pseudo du spectateur à gauche).
    return {
      left: opp,
      right: creatorPseudo,
      leftTag: "Opponent",
      rightTag: "Creator",
    };
  }

  // Invité potentiel : toi à gauche (pseudo session ou libellé d’attente), hôte à droite
  return {
    left: meLeft ?? waitingLabel,
    right: creatorPseudo,
    leftTag: "Toi",
    rightTag: "Creator",
  };
}
