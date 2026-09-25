import { InjectionToken } from '@angular/core';
import { version } from '../../../package.json';

/** Version du jeu : celle de package.json, lue à la compilation. */
export const APP_VERSION: string = version;

/** Fichier écrit par scripts/build-info.mjs et servi avec les ressources statiques (public/). */
const BUILD_INFO_URL = 'build-info.json';

/** Charge la date ISO du build ; null si le fichier est absent ou illisible. */
export type BuildDateLoader = () => Promise<string | null>;

export const BUILD_DATE_LOADER = new InjectionToken<BuildDateLoader>('BUILD_DATE_LOADER', {
  providedIn: 'root',
  factory: () => fetchBuildDate,
});

async function fetchBuildDate(): Promise<string | null> {
  try {
    const response = await fetch(BUILD_INFO_URL, { cache: 'no-cache' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return typeof data === 'object' &&
      data !== null &&
      'buildDate' in data &&
      typeof data.buildDate === 'string'
      ? data.buildDate
      : null;
  } catch {
    return null;
  }
}
