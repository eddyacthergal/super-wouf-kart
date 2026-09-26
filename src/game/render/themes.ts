/**
 * Thèmes de rendu, par identifiant de thème des circuits. Ajouter un thème : une entrée ici
 * (ambiance + construction du monde), puis l'utiliser dans une définition de circuit.
 */
import type { TrackThemeId } from '../track/track-definition';
import { buildGardenWorld } from './garden-world';
import { SUMMER_LIGHT } from './lighting';
import { PALETTE } from './palette';
import type { SceneTheme } from './scene-theme';
import { SNOW_THEME } from './snow-park';
import { FOG_FAR, FOG_NEAR, SUMMER_CLOUDS, SUMMER_SKY } from './sky';

/** Jardin en plein été (le thème d'origine). */
export const GARDEN_THEME: SceneTheme = {
  sky: SUMMER_SKY,
  fog: { color: PALETTE.skyHorizon, near: FOG_NEAR, far: FOG_FAR },
  light: SUMMER_LIGHT,
  clouds: SUMMER_CLOUDS,
  buildWorld: (track, decor) => buildGardenWorld(track, decor),
};

export const SCENE_THEMES: Readonly<Record<TrackThemeId, SceneTheme>> = {
  garden: GARDEN_THEME,
  snow: SNOW_THEME,
};
