/**
 * Palette du jardin : couleurs vives et saturées, lumière d'été.
 * Valeurs CSS (sRGB) ; three.js les convertit dans l'espace de travail linéaire.
 */
export const PALETTE = {
  skyTop: '#2f8fe8',
  skyHorizon: '#cfeaff',
  sun: '#fff6d8',
  sunLight: '#fff1d2',
  hemisphereSky: '#cbe6ff',
  hemisphereGround: '#6aa845',
  lawnLight: '#7fd354',
  lawnDark: '#63ba40',
  gravel: '#e8d4a8',
  mulch: '#7b4a2c',
  curbRed: '#e63946',
  curbWhite: '#fbfbf7',
  hedges: ['#3d9a38', '#48a742', '#338a32', '#57b24a', '#2f7f2e'],
  bone: '#f4e8c8',
  bannerRed: '#e2352f',
  bannerYellow: '#ffcf33',
  fence: '#f6f3ea',
  trunk: '#8a5a36',
  foliage: ['#3f9c3a', '#4db044', '#5cc24c', '#378d35', '#68c957'],
  stone: ['#b9b2a6', '#a8a197', '#c7c0b3', '#9d968b'],
  cloud: '#ffffff',
} as const;

/** Paliers de dérapage : 0 jaune (dérapage pas encore chargé), 1 bleu, 2 orange, 3 violet. */
export const DRIFT_TIER_COLORS = ['#ffd84a', '#3fa9ff', '#ff9f1c', '#c77dff'] as const;
