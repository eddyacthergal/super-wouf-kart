/**
 * Écrit public/build-info.json avec la date du build (et la version de package.json).
 * Lancé par `npm start`, `npm run build` et `npm run watch`. Fichier facultatif : s'il manque
 * (ng build lancé directement), le jeu se construit quand même et l'accueil n'affiche que la version.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const info = { version: pkg.version, buildDate: new Date().toISOString() };

writeFileSync(
  new URL('../public/build-info.json', import.meta.url),
  `${JSON.stringify(info, null, 2)}\n`,
);
console.log(`build-info : version ${info.version}, build du ${info.buildDate}`);
