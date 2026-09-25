/**
 * Génère src/app/core/build-info.ts : version du projet (package.json) et date du build.
 * Lancé automatiquement avant `npm start`, `npm run build`, `npm run watch` et `npm test`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const info = { version: pkg.version, buildDate: new Date().toISOString() };

const source = `// Fichier généré par scripts/build-info.mjs : ne pas modifier, ne pas versionner.
export const BUILD_INFO = {
  version: ${JSON.stringify(info.version)},
  buildDate: ${JSON.stringify(info.buildDate)},
} as const;
`;

writeFileSync(new URL('../src/app/core/build-info.ts', import.meta.url), source);
console.log(`build-info : version ${info.version}, build du ${info.buildDate}`);
