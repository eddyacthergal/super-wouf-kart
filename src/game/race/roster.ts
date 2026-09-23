/**
 * Composition du plateau : 7 pilotes IA tirés au sort puis le joueur, qui part en dernière position.
 * Tout l'aléatoire passe par `Rng` : même graine, même plateau.
 */
import { RACER_COUNT } from '../core/constants';
import type { BreedId, RacerEntry, Rng, SkinSelection } from '../core/types';
import { BREED_LIST } from '../dogs/breeds';
import { SKIN_SLOTS, skinsForSlot } from '../dogs/skins-catalog';

export const PLAYER_NAME = 'Toi';
/** Rouge réservé au kart du joueur. */
export const PLAYER_KART_COLOR = '#d7322e';

export const AI_NAMES: readonly string[] = [
  'Pépito',
  'Biscotte',
  'Noisette',
  'Rocky',
  'Moka',
  'Filou',
  'Praline',
  'Oscar',
  'Caramel',
  'Truffe',
];

/** Couleurs vives des karts IA (le rouge du joueur complète la palette de 8). */
export const AI_KART_COLORS: readonly string[] = [
  '#2d6cdf',
  '#f2a007',
  '#2fa84f',
  '#8e44ad',
  '#e67e22',
  '#16a3b8',
  '#e84393',
];

const AI_SKILL_MIN = 0.93;
const AI_SKILL_MAX = 1.0;
/** Probabilité qu'un emplacement d'accessoire reste vide chez une IA. */
const EMPTY_SKIN_CHANCE = 0.5;

export function createRoster(
  playerBreed: BreedId,
  playerSkins: SkinSelection,
  rng: Rng,
): RacerEntry[] {
  const aiCount = RACER_COUNT - 1;
  const names = shuffle(AI_NAMES, rng).slice(0, aiCount);
  const colors = shuffle(AI_KART_COLORS, rng);
  const breeds = aiBreeds(aiCount, rng);

  const entries: RacerEntry[] = [];
  for (let i = 0; i < aiCount; i++) {
    entries.push({
      name: names[i],
      breed: breeds[i],
      skins: randomSkins(rng),
      kartColor: colors[i % colors.length],
      isPlayer: false,
      aiSkill: rng.range(AI_SKILL_MIN, AI_SKILL_MAX),
    });
  }
  entries.push({
    name: PLAYER_NAME,
    breed: playerBreed,
    skins: { ...playerSkins },
    kartColor: PLAYER_KART_COLOR,
    isPlayer: true,
    aiSkill: 1,
  });
  return entries;
}

/** Chaque race au moins une fois (si le nombre d'IA le permet), le reste au hasard, dans un ordre mélangé. */
function aiBreeds(count: number, rng: Rng): BreedId[] {
  const ids = BREED_LIST.map((breed) => breed.id);
  const breeds = ids.slice(0, count);
  while (breeds.length < count) breeds.push(rng.pick(ids));
  return shuffle(breeds, rng);
}

function randomSkins(rng: Rng): SkinSelection {
  const skins: SkinSelection = { head: null, neck: null, body: null };
  for (const slot of SKIN_SLOTS) {
    if (rng.next() < EMPTY_SKIN_CHANCE) continue;
    skins[slot] = rng.pick(skinsForSlot(slot)).id;
  }
  return skins;
}

/** Mélange de Fisher-Yates (copie). */
function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}
