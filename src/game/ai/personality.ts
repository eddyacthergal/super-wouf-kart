/**
 * Personnalité d'un pilote IA : couloir préféré, niveau, goût pour les objets et pour le dérapage.
 * Tirée une fois pour toutes à la création de la course (aléatoire déterministe via Rng).
 */
import type { Rng } from '../core/rng';
import { clamp } from '../core/vec2';

export interface AiPersonality {
  /** Décalage latéral préféré par rapport à la ligne médiane (m, + = gauche), dans [-3, 3]. */
  laneOffset: number;
  /** Multiplicateur de la vitesse de virage admissible, dans [0.9, 1]. */
  skill: number;
  /** Empressement à utiliser les objets, dans [0, 1]. */
  aggression: number;
  /** Probabilité de déraper dans un virage serré, dans [0, 1]. */
  driftSkill: number;
  /** Palier de mini-turbo visé avant de relâcher le dérapage. */
  targetTier: 1 | 2;
}

/** Couloirs de base alternés à gauche et à droite, pour que les IA ne suivent pas toutes la même ligne. */
const LANE_PATTERN = [-2, 2, -0.7, 0.7, -2.8, 2.8, -1.4, 1.4];
const LANE_JITTER = 0.5;
const MAX_LANE_OFFSET = 3;
const MIN_SKILL = 0.9;
const MAX_SKILL = 1;
const MIN_DRIFT_SKILL = 0.3;
/** À partir de ce niveau de dérapage, l'IA vise le palier 2 (orange). */
const EXPERT_DRIFT_SKILL = 0.65;

export function createAiPersonality(rng: Rng, index: number): AiPersonality {
  const count = LANE_PATTERN.length;
  const baseLane = LANE_PATTERN[((Math.trunc(index) % count) + count) % count];
  // Toujours le même nombre de tirages, quel que soit l'indice.
  const laneOffset = clamp(baseLane + rng.range(-LANE_JITTER, LANE_JITTER), -MAX_LANE_OFFSET, MAX_LANE_OFFSET);
  const skill = rng.range(MIN_SKILL, MAX_SKILL);
  const aggression = rng.next();
  const driftSkill = rng.range(MIN_DRIFT_SKILL, 1);
  return { laneOffset, skill, aggression, driftSkill, targetTier: driftSkill >= EXPERT_DRIFT_SKILL ? 2 : 1 };
}
