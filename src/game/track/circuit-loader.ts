/**
 * Lecture d'un fichier de circuit (JSON) : contrôle des champs, puis de la géométrie (ligne médiane).
 * Tous les problèmes sont listés d'un coup, en français, dans une CircuitError. Un champ inconnu est
 * refusé : c'est presque toujours une faute de frappe (« radious »).
 */
import type { Vec2 } from '../core/vec2';
import { buildCenterline, type TrackCorner } from './centerline';
import { CircuitError } from './circuit-error';
import {
  TRACK_THEMES,
  type LandmarkHint,
  type TrackDecorHints,
  type TrackDefinition,
  type TrackThemeId,
} from './track-definition';

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CIRCUIT_KEYS = [
  '$schema',
  'id',
  'name',
  'description',
  'theme',
  'laps',
  'start',
  'corners',
  'decor',
];
const CORNER_KEYS = ['x', 'z', 'radius', 'y', 'bank'];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function parseCircuit(json: unknown): TrackDefinition {
  const issues: string[] = [];
  if (!isObject(json)) throw new CircuitError(['Le fichier doit contenir un objet JSON.']);
  const label = typeof json['id'] === 'string' ? json['id'] : undefined;
  unknownKeys(json, CIRCUIT_KEYS, 'Circuit', issues);

  const id = text(json['id'], 'id', issues);
  if (id && !ID_PATTERN.test(id))
    issues.push(`« id » : minuscules, chiffres et tirets (« ${id} »).`);
  const name = text(json['name'], 'name', issues);
  const description = text(json['description'], 'description', issues);
  const theme = json['theme'];
  if (!TRACK_THEMES.includes(theme as TrackThemeId))
    issues.push(`« theme » : ${TRACK_THEMES.join(', ')} (reçu « ${String(theme)} »).`);
  const laps = json['laps'];
  if (
    laps !== undefined &&
    !(Number.isInteger(laps) && (laps as number) >= 1 && (laps as number) <= 9)
  )
    issues.push('« laps » : un entier de 1 à 9.');
  const start = point(json['start'], 'start', issues);
  const corners = cornerList(json['corners'], issues);
  const decor = decorHints(json['decor'], issues);
  if (issues.length > 0) throw new CircuitError(issues, label);

  // Géométrie : rayons qui tiennent, repères alignés, départ sur la bonne droite.
  try {
    buildCenterline(start!, corners);
  } catch (error) {
    if (error instanceof CircuitError) throw new CircuitError(error.issues, label);
    throw error;
  }
  return {
    id: id!,
    name: name!,
    description: description!,
    theme: theme as TrackThemeId,
    ...(laps !== undefined ? { laps: laps as number } : {}),
    start: start!,
    corners,
    ...(decor ? { decor } : {}),
  };
}

function unknownKeys(
  value: Json,
  allowed: readonly string[],
  where: string,
  issues: string[],
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) issues.push(`${where} : champ inconnu « ${key} ».`);
}

function text(value: unknown, field: string, issues: string[]): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value;
  issues.push(`« ${field} » : un texte non vide.`);
  return undefined;
}

function point(value: unknown, field: string, issues: string[]): Vec2 | undefined {
  if (isObject(value) && isFiniteNumber(value['x']) && isFiniteNumber(value['z']))
    return { x: value['x'], z: value['z'] };
  issues.push(`« ${field} » : { "x": nombre, "z": nombre }.`);
  return undefined;
}

function cornerList(value: unknown, issues: string[]): TrackCorner[] {
  if (!Array.isArray(value) || value.length < 3) {
    issues.push('« corners » : une liste d’au moins 3 coins.');
    return [];
  }
  return value.flatMap((raw, i): TrackCorner[] => {
    const where = `Coin ${i + 1}`;
    if (!isObject(raw)) {
      issues.push(`${where} : un objet { "x", "z", … }.`);
      return [];
    }
    const before = issues.length;
    unknownKeys(raw, CORNER_KEYS, where, issues);
    for (const axis of ['x', 'z'] as const)
      if (!isFiniteNumber(raw[axis]))
        issues.push(`${where} : « ${axis} » doit être un nombre fini.`);
    const { radius, y, bank } = raw;
    if (radius !== undefined && !(isFiniteNumber(radius) && radius > 0))
      issues.push(`${where} : le rayon doit être un nombre > 0.`);
    if (y !== undefined && !isFiniteNumber(y))
      issues.push(`${where} : « y » doit être un nombre fini.`);
    if (bank !== undefined && !(isFiniteNumber(bank) && bank >= 0 && bank <= 45))
      issues.push(`${where} : le dévers doit être un nombre de 0 à 45 (degrés).`);
    if (bank !== undefined && radius === undefined)
      issues.push(`${where} : un dévers demande un rayon (virage).`);
    if (issues.length > before) return [];
    return [
      {
        x: raw['x'] as number,
        z: raw['z'] as number,
        ...(radius !== undefined ? { radius: radius as number } : {}),
        ...(y !== undefined ? { y: y as number } : {}),
        ...(bank !== undefined ? { bank: bank as number } : {}),
      },
    ];
  });
}

function decorHints(value: unknown, issues: string[]): TrackDecorHints | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    issues.push('« decor » : un objet.');
    return undefined;
  }
  unknownKeys(value, ['landmarks', 'path'], 'Décor', issues);
  const hints: TrackDecorHints = {};
  const landmarks = value['landmarks'];
  if (landmarks !== undefined) {
    if (!Array.isArray(landmarks)) issues.push('« decor.landmarks » : une liste.');
    else
      hints.landmarks = landmarks.flatMap((raw, i): LandmarkHint[] => {
        const ok =
          isObject(raw) &&
          typeof raw['kind'] === 'string' &&
          isFiniteNumber(raw['x']) &&
          isFiniteNumber(raw['z']) &&
          isFiniteNumber(raw['radius']) &&
          raw['radius'] > 0;
        if (!ok) {
          issues.push(`Décor ${i + 1} : { "kind", "x", "z", "radius" > 0 }.`);
          return [];
        }
        return [
          {
            kind: raw['kind'] as string,
            x: raw['x'] as number,
            z: raw['z'] as number,
            radius: raw['radius'] as number,
          },
        ];
      });
  }
  const path = value['path'];
  if (path !== undefined) {
    const from = isObject(path) ? point(path['from'], 'decor.path.from', issues) : undefined;
    const to = isObject(path) ? point(path['to'], 'decor.path.to', issues) : undefined;
    if (!isObject(path)) issues.push('« decor.path » : { "from", "to" }.');
    if (from && to) hints.path = { from, to };
  }
  return hints;
}
