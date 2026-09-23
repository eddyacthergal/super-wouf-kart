/** Module course : plateau, grille, progression, classement, collisions, résultats et simulation. */
export { resolveKartCollisions } from './collisions';
export { updateProgress } from './progress';
export { createRaceState, type RaceOptions } from './race-setup';
export { computeRanks } from './ranking';
export { computeResults } from './results';
export { AI_KART_COLORS, AI_NAMES, PLAYER_KART_COLOR, PLAYER_NAME, createRoster } from './roster';
export { RaceSimulation, type RaceSimulationOptions } from './simulation';
