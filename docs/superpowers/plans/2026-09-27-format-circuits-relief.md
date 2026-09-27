# Format de circuit JSON et relief — plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (recommandé) ou
> superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** décrire les circuits en JSON (coins, rayons, altitude, dévers) et ajouter un relief qui
compte dans la conduite (côtes, descentes, virages relevés).

**Architecture :** le JSON est contrôlé par `circuit-loader.ts`, transformé en ligne médiane exacte
(droites + arcs, `centerline.ts`) et en profil d'altitude et de dévers (`profile.ts`). `Track` en tire
des échantillons qui portent `height`, `grade` et `bank`, et une nouvelle requête `surfaceAt`. La
simulation reste en 2D : la physique lit la pente sous le kart, le rendu pose tout à la hauteur de la
piste ou du relief (`terrain.ts`).

**Pile :** Angular 22, TypeScript 6 strict, three.js, Vitest via `@angular/build:unit-test`.

**Spec :** `docs/superpowers/specs/2026-09-27-format-circuits-relief-design.md`

## Contraintes globales

- Messages d'erreur, commentaires et documentation en français, dans le style du code existant.
- Aucune nouvelle dépendance npm.
- Mise en forme : `npx prettier --write <fichiers>` (largeur 100, guillemets simples).
- Lancer un fichier de test : `npx ng test --watch=false --include <chemin/du/fichier.spec.ts>`.
  Toute la suite : `npx ng test --watch=false`. Compilation : `npx ng build`.
- Règles du validateur : `maxGrade` 0,20 ; `maxBank` 20° ; altitude de 0 à 25 m ; `startMaxGrade`
  0,02 sur ±60 m autour du départ ; `minCrestRadius` 40 m.
- Dévers : rampe de 15 m avant et après l'arc. Relief : retour au niveau 0 sur 40 m au-delà des haies.
- Déviation maximale d'un coin : 150° (au-delà, deux coins). Repère sans rayon : ligne droite à 1° près.
- Le type des définitions garde son nom `TrackDefinition` (moins de changements que `CircuitDefinition`).
- Version : un seul `npm run release:minor` (0.4.1 → 0.5.0) et une entrée dans `CHANGELOG.md`.
- Branche : `feature/format-circuits-relief` (déjà créée, la spec y est commitée).
- Commits en français, terminés par :
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Points de vigilance (non couverts par les tests « normaux »)

1. Faute de frappe dans un JSON (`"radious"`) : le loader doit refuser en nommant le champ et le coin,
   pas ignorer le champ. → test en tâche 4.
2. Kart arrêté sur une pente, sans gaz : il ne doit pas partir à la dérive. → test en tâche 6.
3. Kart qui roule à contresens ou en marche arrière sur une pente : la pente se mesure dans la
   direction du cap. → test en tâche 6.
4. Virage relevé : le sol ne doit jamais dépasser la route entre les haies (bord intérieur plus bas).
   → test en tâche 8.
5. Départ à plat mais en altitude (y = 5) : pendant le compte à rebours, les karts doivent être à la
   hauteur de la route, pas à 0. → test en tâche 6.

---

### Tâche 1 : ligne médiane depuis les coins (`centerline.ts`)

**Fichiers :**
- Créer : `src/game/track/circuit-error.ts`
- Créer : `src/game/track/centerline.ts`
- Test : `src/game/track/centerline.spec.ts`

**Interfaces :**
- Produit :
  - `class CircuitError extends Error { readonly issues: readonly string[] }`
  - `interface TrackCorner { x: number; z: number; radius?: number; y?: number; bank?: number }`
  - `interface CenterlineArc { start: number; end: number; turn: 1 | -1 }`
  - `interface Centerline { points: Vec2[]; cumulative: number[]; length: number; cornerS: number[]; arcs: (CenterlineArc | null)[] }`
  - `buildCenterline(start: Vec2, corners: readonly TrackCorner[]): Centerline` (lève `CircuitError`)

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/game/track/centerline.spec.ts
import { describe, expect, it } from 'vitest';
import { distance, headingOf, wrapAngle } from '../core/vec2';
import { buildCenterline, type TrackCorner } from './centerline';
import { CircuitError } from './circuit-error';

/** Rectangle 200 × 100 parcouru vers la gauche, coins de rayon 20, départ au milieu du bas. */
const RECTANGLE: TrackCorner[] = [
  { x: -100, z: -50, radius: 20 },
  { x: -100, z: 50, radius: 20 },
  { x: 100, z: 50, radius: 20 },
  { x: 100, z: -50, radius: 20 },
];
const START = { x: 0, z: -50 };

describe('buildCenterline', () => {
  it('raccorde droites et arcs : longueur exacte et point 0 au départ', () => {
    const line = buildCenterline(START, RECTANGLE);
    // Périmètre du rectangle moins 4 × (2r − πr/2).
    const expected = 600 - 4 * (40 - 10 * Math.PI);
    expect(line.length).toBeCloseTo(expected, 1);
    expect(distance(line.points[0], START)).toBeLessThan(1e-9);
    expect(line.cumulative.length).toBe(line.points.length + 1);
    expect(line.cumulative.at(-1)).toBeCloseTo(line.length, 9);
  });

  it('garde un pas de 0,25 m au plus et reste sur les arcs (rayon exact)', () => {
    const line = buildCenterline(START, RECTANGLE);
    for (let i = 1; i < line.points.length; i++) {
      expect(distance(line.points[i - 1], line.points[i])).toBeLessThanOrEqual(0.2500001);
    }
    const arc = line.arcs[0]!;
    // Centre de l'arc du coin 1 : (−80, −30).
    for (let i = 0; i < line.points.length; i++) {
      const s = line.cumulative[i];
      if (s > arc.start + 0.5 && s < arc.end - 0.5)
        expect(distance(line.points[i], { x: -80, z: -30 })).toBeCloseTo(20, 3);
    }
  });

  it('donne le sens de chaque virage et l’abscisse du sommet de chaque arc', () => {
    const line = buildCenterline(START, RECTANGLE);
    expect(line.arcs.map((arc) => arc?.turn)).toEqual([1, 1, 1, 1]);
    const first = line.arcs[0]!;
    expect(first.end - first.start).toBeCloseTo(10 * Math.PI, 1);
    expect(line.cornerS[0]).toBeCloseTo((first.start + first.end) / 2, 0);
    // 80 m de droite du départ à l'entrée du premier arc.
    expect(first.start).toBeCloseTo(80, 1);
  });

  it('tourne de +360° en virages à gauche et de −360° en virages à droite', () => {
    const turning = (corners: TrackCorner[]) => {
      const { points } = buildCenterline(START, corners);
      let total = 0;
      for (let i = 1; i < points.length - 1; i++) {
        const a = { x: points[i].x - points[i - 1].x, z: points[i].z - points[i - 1].z };
        const b = { x: points[i + 1].x - points[i].x, z: points[i + 1].z - points[i].z };
        total += wrapAngle(headingOf(b) - headingOf(a));
      }
      return total;
    };
    expect(turning(RECTANGLE)).toBeCloseTo(2 * Math.PI, 1);
    expect(turning([...RECTANGLE].reverse())).toBeCloseTo(-2 * Math.PI, 1);
  });

  it('accepte un repère d’altitude aligné et donne son abscisse', () => {
    const corners = [RECTANGLE[0], { x: -100, z: 0 }, ...RECTANGLE.slice(1)];
    const line = buildCenterline(START, corners);
    expect(line.arcs[1]).toBeNull();
    // Du départ : 80 m de droite, l'arc (10π), puis 30 m de droite jusqu'à z = 0.
    expect(line.cornerS[1]).toBeCloseTo(80 + 10 * Math.PI + 30, 0);
  });

  it('accepte deux arcs qui se touchent (demi-cercle en deux coins)', () => {
    // Stade : chaque bout est un demi-cercle de rayon 30 fait de deux coins de 90°.
    const stadium: TrackCorner[] = [
      { x: 130, z: -30, radius: 30 },
      { x: 130, z: 30, radius: 30 },
      { x: -130, z: 30, radius: 30 },
      { x: -130, z: -30, radius: 30 },
    ];
    const line = buildCenterline({ x: 0, z: -30 }, stadium);
    expect(line.length).toBeCloseTo(2 * 200 + 2 * Math.PI * 30, 1);
  });

  it('refuse un rayon qui ne tient pas entre ses voisins, en nommant les coins', () => {
    const tooBig = RECTANGLE.map((corner) => ({ ...corner, radius: 60 }));
    expect(() => buildCenterline(START, tooBig)).toThrow(CircuitError);
    try {
      buildCenterline(START, tooBig);
    } catch (error) {
      expect((error as CircuitError).issues.join(' ')).toMatch(/Coins 1 et 2 .*120.* 100/);
    }
  });

  it('refuse un repère sans rayon qui n’est pas aligné', () => {
    const corners = [RECTANGLE[0], { x: -90, z: 0 }, ...RECTANGLE.slice(1)];
    expect(() => buildCenterline(START, corners)).toThrow(/Coin 2 .*rayon/);
  });

  it('refuse un coin de plus de 150° (il faut deux coins)', () => {
    const hairpin: TrackCorner[] = [
      { x: -100, z: -50, radius: 20 },
      { x: 100, z: -40, radius: 20 },
      { x: 100, z: 50, radius: 20 },
    ];
    expect(() => buildCenterline({ x: 0, z: -45 }, hairpin)).toThrow(/150°/);
  });

  it('refuse un départ qui n’est pas sur la droite du dernier au premier coin', () => {
    expect(() => buildCenterline({ x: 0, z: -40 }, RECTANGLE)).toThrow(/départ/);
    expect(() => buildCenterline({ x: -95, z: -50 }, RECTANGLE)).toThrow(/départ/);
  });

  it('refuse moins de 3 coins et des coins confondus', () => {
    expect(() => buildCenterline(START, RECTANGLE.slice(0, 2))).toThrow(/3 coins/);
    const same = [RECTANGLE[0], RECTANGLE[0], RECTANGLE[2], RECTANGLE[3]];
    expect(() => buildCenterline(START, same)).toThrow(/confondus/);
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

Lancer : `npx ng test --watch=false --include src/game/track/centerline.spec.ts`
Attendu : ÉCHEC, modules `./centerline` et `./circuit-error` introuvables.

- [ ] **Étape 3 : écrire le code**

```ts
// src/game/track/circuit-error.ts
/** Erreur de description d'un circuit : problèmes lisibles, en français, tous listés d'un coup. */
export class CircuitError extends Error {
  constructor(
    readonly issues: readonly string[],
    circuit?: string,
  ) {
    super(`${circuit ? `Circuit « ${circuit} » : ` : ''}${issues.join(' ')}`);
    this.name = 'CircuitError';
  }
}
```

```ts
// src/game/track/centerline.ts
/**
 * Ligne médiane d'un circuit décrit par ses coins : polygone fermé, parcouru dans l'ordre des coins,
 * dont chaque coin muni d'un rayon devient un arc tangent aux deux droites voisines. Un coin sans
 * rayon est un simple repère (d'altitude) sur une droite. Aucune dépendance au rendu.
 */
import { distance, headingOf, leftOfDirection, normalize, wrapAngle, type Vec2 } from '../core/vec2';
import { CircuitError } from './circuit-error';

/** Coin du polygone : position (m), rayon de l'arc (m), altitude au sommet (m), dévers (°). */
export interface TrackCorner {
  x: number;
  z: number;
  radius?: number;
  y?: number;
  bank?: number;
}

export interface CenterlineArc {
  /** Abscisses de début et de fin de l'arc (m). */
  start: number;
  end: number;
  /** +1 = virage à gauche, -1 = virage à droite. */
  turn: 1 | -1;
}

export interface Centerline {
  /** Polyligne fermée, pas ≤ 0,25 m ; points[0] = départ, non répété à la fin. */
  points: Vec2[];
  /** Abscisse de chaque point ; cumulative[points.length] = length (retour au départ). */
  cumulative: number[];
  length: number;
  /** Abscisse de référence de chaque coin : milieu de l'arc, ou le repère lui-même. */
  cornerS: number[];
  /** Arc de chaque coin (null : repère sans rayon, ou coin sans déviation). */
  arcs: (CenterlineArc | null)[];
}

/** Pas maximal de la polyligne (m). */
const STEP = 0.25;
const DEG = Math.PI / 180;
const MAX_DEFLECTION = 150 * DEG;
const WAYPOINT_TOLERANCE = 1 * DEG;
/** Écart toléré (m) entre le point de départ et la droite qui arrive au premier coin. */
const START_TOLERANCE = 0.5;
const EPSILON = 1e-6;

interface CornerGeometry {
  /** Direction d'arrivée et de départ (unitaires). */
  dirIn: Vec2;
  dirOut: Vec2;
  /** Déviation signée (rad, > 0 = gauche). */
  deflection: number;
  /** Distance du coin aux points de tangence (0 sans arc). */
  tangent: number;
  radius: number;
}

export function buildCenterline(start: Vec2, corners: readonly TrackCorner[]): Centerline {
  const n = corners.length;
  if (n < 3) throw new CircuitError(['Il faut au moins 3 coins.']);
  const issues: string[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    if (distance(corners[i], corners[next]) < EPSILON)
      issues.push(`Coins ${i + 1} et ${next + 1} confondus.`);
  }
  if (issues.length > 0) throw new CircuitError(issues);

  const geometry = corners.map((corner, i) => {
    const prev = corners[(i - 1 + n) % n];
    const next = corners[(i + 1) % n];
    const dirIn = normalize({ x: corner.x - prev.x, z: corner.z - prev.z });
    const dirOut = normalize({ x: next.x - corner.x, z: next.z - corner.z });
    const deflection = wrapAngle(headingOf(dirOut) - headingOf(dirIn));
    const radius = corner.radius ?? 0;
    if (radius > 0 && Math.abs(deflection) > MAX_DEFLECTION)
      issues.push(
        `Coin ${i + 1} : virage de ${Math.round(Math.abs(deflection) / DEG)}°, au-delà de 150° il faut deux coins.`,
      );
    if (radius <= 0 && Math.abs(deflection) > WAYPOINT_TOLERANCE)
      issues.push(
        `Coin ${i + 1} : la ligne tourne de ${Math.round(Math.abs(deflection) / DEG)}° ici, il faut un rayon.`,
      );
    const tangent = radius > 0 ? radius * Math.tan(Math.abs(deflection) / 2) : 0;
    return { dirIn, dirOut, deflection, tangent, radius } satisfies CornerGeometry;
  });

  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const edge = distance(corners[i], corners[next]);
    const needed = geometry[i].tangent + geometry[next].tangent;
    if (needed > edge + EPSILON)
      issues.push(
        `Coins ${i + 1} et ${next + 1} : rayons trop grands, il faudrait ${needed.toFixed(1)} m entre eux, il y en a ${edge.toFixed(1)}.`,
      );
  }

  // Départ : sur la droite qui va du dernier coin (après son arc) au premier (avant son arc).
  const last = n - 1;
  const lineStart = tangentOut(corners[last], geometry[last]);
  const lineEnd = tangentIn(corners[0], geometry[0]);
  const dir = geometry[0].dirIn;
  const along = (start.x - lineStart.x) * dir.x + (start.z - lineStart.z) * dir.z;
  const left = leftOfDirection(dir);
  const across = (start.x - lineStart.x) * left.x + (start.z - lineStart.z) * left.z;
  const span = distance(lineStart, lineEnd);
  if (Math.abs(across) > START_TOLERANCE || along < -EPSILON || along > span + EPSILON)
    issues.push(
      `Le départ (${start.x}, ${start.z}) doit être sur la ligne droite qui va du coin ${n} au coin 1.`,
    );
  if (issues.length > 0) throw new CircuitError(issues);

  const origin = { x: lineStart.x + dir.x * along, z: lineStart.z + dir.z * along };
  const points: Vec2[] = [];
  const marks: { cornerIndex: number[]; arcs: ({ from: number; to: number; turn: 1 | -1 } | null)[] } =
    { cornerIndex: [], arcs: [] };

  pushLine(points, origin, lineEnd);
  for (let i = 0; i < n; i++) {
    const g = geometry[i];
    const hasArc = g.tangent > EPSILON;
    if (hasArc) {
      const from = points.length;
      const mid = pushArc(points, corners[i], g);
      marks.cornerIndex.push(mid);
      marks.arcs.push({ from, to: points.length, turn: g.deflection > 0 ? 1 : -1 });
    } else {
      marks.cornerIndex.push(points.length);
      marks.arcs.push(null);
    }
    const nextIn = i === last ? origin : tangentIn(corners[i + 1], geometry[i + 1]);
    pushLine(points, tangentOut(corners[i], g), nextIn);
  }

  const cumulative = [0];
  for (let i = 1; i <= points.length; i++) {
    cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i % points.length]));
  }
  const length = cumulative[points.length];
  return {
    points,
    cumulative,
    length,
    cornerS: marks.cornerIndex.map((index) => cumulative[index]),
    arcs: marks.arcs.map((arc) =>
      arc ? { start: cumulative[arc.from], end: cumulative[arc.to], turn: arc.turn } : null,
    ),
  };
}

function tangentIn(corner: TrackCorner, g: CornerGeometry): Vec2 {
  return { x: corner.x - g.dirIn.x * g.tangent, z: corner.z - g.dirIn.z * g.tangent };
}

function tangentOut(corner: TrackCorner, g: CornerGeometry): Vec2 {
  return { x: corner.x + g.dirOut.x * g.tangent, z: corner.z + g.dirOut.z * g.tangent };
}

/** Ajoute les points de [from, to[ (to exclu : c'est le premier point du morceau suivant). */
function pushLine(points: Vec2[], from: Vec2, to: Vec2): void {
  const length = distance(from, to);
  if (length < EPSILON) return;
  const count = Math.ceil(length / STEP);
  for (let k = 0; k < count; k++) {
    const t = k / count;
    points.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
  }
}

/** Ajoute les points de l'arc du coin (fin exclue) ; renvoie l'indice du point du milieu. */
function pushArc(points: Vec2[], corner: TrackCorner, g: CornerGeometry): number {
  const turn = g.deflection > 0 ? 1 : -1;
  const entry = tangentIn(corner, g);
  const left = leftOfDirection(g.dirIn);
  // Centre : du côté intérieur du virage (à gauche pour un virage à gauche).
  const center = { x: entry.x + left.x * g.radius * turn, z: entry.z + left.z * g.radius * turn };
  const arcLength = g.radius * Math.abs(g.deflection);
  const count = Math.max(1, Math.ceil(arcLength / STEP));
  const heading0 = headingOf(g.dirIn);
  const first = points.length;
  for (let k = 0; k < count; k++) {
    const heading = heading0 + (turn * (arcLength * k)) / count / g.radius;
    // P(θ) = C − turn · R · gauche(θ), avec gauche(θ) = (cos θ, −sin θ).
    points.push({
      x: center.x - turn * g.radius * Math.cos(heading),
      z: center.z + turn * g.radius * Math.sin(heading),
    });
  }
  return first + Math.floor(count / 2);
}
```

- [ ] **Étape 4 : relancer les tests**

Lancer : `npx ng test --watch=false --include src/game/track/centerline.spec.ts`
Attendu : SUCCÈS. Si le test « rayon exact » échoue, vérifier le signe du centre dans `pushArc` : un
virage à gauche a son centre à gauche de la direction d'arrivée (`leftOfDirection`).

- [ ] **Étape 5 : mettre en forme et commiter**

```bash
npx prettier --write src/game/track/circuit-error.ts src/game/track/centerline.ts src/game/track/centerline.spec.ts
git add src/game/track/circuit-error.ts src/game/track/centerline.ts src/game/track/centerline.spec.ts
git commit -m "Circuits : ligne médiane exacte depuis les coins et les rayons

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 2 : profil d'altitude et de dévers (`profile.ts`)

**Fichiers :**
- Créer : `src/game/track/profile.ts`
- Test : `src/game/track/profile.spec.ts`

**Interfaces :**
- Consomme : `Centerline`, `TrackCorner`, `buildCenterline` (tâche 1).
- Produit :
  - `interface Profile { heightAt(s: number): number; gradeAt(s: number): number; bankAt(s: number): number }`
    (`bankAt` en radians, > 0 = la piste penche vers la gauche, bord gauche plus bas)
  - `const FLAT_PROFILE: Profile`
  - `const BANK_RAMP = 15`
  - `buildProfile(centerline: Centerline, corners: readonly TrackCorner[]): Profile`

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/game/track/profile.spec.ts
import { describe, expect, it } from 'vitest';
import { buildCenterline, type TrackCorner } from './centerline';
import { BANK_RAMP, FLAT_PROFILE, buildProfile } from './profile';

const START = { x: 0, z: -50 };
const corners = (extra: Partial<TrackCorner>[]): TrackCorner[] =>
  [
    { x: -100, z: -50, radius: 20 },
    { x: -100, z: 50, radius: 20 },
    { x: 100, z: 50, radius: 20 },
    { x: 100, z: -50, radius: 20 },
  ].map((corner, i) => ({ ...corner, ...extra[i] }));

function profileOf(extra: Partial<TrackCorner>[]) {
  const list = corners(extra);
  const line = buildCenterline(START, list);
  return { line, profile: buildProfile(line, list) };
}

describe('buildProfile — altitude', () => {
  it('circuit plat sans aucun y ; altitude constante avec un seul y', () => {
    expect(profileOf([]).profile.heightAt(123)).toBe(0);
    const { profile } = profileOf([{}, { y: 4 }]);
    expect(profile.heightAt(0)).toBe(4);
    expect(profile.gradeAt(300)).toBe(0);
  });

  it('passe par chaque repère, sans jamais dépasser les valeurs données', () => {
    const { line, profile } = profileOf([{ y: 0 }, { y: 6 }, { y: 6 }, { y: 2 }]);
    line.cornerS.forEach((s, i) => expect(profile.heightAt(s)).toBeCloseTo([0, 6, 6, 2][i], 9));
    for (let s = 0; s < line.length; s += 0.5) {
      expect(profile.heightAt(s)).toBeGreaterThanOrEqual(-1e-9);
      expect(profile.heightAt(s)).toBeLessThanOrEqual(6 + 1e-9);
    }
  });

  it('reste parfaitement plat entre deux repères de même altitude (faux plat sans bosse)', () => {
    const { line, profile } = profileOf([{ y: 0 }, { y: 6 }, { y: 6 }, { y: 2 }]);
    for (let s = line.cornerS[1]; s <= line.cornerS[2]; s += 1)
      expect(profile.heightAt(s)).toBeCloseTo(6, 9);
  });

  it('monte sans palier au repère intermédiaire d’une montée continue', () => {
    const { line, profile } = profileOf([{ y: 0 }, { y: 4 }, { y: 8 }, { y: 4 }]);
    expect(profile.gradeAt(line.cornerS[1])).toBeGreaterThan(0.01);
  });

  it('boucle sans cassure au départ et donne la pente dérivée de l’altitude', () => {
    const { line, profile } = profileOf([{ y: 2 }, { y: 6 }, {}, { y: 4 }]);
    expect(profile.heightAt(line.length - 1e-6)).toBeCloseTo(profile.heightAt(0), 5);
    for (const s of [10, 200, 480]) {
      const numeric = (profile.heightAt(s + 0.01) - profile.heightAt(s - 0.01)) / 0.02;
      expect(profile.gradeAt(s)).toBeCloseTo(numeric, 4);
    }
    expect(profile.heightAt(-5)).toBeCloseTo(profile.heightAt(line.length - 5), 9);
  });
});

describe('buildProfile — dévers', () => {
  it('pleine valeur sur l’arc, vers l’intérieur (gauche > 0), rampe de 15 m de part et d’autre', () => {
    const { line, profile } = profileOf([{ bank: 12 }]);
    const arc = line.arcs[0]!;
    const full = (12 * Math.PI) / 180;
    expect(profile.bankAt((arc.start + arc.end) / 2)).toBeCloseTo(full, 9);
    expect(profile.bankAt(arc.start - BANK_RAMP / 2)).toBeCloseTo(full / 2, 6);
    expect(profile.bankAt(arc.end + BANK_RAMP / 2)).toBeCloseTo(full / 2, 6);
    expect(profile.bankAt(arc.start - BANK_RAMP - 1)).toBe(0);
  });

  it('penche vers la droite (valeur négative) dans un virage à droite', () => {
    const list = corners([{ bank: 10 }]).reverse();
    const line = buildCenterline(START, list);
    const profile = buildProfile(line, list);
    const arc = line.arcs[3]!;
    expect(profile.bankAt((arc.start + arc.end) / 2)).toBeLessThan(0);
  });

  it('le profil plat vaut 0 partout', () => {
    expect([FLAT_PROFILE.heightAt(3), FLAT_PROFILE.gradeAt(3), FLAT_PROFILE.bankAt(3)]).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

Lancer : `npx ng test --watch=false --include src/game/track/profile.spec.ts`
Attendu : ÉCHEC, module `./profile` introuvable.

- [ ] **Étape 3 : écrire le code**

```ts
// src/game/track/profile.ts
/**
 * Profil d'un circuit le long de l'abscisse s : altitude (repères `y` des coins, interpolation cubique
 * monotone et périodique : ni palier à chaque repère, ni bosse entre deux repères égaux) et dévers
 * (valeur pleine sur l'arc, rampe linéaire avant et après). Aucune dépendance au rendu.
 */
import type { Centerline, CenterlineArc, TrackCorner } from './centerline';

export interface Profile {
  /** Altitude de la ligne médiane (m). */
  heightAt(s: number): number;
  /** Pente dh/ds (sans unité, 0,1 = 10 %). */
  gradeAt(s: number): number;
  /** Dévers signé (rad) : > 0 = la piste penche vers la gauche (bord gauche plus bas). */
  bankAt(s: number): number;
}

export const FLAT_PROFILE: Profile = { heightAt: () => 0, gradeAt: () => 0, bankAt: () => 0 };

/** Longueur (m) de la rampe de dévers avant et après l'arc. */
export const BANK_RAMP = 15;

interface Key {
  s: number;
  y: number;
}

export function buildProfile(centerline: Centerline, corners: readonly TrackCorner[]): Profile {
  const { length } = centerline;
  const keys: Key[] = [];
  corners.forEach((corner, i) => {
    if (corner.y !== undefined) keys.push({ s: centerline.cornerS[i], y: corner.y });
  });
  const height = monotoneCubic(keys, length);
  const banks = corners.flatMap((corner, i) => {
    const arc = centerline.arcs[i];
    return arc && corner.bank ? [{ arc, value: ((corner.bank * Math.PI) / 180) * arc.turn }] : [];
  });
  return {
    heightAt: (s) => height.value(s),
    gradeAt: (s) => height.slope(s),
    bankAt: (s) => banks.reduce((sum, { arc, value }) => sum + value * arcWeight(s, arc, length), 0),
  };
}

function wrap(s: number, length: number): number {
  return ((s % length) + length) % length;
}

/** 1 sur l'arc, décroissance linéaire sur BANK_RAMP m avant et après, 0 au-delà. */
function arcWeight(s: number, arc: CenterlineArc, length: number): number {
  const span = arc.end - arc.start;
  const rel = wrap(s - arc.start, length);
  if (rel <= span) return 1;
  const d = Math.min(rel - span, length - rel);
  return d < BANK_RAMP ? 1 - d / BANK_RAMP : 0;
}

/** Interpolation d'Hermite monotone (Fritsch-Carlson), périodique de période `length`. */
function monotoneCubic(
  keys: readonly Key[],
  length: number,
): { value(s: number): number; slope(s: number): number } {
  const n = keys.length;
  if (n === 0) return { value: () => 0, slope: () => 0 };
  if (n === 1) return { value: () => keys[0].y, slope: () => 0 };
  const h = keys.map((key, i) => (i < n - 1 ? keys[i + 1].s : keys[0].s + length) - key.s);
  const delta = keys.map((key, i) => (keys[(i + 1) % n].y - key.y) / h[i]);
  const m = keys.map((_, i) => {
    const prev = (i - 1 + n) % n;
    if (delta[prev] * delta[i] <= 0) return 0;
    const w1 = 2 * h[i] + h[prev];
    const w2 = h[i] + 2 * h[prev];
    return (w1 + w2) / (w1 / delta[prev] + w2 / delta[i]);
  });
  const locate = (s: number) => {
    const u = keys[0].s + wrap(s - keys[0].s, length);
    let i = n - 1;
    while (i > 0 && keys[i].s > u) i--;
    return { i, t: (u - keys[i].s) / h[i] };
  };
  return {
    value(s) {
      const { i, t } = locate(s);
      const t2 = t * t;
      const t3 = t2 * t;
      return (
        (2 * t3 - 3 * t2 + 1) * keys[i].y +
        (t3 - 2 * t2 + t) * h[i] * m[i] +
        (-2 * t3 + 3 * t2) * keys[(i + 1) % n].y +
        (t3 - t2) * h[i] * m[(i + 1) % n]
      );
    },
    slope(s) {
      const { i, t } = locate(s);
      const t2 = t * t;
      return (
        ((6 * t2 - 6 * t) * keys[i].y + (-6 * t2 + 6 * t) * keys[(i + 1) % n].y) / h[i] +
        (3 * t2 - 4 * t + 1) * m[i] +
        (3 * t2 - 2 * t) * m[(i + 1) % n]
      );
    },
  };
}
```

- [ ] **Étape 4 : relancer les tests**

Lancer : `npx ng test --watch=false --include src/game/track/profile.spec.ts`
Attendu : SUCCÈS.

- [ ] **Étape 5 : mettre en forme et commiter**

```bash
npx prettier --write src/game/track/profile.ts src/game/track/profile.spec.ts
git add src/game/track/profile.ts src/game/track/profile.spec.ts
git commit -m "Circuits : profil d'altitude monotone et dévers des virages

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 3 : le relief dans `TrackQuery` (échantillons et `surfaceAt`)

Les échantillons gagnent `height`, `grade` et `bank`, et `TrackQuery` gagne `surfaceAt`. `Track` garde
pour l'instant sa spline, avec un profil plat (la tâche 4 change sa construction).

**Fichiers :**
- Modifier : `src/game/core/types.ts:140-189` (`TrackSample`, `TrackQuery`, nouveau `TrackSurface`)
- Créer : `src/game/track/surface.ts`
- Modifier : `src/game/track/track.ts` (`buildSamples`, `interpolateSample`, `surfaceAt`)
- Modifier : `src/game/testing/fake-track.ts` (option de relief)
- Test : `src/game/track/surface.spec.ts`, `src/game/testing/fake-track.spec.ts`

**Interfaces :**
- Produit :
  - `TrackSample` + `height: number; grade: number; bank: number`
  - `interface TrackSurface { height: number; gradient: Vec2 }` (gradient = (∂h/∂x, ∂h/∂z))
  - `TrackQuery.surfaceAt(s: number, lateral: number): TrackSurface`
  - `surfaceOf(sample: TrackSample, lateral: number): TrackSurface` (dans `track/surface.ts`)
  - `createCircleTrack(radius?, direction?, relief?: { height?: number; grade?: number; bank?: number })`
    (altitude = `height + grade · s`, dévers constant en radians)

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/game/track/surface.spec.ts
import { describe, expect, it } from 'vitest';
import { ROAD_HALF_WIDTH } from '../core/constants';
import type { TrackSample } from '../core/types';
import { surfaceOf } from './surface';

const sample = (overrides: Partial<TrackSample> = {}): TrackSample => ({
  s: 0,
  position: { x: 0, z: 0 },
  tangent: { x: 0, z: 1 },
  left: { x: 1, z: 0 },
  halfWidth: ROAD_HALF_WIDTH,
  curvature: 0,
  height: 3,
  grade: 0.1,
  bank: 0.2,
  ...overrides,
});

describe('surfaceOf', () => {
  it('hauteur de la ligne médiane, bord gauche plus bas quand le dévers est positif', () => {
    expect(surfaceOf(sample(), 0).height).toBeCloseTo(3, 9);
    expect(surfaceOf(sample(), 5).height).toBeCloseTo(3 - 5 * Math.tan(0.2), 9);
    expect(surfaceOf(sample(), -5).height).toBeCloseTo(3 + 5 * Math.tan(0.2), 9);
  });

  it('gradient : pente le long de la tangente, dévers le long de la gauche', () => {
    const { gradient } = surfaceOf(sample(), 2);
    // Tangente +z : ∂h/∂z = grade ; gauche +x : ∂h/∂x = −tan(bank).
    expect(gradient.z).toBeCloseTo(0.1, 9);
    expect(gradient.x).toBeCloseTo(-Math.tan(0.2), 9);
  });
});
```

Ajouter à `src/game/testing/fake-track.spec.ts` (dans le `describe` existant ou un nouveau) :

```ts
import { createCircleTrack } from './fake-track';

describe('createCircleTrack — relief', () => {
  it('est plat par défaut', () => {
    const track = createCircleTrack(100);
    // toBeCloseTo : tan(0) donne −0, que toEqual distinguerait de 0.
    const surface = track.surfaceAt(40, 3);
    expect(surface.height).toBeCloseTo(0, 12);
    expect(surface.gradient.x).toBeCloseTo(0, 12);
    expect(surface.gradient.z).toBeCloseTo(0, 12);
    expect(track.samples.every((sample) => sample.height === 0 && sample.bank === 0)).toBe(true);
  });

  it('monte de `grade` par mètre et penche de `bank`', () => {
    const track = createCircleTrack(2000, 'left', { height: 5, grade: 0.1, bank: 0.2 });
    expect(track.sampleAt(30).height).toBeCloseTo(8, 6);
    expect(track.surfaceAt(30, 4).height).toBeCloseTo(8 - 4 * Math.tan(0.2), 6);
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

Lancer : `npx ng test --watch=false --include src/game/track/surface.spec.ts`
puis `npx ng test --watch=false --include src/game/testing/fake-track.spec.ts`
Attendu : ÉCHEC (module `./surface` introuvable ; `surfaceAt` inexistant).

- [ ] **Étape 3 : types**

Dans `src/game/core/types.ts`, compléter `TrackSample` et `TrackQuery` et ajouter `TrackSurface` :

```ts
export interface TrackSample {
  // … champs existants inchangés (s, position, tangent, left, halfWidth, curvature) …
  /** Altitude de la ligne médiane (m). */
  height: number;
  /** Pente dh/ds dans le sens de la course (0,1 = 10 %). */
  grade: number;
  /** Dévers (rad) : > 0 = la piste penche vers la gauche (bord gauche plus bas). */
  bank: number;
}

/** Sol de la piste en un point : hauteur (m) et gradient horizontal (∂h/∂x, ∂h/∂z). */
export interface TrackSurface {
  height: number;
  gradient: Vec2;
}

export interface TrackQuery {
  // … membres existants inchangés …
  /** Sol de la piste à l'abscisse s, à `lateral` m de la ligne médiane (+ = gauche). */
  surfaceAt(s: number, lateral: number): TrackSurface;
}
```

- [ ] **Étape 4 : `surface.ts`**

```ts
// src/game/track/surface.ts
/** Sol de la piste autour d'un échantillon : plan incliné par la pente et le dévers. */
import type { TrackSample, TrackSurface } from '../core/types';

export function surfaceOf(sample: TrackSample, lateral: number): TrackSurface {
  // dh/dlateral : un dévers positif abaisse le bord gauche (lateral > 0).
  const cross = -Math.tan(sample.bank);
  return {
    height: sample.height + cross * lateral,
    gradient: {
      x: sample.tangent.x * sample.grade + sample.left.x * cross,
      z: sample.tangent.z * sample.grade + sample.left.z * cross,
    },
  };
}
```

- [ ] **Étape 5 : `Track`**

Dans `src/game/track/track.ts` :
- `buildSamples` : ajouter `height: 0, grade: 0, bank: 0` à chaque échantillon renvoyé (la tâche 4
  branchera le profil).
- `interpolateSample` : interpoler linéairement les trois champs :

```ts
    height: a.height + (b.height - a.height) * t,
    grade: a.grade + (b.grade - a.grade) * t,
    bank: a.bank + (b.bank - a.bank) * t,
```

- ajouter la méthode (et l'import de `surfaceOf` et du type `TrackSurface`) :

```ts
  surfaceAt(s: number, lateral: number): TrackSurface {
    return surfaceOf(this.sampleAt(s), lateral);
  }
```

- [ ] **Étape 6 : `fake-track.ts`**

```ts
export interface CircleRelief {
  /** Altitude au départ (m). */
  height?: number;
  /** Pente constante dans le sens de la course (sans unité) ; l'altitude vaut height + grade · s. */
  grade?: number;
  /** Dévers constant (rad, > 0 = bord gauche plus bas). */
  bank?: number;
}

export function createCircleTrack(
  radius = 60,
  direction: TurnDirection = 'left',
  relief: CircleRelief = {},
): TrackQuery {
  const { height = 0, grade = 0, bank = 0 } = relief;
  // … code existant …
  // dans sampleAt, ajouter au retour : height: height + grade * s, grade, bank
  // …
  return {
    // … membres existants …
    surfaceAt: (s, lateral) => surfaceOf(sampleAt(s), lateral),
  };
}
```

(importer `surfaceOf` depuis `../track/surface`).

- [ ] **Étape 7 : corriger la compilation**

Lancer : `npx ng build` puis `npx ng test --watch=false`.
Toute construction littérale de `TrackSample` ou de `TrackQuery` dans les tests (rechercher
`curvature:` et `itemBoxRows:` dans `src/**/*.spec.ts`) reçoit `height: 0, grade: 0, bank: 0` ou
`surfaceAt`. Attendu : compilation OK, toute la suite verte (rien ne change à plat).

- [ ] **Étape 8 : mettre en forme et commiter**

```bash
npx prettier --write src/game/core/types.ts src/game/track/surface.ts src/game/track/surface.spec.ts src/game/track/track.ts src/game/testing/fake-track.ts src/game/testing/fake-track.spec.ts
git add -A src
git commit -m "Circuits : altitude, pente et dévers dans les échantillons, requête surfaceAt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 4 : passage au format JSON (loader, schéma, conversion des 4 circuits)

Tâche la plus longue : elle se termine sans aucun ancien format dans le code. L'ordre compte : la
conversion utilise encore l'ancien `Track` (spline) pour vérifier les nouveaux fichiers.

**Fichiers :**
- Créer : `src/game/track/circuit-loader.ts`, `src/game/track/circuit-loader.spec.ts`
- Créer : `src/game/track/circuit.schema.json`
- Créer : `src/game/track/circuits/grand-jardin.json`, `potager.json`, `parc-enneige.json`, `plage.json`
- Supprimer : `src/game/track/circuits/grand-jardin.ts`, `potager.ts`, `parc-enneige.ts`, `plage.ts`
- Modifier : `src/game/track/track-definition.ts`, `track.ts`, `catalog.ts`
- Modifier : `src/game/render/decor-plan.ts:8,192`
- Modifier les tests : `src/game/track/track.spec.ts`, `src/game/track/track-validator.spec.ts`
- Temporaires (créés puis supprimés dans la tâche) : `src/game/track/convert-circuits.tmp.spec.ts`,
  `src/game/track/compare-circuits.tmp.spec.ts`

**Interfaces :**
- Consomme : `buildCenterline`, `TrackCorner`, `CircuitError` (tâche 1), `buildProfile` (tâche 2).
- Produit :
  - `TrackDefinition` (nouvelle forme) : `{ id; name; description; theme; laps?; start: Vec2; corners: readonly TrackCorner[]; decor? }`
  - `parseCircuit(json: unknown): TrackDefinition` (lève `CircuitError` avec tous les problèmes)
  - `new Track(centerline: Centerline, profile?: Profile)` ; `createTrack(definition): Track` inchangé
  - `createGardenTrack()` inchangé (passe par le catalogue)
  - `TRACK_CATALOG`, `findTrack`, `isTrackId`, `DEFAULT_TRACK_ID` inchangés

- [ ] **Étape 1 : tests du loader (échec attendu)**

```ts
// src/game/track/circuit-loader.spec.ts
import { describe, expect, it } from 'vitest';
import { CircuitError } from './circuit-error';
import { parseCircuit } from './circuit-loader';

const VALID = {
  $schema: '../circuit.schema.json',
  id: 'test-ovale',
  name: 'Ovale',
  description: 'Un ovale de test.',
  theme: 'garden',
  start: { x: 0, z: -50 },
  corners: [
    { x: -100, z: -50, radius: 20, y: 0 },
    { x: -100, z: 50, radius: 20, y: 4, bank: 10 },
    { x: 100, z: 50, radius: 20 },
    { x: 100, z: -50, radius: 20, y: 0 },
  ],
  decor: { landmarks: [{ kind: 'gnome', x: 0, z: 0, radius: 2.8 }] },
};

const issuesOf = (json: unknown): string[] => {
  try {
    parseCircuit(json);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(CircuitError);
    return [...(error as CircuitError).issues];
  }
};

describe('parseCircuit', () => {
  it('accepte un circuit valide et ignore $schema', () => {
    const circuit = parseCircuit(VALID);
    expect(circuit.id).toBe('test-ovale');
    expect(circuit.corners[1]).toEqual({ x: -100, z: 50, radius: 20, y: 4, bank: 10 });
    expect('$schema' in circuit).toBe(false);
  });

  it('refuse un champ inconnu en nommant le champ et le coin (faute de frappe)', () => {
    const json = structuredClone(VALID);
    (json.corners[2] as Record<string, unknown>)['radious'] = 20;
    expect(issuesOf(json)).toContainEqual(expect.stringMatching(/Coin 3 .*« radious »/));
  });

  it('liste tous les problèmes d’un coup', () => {
    const issues = issuesOf({ ...VALID, id: 'Mauvais ID', theme: 'lune', start: { x: 'a', z: 0 } });
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('refuse un dévers sans rayon, un rayon négatif et des nombres non finis', () => {
    const json = structuredClone(VALID);
    json.corners[0] = { x: -100, z: -50, bank: 10 } as (typeof json.corners)[number];
    (json.corners[1] as Record<string, unknown>)['radius'] = -3;
    (json.corners[2] as Record<string, unknown>)['x'] = Number.NaN;
    const issues = issuesOf(json);
    expect(issues).toContainEqual(expect.stringMatching(/Coin 1 .*dévers/));
    expect(issues).toContainEqual(expect.stringMatching(/Coin 2 .*rayon/));
    expect(issues).toContainEqual(expect.stringMatching(/Coin 3 .*x/));
  });

  it('refuse une géométrie impossible avec le message de la ligne médiane', () => {
    const json = structuredClone(VALID);
    json.corners = json.corners.map((corner) => ({ ...corner, radius: 60 }));
    expect(issuesOf(json).join(' ')).toMatch(/rayons trop grands/);
  });

  it('préfixe le message de l’erreur par l’identifiant du circuit', () => {
    expect(() => parseCircuit({ ...VALID, theme: 'lune' })).toThrow(/test-ovale/);
  });
});
```

Lancer : `npx ng test --watch=false --include src/game/track/circuit-loader.spec.ts`
Attendu : ÉCHEC, module `./circuit-loader` introuvable.

- [ ] **Étape 2 : nouvelle forme de `TrackDefinition` et loader**

Dans `src/game/track/track-definition.ts`, garder `TrackThemeId`, `LandmarkHint`, `TrackDecorHints`,
remplacer le commentaire d'en-tête (il décrit désormais un fichier JSON : `circuits/<id>.json`, inscrit
dans `catalog.ts`) et remplacer `controlPoints` :

```ts
import type { Vec2 } from '../core/vec2';
import type { TrackCorner } from './centerline';

export const TRACK_THEMES = ['garden', 'snow', 'beach'] as const;
/** Thème de rendu : jardin d'été, parc enneigé, plage au couchant. */
export type TrackThemeId = (typeof TRACK_THEMES)[number];

export interface TrackDefinition {
  /** Identifiant stable (réglages mémorisés, adresses) : minuscules et tirets. */
  id: string;
  name: string;
  /** Une phrase pour l'écran de choix. */
  description: string;
  theme: TrackThemeId;
  /** Nombre de tours (RACE_LAPS par défaut). */
  laps?: number;
  /** Ligne de départ : sur la ligne droite qui va du dernier coin au premier. */
  start: Vec2;
  /** Polygone fermé, dans l'ordre de course (voir TrackCorner). */
  corners: readonly TrackCorner[];
  decor?: TrackDecorHints;
}
```

```ts
// src/game/track/circuit-loader.ts
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
const CIRCUIT_KEYS = ['$schema', 'id', 'name', 'description', 'theme', 'laps', 'start', 'corners', 'decor'];
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
  if (id && !ID_PATTERN.test(id)) issues.push(`« id » : minuscules, chiffres et tirets (« ${id} »).`);
  const name = text(json['name'], 'name', issues);
  const description = text(json['description'], 'description', issues);
  const theme = json['theme'];
  if (!TRACK_THEMES.includes(theme as TrackThemeId))
    issues.push(`« theme » : ${TRACK_THEMES.join(', ')} (reçu « ${String(theme)} »).`);
  const laps = json['laps'];
  if (laps !== undefined && !(Number.isInteger(laps) && (laps as number) >= 1 && (laps as number) <= 9))
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

function unknownKeys(value: Json, allowed: readonly string[], where: string, issues: string[]): void {
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
      if (!isFiniteNumber(raw[axis])) issues.push(`${where} : « ${axis} » doit être un nombre fini.`);
    const { radius, y, bank } = raw;
    if (radius !== undefined && !(isFiniteNumber(radius) && radius > 0))
      issues.push(`${where} : le rayon doit être un nombre > 0.`);
    if (y !== undefined && !isFiniteNumber(y)) issues.push(`${where} : « y » doit être un nombre fini.`);
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
        return [{ kind: raw['kind'] as string, x: raw['x'] as number, z: raw['z'] as number, radius: raw['radius'] as number }];
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
```

Relancer le test du loader : SUCCÈS attendu.

- [ ] **Étape 3 : schéma JSON pour l'éditeur**

Créer `src/game/track/circuit.schema.json` (autocomplétion et contrôle dans VS Code ; le contrôle qui
fait foi reste `parseCircuit`) :

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Circuit Super Wouf Kart",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "name", "description", "theme", "start", "corners"],
  "properties": {
    "$schema": { "type": "string" },
    "id": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$", "description": "Identifiant stable : minuscules et tirets." },
    "name": { "type": "string", "minLength": 1 },
    "description": { "type": "string", "minLength": 1, "description": "Une phrase pour l'écran de choix." },
    "theme": { "enum": ["garden", "snow", "beach"] },
    "laps": { "type": "integer", "minimum": 1, "maximum": 9 },
    "start": { "$ref": "#/$defs/point", "description": "Sur la ligne droite qui va du dernier coin au premier." },
    "corners": {
      "type": "array",
      "minItems": 3,
      "description": "Polygone fermé, dans l'ordre de course.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["x", "z"],
        "properties": {
          "x": { "type": "number" },
          "z": { "type": "number" },
          "radius": { "type": "number", "exclusiveMinimum": 0, "description": "Rayon de l'arc (m). Sans rayon : repère d'altitude sur une droite." },
          "y": { "type": "number", "description": "Altitude (m) au sommet de l'arc ou au repère." },
          "bank": { "type": "number", "minimum": 0, "maximum": 45, "description": "Dévers vers l'intérieur (degrés). Demande un rayon." }
        }
      }
    },
    "decor": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "landmarks": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["kind", "x", "z", "radius"],
            "properties": {
              "kind": { "type": "string" },
              "x": { "type": "number" },
              "z": { "type": "number" },
              "radius": { "type": "number", "exclusiveMinimum": 0 }
            }
          }
        },
        "path": {
          "type": "object",
          "additionalProperties": false,
          "required": ["from", "to"],
          "properties": { "from": { "$ref": "#/$defs/point" }, "to": { "$ref": "#/$defs/point" } }
        }
      }
    }
  },
  "$defs": {
    "point": {
      "type": "object",
      "additionalProperties": false,
      "required": ["x", "z"],
      "properties": { "x": { "type": "number" }, "z": { "type": "number" } }
    }
  }
}
```

Ajouter au test du loader un garde-fou de synchronisation :

```ts
import schema from './circuit.schema.json';

it('le schéma de l’éditeur connaît exactement les mêmes champs que le loader', () => {
  expect(Object.keys(schema.properties).sort()).toEqual(
    ['$schema', 'corners', 'decor', 'description', 'id', 'laps', 'name', 'start', 'theme'],
  );
  expect(Object.keys(schema.properties.corners.items.properties).sort()).toEqual(
    ['bank', 'radius', 'x', 'y', 'z'],
  );
});
```

- [ ] **Étape 4 : conversion des 4 circuits (script jetable)**

Les anciens circuits ont été construits en droites et arcs. On retrouve chaque coin comme
l'intersection des tangentes d'entrée et de sortie de chaque virage de l'ancien tracé, avec un rayon lu
sur le plateau de courbure. Créer `src/game/track/convert-circuits.tmp.spec.ts` (**à ne pas commiter**) :

```ts
// JETABLE : imprime les coins des anciens circuits. Supprimé à l'étape 7.
import { it } from 'vitest';
import { headingOf, wrapAngle, type Vec2 } from '../core/vec2';
import { TRACK_CATALOG } from './catalog';
import { createTrack } from './track';

const STRAIGHT = 1 / 300;
const round = (v: number, step: number) => Math.round(v / step) * step;
const cross = (a: Vec2, b: Vec2) => a.x * b.z - a.z * b.x;

function intersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 {
  const k = cross({ x: q.x - p.x, z: q.z - p.z }, e) / cross(d, e);
  return { x: p.x + d.x * k, z: p.z + d.z * k };
}

it('convertit les anciens circuits', () => {
  for (const definition of TRACK_CATALOG) {
    const track = createTrack(definition);
    const { samples } = track;
    const n = samples.length;
    // Virages : suites d'échantillons de même signe de courbure au-delà du seuil.
    type Run = { from: number; to: number };
    const runs: Run[] = [];
    let current: Run | null = null;
    for (let i = 0; i < n; i++) {
      const k = samples[i].curvature;
      const sign = Math.abs(k) < STRAIGHT ? 0 : Math.sign(k);
      const prevSign = current ? Math.sign(samples[current.from].curvature) : 0;
      if (sign !== 0 && current && sign === prevSign) current.to = i;
      else {
        if (current) runs.push(current);
        current = sign !== 0 ? { from: i, to: i } : null;
      }
    }
    if (current) runs.push(current);
    // Découpe des virages composés (deux plateaux de rayon) et des virages de plus de 120°.
    const pieces: Run[] = runs.flatMap((run) => {
      const len = run.to - run.from;
      const k1 = Math.abs(samples[run.from + Math.floor(len * 0.25)].curvature);
      const k2 = Math.abs(samples[run.from + Math.floor(len * 0.75)].curvature);
      const turn = Math.abs(
        wrapAngle(headingOf(samples[run.to].tangent) - headingOf(samples[run.from].tangent)),
      );
      let split = -1;
      if (Math.abs(k1 - k2) / Math.max(k1, k2) > 0.3) {
        const mid = (k1 + k2) / 2;
        for (let i = run.from + 1; i < run.to && split < 0; i++)
          if ((Math.abs(samples[i].curvature) - mid) * (k1 - mid) < 0) split = i;
      } else if (turn > (120 * Math.PI) / 180) split = run.from + Math.floor(len / 2);
      return split > 0 ? [{ from: run.from, to: split }, { from: split, to: run.to }] : [run];
    });
    const corners = pieces.map(({ from, to }) => {
      const a = samples[from];
      const b = samples[to];
      const corner = intersect(a.position, a.tangent, b.position, b.tangent);
      const middle = samples.slice(from + Math.floor((to - from) / 4), to - Math.floor((to - from) / 4));
      const curvatures = middle.map((s) => Math.abs(s.curvature)).sort((x, y) => x - y);
      const radius = 1 / curvatures[Math.floor(curvatures.length / 2)];
      return { x: round(corner.x, 0.1), z: round(corner.z, 0.1), radius: round(radius, 0.5) };
    });
    console.log(
      JSON.stringify({ id: definition.id, start: samples[0].position, corners }, null, 2),
    );
  }
});
```

Lancer : `npx ng test --watch=false --include src/game/track/convert-circuits.tmp.spec.ts`
Recopier chaque sortie dans `src/game/track/circuits/<id>.json`, avec `$schema`, `id`, `name`,
`description`, `theme`, `start` (le point 0 de l'ancien tracé, arrondi à 0,1 m) et `decor` repris tels
quels des anciens fichiers `.ts`. Aucune altitude ni aucun dévers : les 4 circuits restent plats. Placer
`$schema: "../circuit.schema.json"` en premier champ.

- [ ] **Étape 5 : vérifier la conversion (test temporaire)**

Créer `src/game/track/compare-circuits.tmp.spec.ts` (**à ne pas commiter**) :

```ts
// JETABLE : nouvelle ligne médiane à moins de 0,5 m de l'ancienne. Supprimé à l'étape 7.
import { describe, expect, it } from 'vitest';
import { TRACK_CATALOG } from './catalog';
import { buildCenterline } from './centerline';
import { parseCircuit } from './circuit-loader';
import grandJardin from './circuits/grand-jardin.json';
import parcEnneige from './circuits/parc-enneige.json';
import plage from './circuits/plage.json';
import potager from './circuits/potager.json';
import { createTrack } from './track';

const FILES: Record<string, unknown> = {
  'grand-jardin': grandJardin,
  'parc-enneige': parcEnneige,
  plage,
  potager,
};

describe('conversion des circuits', () => {
  it.each(TRACK_CATALOG.map((definition) => [definition.id, definition] as const))(
    '%s : nouveau tracé à moins de 0,5 m de l’ancien',
    (id, definition) => {
      const old = createTrack(definition);
      const circuit = parseCircuit(FILES[id]);
      const line = buildCenterline(circuit.start, circuit.corners);
      expect(Math.abs(line.length - old.length) / old.length).toBeLessThan(0.01);
      let worst = 0;
      let hint = 0;
      for (const p of line.points) {
        const projection = old.project(p, hint);
        hint = projection.index;
        worst = Math.max(worst, Math.abs(projection.lateral));
      }
      expect(worst).toBeLessThan(0.5);
    },
  );
});
```

Lancer : `npx ng test --watch=false --include src/game/track/compare-circuits.tmp.spec.ts`
Attendu : SUCCÈS pour les 4 circuits. Si un circuit dépasse 0,5 m : repérer le coin fautif (le point
le plus éloigné), corriger à la main ses coordonnées ou son rayon dans le JSON, relancer. Si
`parseCircuit` signale « rayons trop grands » de quelques centimètres entre deux virages qui se
touchent (chicane, virage composé : l'arrondi à 0,5 m du script), réduire l'un des deux rayons de
0,5 m. Ne pas passer à l'étape suivante tant que ce test n'est pas vert.

- [ ] **Étape 6 : basculer `Track`, `createTrack`, le catalogue et le décor**

`src/game/track/track.ts` :
- supprimer `evaluateSpline`, `catmullRom`, `knotInterval`, `mix` et les constantes `SPLINE_ALPHA`,
  `MIN_SUBDIVISIONS`, `SUBDIVISIONS_PER_METER` ; supprimer l'import de `GRAND_JARDIN` ;
- mettre à jour l'en-tête : ligne médiane exacte (droites et arcs) rééchantillonnée à ~1 m, s = 0 au
  départ ;
- nouveau constructeur, `buildSamples` qui lit le profil, `createTrack` et `createGardenTrack` :

```ts
  constructor(centerline: Centerline, profile: Profile = FLAT_PROFILE) {
    const { points, cumulative, length } = centerline;
    if (!(Number.isFinite(length) && length > 0) || points.length < 4)
      throw new Error('Circuit dégénéré : longueur nulle ou non finie');
    this.length = length;
    const count = Math.max(8, Math.round(this.length));
    this.step = this.length / count;
    this.samples = buildSamples([...points, points[0]], cumulative, count, this.step, profile);
    this.itemBoxRows = ITEM_ROW_FRACTIONS.map((fraction) =>
      this.findStraightNear(fraction * this.length),
    ).sort((a, b) => a - b);
  }
```

```ts
/** Circuit construit à partir de sa définition : ligne médiane et profil. */
export function createTrack(definition: TrackDefinition): Track {
  const centerline = buildCenterline(definition.start, definition.corners);
  return new Track(centerline, buildProfile(centerline, definition.corners));
}

/** Circuit par défaut du catalogue, le Grand Jardin (raccourci pour les tests). */
export function createGardenTrack(): Track {
  return createTrack(findTrack(DEFAULT_TRACK_ID));
}
```

Dans `buildSamples(points, cumulative, count, step, profile: Profile)`, remplacer
`height: 0, grade: 0, bank: 0` (tâche 3) par
`height: profile.heightAt(i * step), grade: profile.gradeAt(i * step), bank: profile.bankAt(i * step)`.

`src/game/track/catalog.ts` :

```ts
/**
 * Catalogue des circuits, dans l'ordre de l'écran de choix. Chaque circuit est un fichier JSON de
 * `circuits/`, contrôlé par parseCircuit au chargement (un fichier invalide fait échouer les tests).
 */
import { parseCircuit } from './circuit-loader';
import grandJardin from './circuits/grand-jardin.json';
import parcEnneige from './circuits/parc-enneige.json';
import plage from './circuits/plage.json';
import potager from './circuits/potager.json';
import type { TrackDefinition } from './track-definition';

export const TRACK_CATALOG: readonly TrackDefinition[] = [
  grandJardin,
  potager,
  parcEnneige,
  plage,
].map(parseCircuit);

export const DEFAULT_TRACK_ID = 'grand-jardin';

// isTrackId inchangé.

/** Circuit d'identifiant `id`, ou le circuit par défaut si l'identifiant est absent ou inconnu. */
export function findTrack(id: string | null | undefined): TrackDefinition {
  return (
    TRACK_CATALOG.find((track) => track.id === id) ??
    TRACK_CATALOG.find((track) => track.id === DEFAULT_TRACK_ID)!
  );
}
```

Si TypeScript refuse l'import par défaut des `.json`, ajouter l'attribut d'import
(`import grandJardin from './circuits/grand-jardin.json' with { type: 'json' };`) partout où un JSON
est importé, et relancer `npx ng build`.

`src/game/render/decor-plan.ts` : remplacer l'import de `GRAND_JARDIN` par
`import { DEFAULT_TRACK_ID, findTrack } from '../track/catalog';` et la valeur par défaut par
`hints: TrackDecorHints = findTrack(DEFAULT_TRACK_ID).decor ?? {},`.

Supprimer les 4 fichiers `src/game/track/circuits/*.ts`.

- [ ] **Étape 7 : adapter les tests existants et supprimer les temporaires**

Supprimer `convert-circuits.tmp.spec.ts` et `compare-circuits.tmp.spec.ts`.

`src/game/track/track.spec.ts` :
- remplacer `circlePoints` par un cercle exact fait de 4 coins qui se touchent :

```ts
/**
 * Cercle de rayon r centré à l'origine : carré de côté 2r aux coins de rayon r (les arcs se touchent),
 * départ en (0, −r), parcouru vers la gauche ou vers la droite.
 */
function circleTrack(r: number, direction: 'left' | 'right'): Track {
  const corners =
    direction === 'left'
      ? [
          { x: -r, z: -r, radius: r },
          { x: -r, z: r, radius: r },
          { x: r, z: r, radius: r },
          { x: r, z: -r, radius: r },
        ]
      : [
          { x: r, z: -r, radius: r },
          { x: r, z: r, radius: r },
          { x: -r, z: r, radius: r },
          { x: -r, z: -r, radius: r },
        ];
  return new Track(buildCenterline({ x: 0, z: -r }, corners));
}
```

  remplacer chaque `new Track(circlePoints(r, k, dir))` par `circleTrack(r, dir)` ;
- « refuse un tracé dégénéré » devient :
  `expect(() => new Track({ points: [], cumulative: [0], length: 0, cornerS: [], arcs: [] })).toThrow(/dégénéré/);`
- « refuse moins de 4 points de contrôle » est supprimé (couvert par `centerline.spec.ts`) ;
- « commence au point de contrôle 0 » devient « commence au point de départ » :
  `expect(distance(samples[0].position, findTrack('grand-jardin').start)).toBeLessThan(1e-3);`
  (supprimer l'import de `GARDEN_CONTROL_POINTS`).

`src/game/track/track-validator.spec.ts` : réécrire les tracés avec des coins.

```ts
/** Stade : deux droites de `straight` m, chaque bout est un demi-cercle de rayon `radius` (2 coins). */
function stadium(straight: number, radius: number): Track {
  const half = straight / 2;
  return new Track(
    buildCenterline({ x: 0, z: -radius }, [
      { x: half + radius, z: -radius, radius },
      { x: half + radius, z: radius, radius },
      { x: -half - radius, z: radius, radius },
      { x: -half - radius, z: -radius, radius },
    ]),
  );
}
```

  - `new Track(stadium(a, b))` devient `stadium(a, b)` ; « accepte le Grand Jardin » utilise
    `createGardenTrack()` ;
  - boucle en 8 (nœud papillon, total de virage nul) :

```ts
    const eight = new Track(
      buildCenterline({ x: 0, z: 0 }, [
        { x: -150, z: -60, radius: 40 },
        { x: -150, z: 60, radius: 40 },
        { x: 150, z: -60, radius: 40 },
        { x: 150, z: 60, radius: 40 },
      ]),
    );
    expect(rules(eight)).toContain('loop');
```

  - départ en virage (droites de 10 m seulement) :

```ts
    const rounded = new Track(
      buildCenterline({ x: 0, z: -50 }, [
        { x: 50, z: -50, radius: 45 },
        { x: 50, z: 50, radius: 45 },
        { x: -50, z: 50, radius: 45 },
        { x: -50, z: -50, radius: 45 },
      ]),
    );
    expect(rules(rounded)).toContain('straightBefore');
```

`src/game/track/catalog.spec.ts` : le test « définition sérialisable en JSON » reste valable tel quel.

- [ ] **Étape 8 : toute la suite**

Lancer : `npx ng build` puis `npx ng test --watch=false`.
Attendu : compilation OK, tout vert. En particulier `catalog.spec.ts` (validateur, course de 8 IA),
`track.spec.ts` (contraintes du Grand Jardin : épingle, chicane…), `themes.spec.ts`,
`keyboard-drift.spec.ts`. `grep -rn "controlPoints\|GARDEN_CONTROL_POINTS\|catmull" src` ne renvoie
plus rien.

- [ ] **Étape 9 : mettre en forme et commiter**

```bash
npx prettier --write src/game/track src/game/render/decor-plan.ts
git status   # vérifier : aucun fichier *.tmp.spec.ts
git add -A src
git commit -m "Circuits : format JSON (coins et rayons), loader et conversion des 4 circuits

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 5 : règles de relief du validateur

**Fichiers :**
- Modifier : `src/game/track/track-validator.ts`
- Test : `src/game/track/track-validator.spec.ts`

**Interfaces :**
- Consomme : `TrackSample.height/grade/bank` (tâche 3), `buildCenterline`, `buildProfile`, `Track`.
- Produit : `TRACK_RULES` + `maxGrade: 0.2`, `maxBank: 20` (°), `minHeight: 0`, `maxHeight: 25`,
  `startMaxGrade: 0.02`, `minCrestRadius: 40` ; `TrackIssue.rule` accepte ces clés.

- [ ] **Étape 1 : tests qui échouent**

Ajouter à `track-validator.spec.ts` (imports : `buildProfile`, `TrackCorner`) :

```ts
/** Stade 300 × 45 avec relief : `extra[i]` complète le coin i. */
function hillyStadium(extra: Partial<TrackCorner>[]): Track {
  const corners: TrackCorner[] = [
    { x: 195, z: -45, radius: 45 },
    { x: 195, z: 45, radius: 45 },
    { x: -195, z: 45, radius: 45 },
    { x: -195, z: -45, radius: 45 },
  ].map((corner, i) => ({ ...corner, ...extra[i] }));
  const line = buildCenterline({ x: 0, z: -45 }, corners);
  return new Track(line, buildProfile(line, corners));
}

it('accepte un relief raisonnable (montée de 6 m, dévers de 12°)', () => {
  expect(validateTrack(hillyStadium([{ y: 0 }, { y: 6, bank: 12 }, { y: 6, bank: 12 }, { y: 0 }]))).toEqual([]);
});

it('refuse une pente trop forte', () => {
  expect(rules(hillyStadium([{ y: 0 }, { y: 24 }, { y: 24 }, { y: 0 }]))).toContain('maxGrade');
});

it('refuse un dévers trop fort', () => {
  expect(rules(hillyStadium([{ y: 0 }, { y: 0, bank: 30 }]))).toContain('maxBank');
});

it('refuse une altitude hors de [0, 25] m', () => {
  expect(rules(hillyStadium([{ y: -2 }]))).toContain('minHeight');
  expect(rules(hillyStadium([{ y: 30 }]))).toContain('maxHeight');
});

it('refuse un départ en pente', () => {
  // Deux repères seulement (10 m et 0 m) : la ligne droite du départ est en pente d'environ 4 %.
  expect(rules(hillyStadium([{ y: 10 }, {}, {}, { y: 0 }]))).toContain('startMaxGrade');
});

it('refuse un sommet de côte trop vif', () => {
  // Repères serrés : 0 → 3 m → 0 sur 40 m de ligne droite.
  const corners: TrackCorner[] = [
    { x: 195, z: -45, radius: 45, y: 0 },
    { x: 195, z: 45, radius: 45, y: 0 },
    { x: 20, z: 45, y: 0 },
    { x: 0, z: 45, y: 3 },
    { x: -20, z: 45, y: 0 },
    { x: -195, z: 45, radius: 45, y: 0 },
    { x: -195, z: -45, radius: 45, y: 0 },
  ];
  const line = buildCenterline({ x: 0, z: -45 }, corners);
  expect(rules(new Track(line, buildProfile(line, corners)))).toContain('minCrestRadius');
});
```

Lancer : `npx ng test --watch=false --include src/game/track/track-validator.spec.ts`
Attendu : ÉCHEC sur les nouveaux tests (règles inconnues).

- [ ] **Étape 2 : règles**

Dans `TRACK_RULES`, ajouter :

```ts
  /** Pente maximale (0,2 = 20 %) : au-delà, la côte bloque et la descente jette dans les haies. */
  maxGrade: 0.2,
  /** Dévers maximal (degrés). */
  maxBank: 20,
  /** Altitude de la ligne médiane (m) : le sol de base est à 0, le brouillard cache au-delà de 25 m. */
  minHeight: 0,
  maxHeight: 25,
  /** Pente maximale autour du départ (sur straightBefore / straightAfter) : la grille est à plat. */
  startMaxGrade: 0.02,
  /** Rayon vertical minimal (m) d'un sommet de côte : pas de décollage tant que les sauts n'existent pas. */
  minCrestRadius: 40,
```

Dans `validateTrack`, avant les rangées de boîtes :

```ts
  const steepest = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.grade)), 0);
  if (steepest > R.maxGrade)
    issues.push({ rule: 'maxGrade', message: `Pente trop forte : ${Math.round(steepest * 100)} % > ${R.maxGrade * 100} %.` });

  const bankiest = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.bank)), 0);
  if (bankiest > (R.maxBank * Math.PI) / 180 + 1e-9)
    issues.push({ rule: 'maxBank', message: `Dévers trop fort : ${Math.round((bankiest * 180) / Math.PI)}° > ${R.maxBank}°.` });

  const lowest = Math.min(...samples.map((sample) => sample.height));
  const highest = Math.max(...samples.map((sample) => sample.height));
  if (lowest < R.minHeight - 1e-9)
    issues.push({ rule: 'minHeight', message: `Altitude trop basse : ${lowest.toFixed(1)} m < ${R.minHeight} m.` });
  if (highest > R.maxHeight + 1e-9)
    issues.push({ rule: 'maxHeight', message: `Altitude trop haute : ${highest.toFixed(1)} m > ${R.maxHeight} m.` });

  for (let s = -R.straightBefore; s <= R.straightAfter; s += 1) {
    const grade = track.sampleAt(s).grade;
    if (Math.abs(grade) > R.startMaxGrade) {
      issues.push({ rule: 'startMaxGrade', message: `Départ en pente (${Math.round(grade * 100)} % à ${s} m de la ligne).` });
      break;
    }
  }

  // Sommet de côte : la pente diminue ; rayon vertical = 1 / |dpente/ds|.
  let sharpestCrest = 0;
  for (let i = 0; i < n; i++) {
    const change = (samples[(i + 1) % n].grade - samples[(i - 1 + n) % n].grade) / (2 * step);
    if (change < 0) sharpestCrest = Math.max(sharpestCrest, -change);
  }
  if (sharpestCrest > 1 / R.minCrestRadius)
    issues.push({ rule: 'minCrestRadius', message: `Sommet de côte trop vif : rayon ${(1 / sharpestCrest).toFixed(0)} m < ${R.minCrestRadius} m.` });
```

(Au passage du tour, `grade` est continu : le profil est périodique.)

- [ ] **Étape 3 : relancer, puis toute la suite**

Lancer le fichier puis `npx ng test --watch=false`. Attendu : SUCCÈS ; les 4 circuits plats restent
valides. Si « sommet trop vif » n'est pas détecté, resserrer les repères du test (x = ±12) plutôt que
de toucher au seuil.

- [ ] **Étape 4 : commiter**

```bash
npx prettier --write src/game/track/track-validator.ts src/game/track/track-validator.spec.ts
git add src/game/track/track-validator.ts src/game/track/track-validator.spec.ts
git commit -m "Validateur : pente, dévers, altitude, départ à plat et sommets de côte

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 6 : physique du relief (pente, poids, dévers, hauteur du kart)

**Fichiers :**
- Modifier : `src/game/core/types.ts` (`KartState`)
- Modifier : `src/game/core/kart-state.ts` (`createKartState`)
- Modifier : `src/game/core/constants.ts` (`PHYSICS`)
- Modifier : `src/game/kart/kart-physics.ts` (`stepKart`, `stepSpeed`, `turnDelta`, `collideWithTrack`)
- Modifier : `src/game/race/race-setup.ts:40-43`
- Test : `src/game/kart/kart-physics.spec.ts`, `src/game/race/race-setup.spec.ts`

**Interfaces :**
- Consomme : `TrackQuery.surfaceAt`, `createCircleTrack(radius, direction, relief)` (tâche 3).
- Produit :
  - `KartState` + `height`, `prevHeight`, `pitch`, `prevPitch`, `roll`, `prevRoll` (m, rad ;
    tangage > 0 = nez en haut ; roulis > 0 = côté gauche plus bas)
  - `PHYSICS.slopeSpeedFactor`, `slopeGravity`, `slopeWeightInfluence`, `bankGrip`
  - `placeOnGround(kart: KartState, track: TrackQuery, s: number, lateral: number): void` (exportée)
  - `slopeWeightFactor(tuning: KartTuning): number` (exportée)

- [ ] **Étape 1 : tests qui échouent**

Ajouter à `kart-physics.spec.ts` (réutilise `kartOn`, `run`, `followLine`) :

```ts
const UPHILL = createCircleTrack(2000, 'left', { grade: 0.1 });
const DOWNHILL = createCircleTrack(2000, 'left', { grade: -0.1 });

describe('stepKart — relief', () => {
  it('suit la hauteur, le tangage et le roulis du sol', () => {
    const track = createCircleTrack(2000, 'left', { height: 5, grade: 0.1, bank: 0.2 });
    const kart = kartOn(track, 30, 2, 10);
    step(kart, {}, track);
    const expected = track.surfaceAt(track.project(kart.position, kart.trackIndex).s, kart.lateral);
    expect(kart.height).toBeCloseTo(expected.height, 3);
    expect(kart.pitch).toBeCloseTo(Math.atan(0.1), 2);
    expect(kart.roll).toBeCloseTo(0.2, 2);
    expect(kart.prevHeight).not.toBe(kart.height);
  });

  it('une côte abaisse la vitesse de croisière, une descente l’élève au-delà du max', () => {
    const cruise = (track: TrackQuery) => {
      const kart = kartOn(track, 0);
      run(kart, 12, (k) => ({ throttle: true, steer: followLine(k, track) }), { track });
      return kart.speed;
    };
    expect(cruise(UPHILL)).toBeLessThan(0.9 * TEST_TUNING.maxSpeed);
    expect(cruise(DOWNHILL)).toBeGreaterThan(1.05 * TEST_TUNING.maxSpeed);
  });

  it('le poids amplifie la pente : les lourds gagnent en descente, les légers en montée', () => {
    const heavy = tuningFromStats({ speed: 3, acceleration: 3, weight: 5, handling: 3 });
    const light = tuningFromStats({ speed: 3, acceleration: 3, weight: 1, handling: 3 });
    const cruise = (track: TrackQuery, tuning: KartTuning) => {
      const kart = kartOn(track, 0);
      run(kart, 12, (k) => ({ throttle: true, steer: followLine(k, track) }), { track, tuning });
      return kart.speed;
    };
    expect(cruise(DOWNHILL, heavy)).toBeGreaterThan(cruise(DOWNHILL, light));
    expect(cruise(UPHILL, light)).toBeGreaterThan(cruise(UPHILL, heavy));
  });

  it('arrêté sur une pente sans gaz, le kart ne part pas à la dérive', () => {
    const kart = kartOn(UPHILL, 0);
    run(kart, 5, {}, { track: UPHILL });
    expect(Math.abs(kart.speed)).toBeLessThan(0.05);
  });

  it('la pente se mesure dans le sens du cap : à contresens, une montée devient une descente', () => {
    const kart = kartOn(UPHILL, 400, 0, 0, Math.PI);
    run(kart, 6, { throttle: true }, { track: UPHILL });
    expect(kart.pitch).toBeLessThan(-0.05);
    expect(kart.speed).toBeGreaterThan(1.02 * TEST_TUNING.maxSpeed);
  });

  it('dans un virage relevé, tourner vers l’intérieur tourne plus, vers l’extérieur non', () => {
    const turned = (bank: number, steer: number) => {
      const track = createCircleTrack(2000, 'left', { bank });
      const kart = kartOn(track, 0, 0, 20);
      const start = kart.heading;
      run(kart, 0.5, { throttle: true, steer }, { track });
      return Math.abs(wrapAngle(kart.heading - start));
    };
    // Dévers > 0 : bord gauche plus bas ; steer < 0 = à gauche = vers l'intérieur.
    expect(turned(0.3, -1)).toBeGreaterThan(turned(0, -1) * 1.08);
    expect(turned(0.3, 1)).toBeCloseTo(turned(0, 1), 3);
  });
});
```

Ajouter à `race-setup.spec.ts` :

```ts
it('pose les karts sur la route, même quand le départ est en altitude', () => {
  const track = createCircleTrack(300, 'left', { height: 5 });
  const race = createRaceState(track, roster);
  for (const racer of race.racers) {
    expect(racer.kart.height).toBeCloseTo(5, 6);
    expect(racer.kart.prevHeight).toBeCloseTo(5, 6);
  }
});
```

(`roster` : réutiliser le roster déjà construit en tête du fichier ; importer `createCircleTrack`.)

Lancer : `npx ng test --watch=false --include src/game/kart/kart-physics.spec.ts`
Attendu : ÉCHEC (champs `height`/`pitch`/`roll` absents).

- [ ] **Étape 2 : état et constantes**

`KartState` (types.ts), après `lateral` :

```ts
  /** Hauteur du sol sous le kart (m). */
  height: number;
  /** Tangage (rad) : pente du sol dans le sens du cap, > 0 = nez en haut. */
  pitch: number;
  /** Roulis (rad) : > 0 = côté gauche du kart plus bas. */
  roll: number;
  /** Valeurs au début du dernier pas (interpolation du rendu). */
  prevHeight: number;
  prevPitch: number;
  prevRoll: number;
```

`createKartState` : `height: 0, pitch: 0, roll: 0, prevHeight: 0, prevPitch: 0, prevRoll: 0`.

`PHYSICS` (constants.ts), après `wallSpeedRetention` :

```ts
  /** Pente : part de la vitesse max perdue en montée, gagnée en descente, par unité de pente (0,1 = 10 %). */
  slopeSpeedFactor: 1.5,
  /** Pente : accélération (m/s²) par unité de pente, comme la gravité, gaz ou pas. */
  slopeGravity: 6,
  /** Poids : effet de la pente × (1 + ce facteur × écart de masse relatif à une race moyenne). */
  slopeWeightInfluence: 1.5,
  /** Virage relevé : braquage × (1 + ce facteur × dévers en rad) en tournant vers le côté bas. */
  bankGrip: 0.45,
```

- [ ] **Étape 3 : `kart-physics.ts`**

Constantes et fonctions exportées :

```ts
/** Bornes du facteur de vitesse max dû à la pente. */
const SLOPE_FACTOR_MIN = 0.55;
const SLOPE_FACTOR_MAX = 1.45;
/** Masse d'une race moyenne (3 points de poids). */
const REFERENCE_MASS = PHYSICS.massBase + PHYSICS.massPerPoint * 3;

/** Effet de la pente selon le poids : > 1 pour un chien plus lourd qu'une race moyenne. */
export function slopeWeightFactor(tuning: KartTuning): number {
  return 1 + (PHYSICS.slopeWeightInfluence * (tuning.mass - REFERENCE_MASS)) / REFERENCE_MASS;
}

/** Hauteur, tangage et roulis du kart d'après le sol de la piste en (s, lateral). */
export function placeOnGround(kart: KartState, track: TrackQuery, s: number, lateral: number): void {
  const { height, gradient } = track.surfaceAt(s, lateral);
  const sin = Math.sin(kart.heading);
  const cos = Math.cos(kart.heading);
  kart.height = height;
  // Avant = (sin θ, cos θ) ; gauche = (cos θ, −sin θ).
  kart.pitch = Math.atan(gradient.x * sin + gradient.z * cos);
  kart.roll = Math.atan(-(gradient.x * cos - gradient.z * sin));
}
```

`stepKart` : après `kart.prevHeading = kart.heading;` ajouter

```ts
  kart.prevHeight = kart.height;
  kart.prevPitch = kart.pitch;
  kart.prevRoll = kart.roll;
```

`stepSpeed` : la pente du pas précédent (tangage) module la vitesse max et accélère ou freine :

```ts
function stepSpeed(kart: KartState, input: DriverInput, tuning: KartTuning, dt: number): void {
  const boosting = kart.boostTime > 0;
  const slope = Math.tan(kart.pitch);
  const weight = slopeWeightFactor(tuning);
  const slopeFactor = clamp(1 - PHYSICS.slopeSpeedFactor * slope * weight, SLOPE_FACTOR_MIN, SLOPE_FACTOR_MAX);
  const maxSpeed =
    tuning.maxSpeed *
    (boosting ? kart.boostStrength : 1) *
    (kart.offroad && !boosting ? tuning.offroadFactor : 1) *
    slopeFactor;
  // … branches frein / gaz / roue libre inchangées …
  // La pente freine en montée et pousse en descente, gaz ou pas.
  kart.speed -= PHYSICS.slopeGravity * slope * weight * dt;
}
```

`turnDelta` : envelopper les deux `return` pour appliquer le bonus de dévers :

```ts
  // (dans turnDelta) calculer `delta` comme avant dans chacune des deux branches, puis :
  return delta * bankGripFactor(kart, Math.sign(delta));
```

```ts
/** Virage relevé : braquage majoré en tournant vers le côté bas (intérieur du virage). */
function bankGripFactor(kart: KartState, turnSign: number): number {
  // turnSign > 0 = virage à gauche (cap croissant) ; roll > 0 = côté gauche plus bas.
  return 1 + PHYSICS.bankGrip * Math.max(0, turnSign * kart.roll);
}
```

`collideWithTrack` : remonter `const limit = …` juste après le calcul de `kart.offroad`, puis poser le
kart au sol (latéral borné comme le fera le replacement contre la haie) :

```ts
  const limit = track.wallHalfWidth - KART_RADIUS;
  placeOnGround(kart, track, projection.s, clamp(projection.lateral, -limit, limit));
```

(supprimer l'ancienne déclaration de `limit` plus bas.)

- [ ] **Étape 4 : `race-setup.ts`**

Dans `createRacer`, après `kart.lateral = projection.lateral;` :

```ts
  placeOnGround(kart, track, projection.s, projection.lateral);
  kart.prevHeight = kart.height;
  kart.prevPitch = kart.pitch;
  kart.prevRoll = kart.roll;
```

(importer `placeOnGround` depuis `../kart/kart-physics`.)

- [ ] **Étape 5 : relancer puis toute la suite**

Lancer les deux fichiers de test, puis `npx ng test --watch=false`.
Attendu : SUCCÈS. Les tests existants à plat ne changent pas (pente nulle : facteur 1, gravité 0). Si
« descente au-delà du max » échoue de peu, augmenter `slopeSpeedFactor` (jamais baisser le seuil du
test) et relancer toute la suite, dont la course de 8 IA de `catalog.spec.ts`.

- [ ] **Étape 6 : commiter**

```bash
npx prettier --write src/game/core src/game/kart src/game/race/race-setup.ts src/game/race/race-setup.spec.ts
git add -A src
git commit -m "Physique : la pente change la vitesse (selon le poids), virages relevés plus adhérents

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 7 : hauteur des objets (boîtes, os, balles, boue)

**Fichiers :**
- Modifier : `src/game/core/types.ts` (`ItemEntity`, `ItemBoxState`)
- Modifier : `src/game/items/item-system.ts` (`createItemBoxes`, `spawnEntity`, `moveBone`, `moveBall`)
- Test : `src/game/items/item-system.spec.ts`

**Interfaces :**
- Consomme : `TrackQuery.surfaceAt`, `createCircleTrack(…, relief)`.
- Produit : `ItemEntity.height: number`, `ItemBoxState.height: number` (hauteur du sol, m).

- [ ] **Étape 1 : test qui échoue**

```ts
describe('objets — relief', () => {
  it('boîtes et objets lancés prennent la hauteur de la piste sous eux', () => {
    const track = createCircleTrack(2000, 'left', { height: 4, grade: 0.05 });
    const boxes = createItemBoxes(track);
    for (const box of boxes) {
      const projection = track.project(box.position);
      expect(box.height).toBeCloseTo(track.surfaceAt(projection.s, projection.lateral).height, 3);
    }
  });
});
```

Et, dans le même `describe`, un os lancé qui monte la pente (même montage que le test « os » existant,
qui utilise la fonction `placeOnTrack` du fichier) :

```ts
  it('un os lancé suit la hauteur de la piste en avançant', () => {
    const track = createCircleTrack(2000, 'left', { height: 4, grade: 0.05 });
    const race = createTestRace(track, 1);
    const [thrower] = race.racers;
    placeOnTrack(thrower, track, 100);
    thrower.item = 'bone';
    thrower.kart.speed = 20;
    const { emit } = recorder();
    useItem(race, thrower, track, false, emit);
    thrower.kart.position = { ...FAR_AWAY };
    for (let i = 0; i < 60; i++) stepItems(race, track, fixedRng(0.5), FIXED_DT, emit);
    const bone = race.items[0];
    const projection = track.project(bone.position);
    expect(bone.height).toBeCloseTo(track.surfaceAt(projection.s, projection.lateral).height, 3);
    expect(bone.height).toBeGreaterThan(4 + 0.05 * 100);
  });
```

Lancer : `npx ng test --watch=false --include src/game/items/item-system.spec.ts`
Attendu : ÉCHEC (`height` absent).

- [ ] **Étape 2 : code**

- `ItemEntity` et `ItemBoxState` : `/** Hauteur du sol sous l'objet (m). */ height: number;`
- `createItemBoxes` : `height: track.surfaceAt(s, offset).height,`
- `spawnEntity` : après `clampInsideWalls(…)`,
  `const height = track.surfaceAt(projection.s, projection.lateral).height;` et `height` dans l'objet.
- `moveBone` et `moveBall` : après la dernière projection de chaque fonction,
  `entity.height = track.surfaceAt(projection.s, projection.lateral).height;` (dans `moveBone`, avant
  le `if (side === 0) return;`).
- Les constructions littérales d'`ItemEntity` / `ItemBoxState` dans les tests reçoivent `height: 0`
  (suivre les erreurs de `npx ng build` et des tests).

- [ ] **Étape 3 : relancer puis toute la suite, commiter**

```bash
npx ng test --watch=false
npx prettier --write src/game/core/types.ts src/game/items
git add -A src
git commit -m "Objets : hauteur de la piste sous les boîtes et les objets lancés

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 8 : relief du sol autour de la piste (`terrain.ts`)

**Fichiers :**
- Créer : `src/game/render/terrain.ts`
- Créer : `src/game/testing/hilly-track.ts` (circuit vallonné partagé par les tests de rendu)
- Test : `src/game/render/terrain.spec.ts`

**Interfaces :**
- Consomme : `TrackQuery` (`samples` avec `height`/`grade`/`bank`, `project`, `surfaceAt`).
- Produit :
  - `interface Terrain { readonly hilly: boolean; heightAt(x: number, z: number): number; groundAt(x: number, z: number): number }`
    - `heightAt` : maillage du sol (sous la route entre les haies, de `UNDER_ROAD` m)
    - `groundAt` : ce sur quoi on pose un objet (surface exacte de la route entre les haies)
  - `createTerrain(track: TrackQuery): Terrain`, `FLAT_TERRAIN: Terrain`, `TERRAIN_FADE = 40`

- [ ] **Étape 1 : tests qui échouent**

```ts
// src/game/testing/hilly-track.ts
/** Stade vallonné pour les tests de rendu : montée de 8 m et deux virages relevés à 20°. */
import { buildCenterline, type TrackCorner } from '../track/centerline';
import { buildProfile } from '../track/profile';
import { Track } from '../track/track';

export function createHillyTrack(): Track {
  const corners: TrackCorner[] = [
    { x: 195, z: -45, radius: 45, y: 0 },
    { x: 195, z: 45, radius: 45, y: 8, bank: 20 },
    { x: -195, z: 45, radius: 45, y: 8, bank: 20 },
    { x: -195, z: -45, radius: 45, y: 0 },
  ];
  const line = buildCenterline({ x: 0, z: -45 }, corners);
  return new Track(line, buildProfile(line, corners));
}
```

```ts
// src/game/render/terrain.spec.ts
import { describe, expect, it } from 'vitest';
import { createCircleTrack } from '../testing/fake-track';
import { createHillyTrack as hilly } from '../testing/hilly-track';
import { createGardenTrack } from '../track/track';
import { FLAT_TERRAIN, TERRAIN_FADE, createTerrain } from './terrain';

describe('createTerrain', () => {
  it('circuit plat : aucun relief, hauteur nulle partout', () => {
    const terrain = createTerrain(createGardenTrack());
    expect(terrain.hilly).toBe(false);
    expect(terrain.heightAt(10, 20)).toBe(0);
    expect(FLAT_TERRAIN.groundAt(1, 2)).toBe(0);
  });

  it('sous la route, jamais au-dessus, même au bord intérieur d’un virage relevé', () => {
    const track = hilly();
    const terrain = createTerrain(track);
    expect(terrain.hilly).toBe(true);
    for (let s = 0; s < track.length; s += 3) {
      const sample = track.sampleAt(s);
      for (let lateral = -sample.halfWidth; lateral <= sample.halfWidth; lateral += 1) {
        const x = sample.position.x + sample.left.x * lateral;
        const z = sample.position.z + sample.left.z * lateral;
        const road = track.surfaceAt(s, lateral).height;
        expect(terrain.heightAt(x, z)).toBeLessThanOrEqual(road - 0.05);
        expect(terrain.groundAt(x, z)).toBeCloseTo(road, 1);
      }
    }
  });

  it('redescend au niveau 0 au-delà des haies + 40 m', () => {
    const track = hilly();
    const terrain = createTerrain(track);
    const sample = track.sampleAt(track.length / 2);
    const far = track.wallHalfWidth + TERRAIN_FADE + 2;
    const x = sample.position.x - sample.left.x * far;
    const z = sample.position.z - sample.left.z * far;
    expect(terrain.heightAt(x, z)).toBeCloseTo(0, 6);
  });

  it('varie sans saut au-delà des haies (pas de falaise)', () => {
    const track = hilly();
    const terrain = createTerrain(track);
    const sample = track.sampleAt(track.length / 2);
    let previous = terrain.heightAt(
      sample.position.x - sample.left.x * (track.wallHalfWidth + 0.5),
      sample.position.z - sample.left.z * (track.wallHalfWidth + 0.5),
    );
    for (let d = track.wallHalfWidth + 1; d < track.wallHalfWidth + TERRAIN_FADE; d += 1) {
      const h = terrain.heightAt(sample.position.x - sample.left.x * d, sample.position.z - sample.left.z * d);
      expect(Math.abs(h - previous)).toBeLessThan(1);
      previous = h;
    }
  });

  it('fonctionne avec n’importe quel TrackQuery', () => {
    const terrain = createTerrain(createCircleTrack(300, 'left', { height: 3 }));
    expect(terrain.groundAt(300, 0)).toBeCloseTo(3, 3);
  });
});
```

Lancer : `npx ng test --watch=false --include src/game/render/terrain.spec.ts`
Attendu : ÉCHEC, module `./terrain` introuvable.

- [ ] **Étape 2 : code**

```ts
// src/game/render/terrain.ts
/**
 * Relief du sol autour de la piste (rendu : sol, décor, haies, caméra, effets). Entre les haies : la
 * surface de la route (légèrement dessous pour le maillage du sol). Au-delà : un mélange des portions
 * de piste proches, pondéré par la distance, qui redescend au niveau 0 sur TERRAIN_FADE m.
 * Sans relief (circuit plat), tout vaut 0 et rien n'est calculé.
 */
import type { TrackQuery, TrackSample } from '../core/types';
import { clamp } from '../core/vec2';

export interface Terrain {
  /** Vrai si le circuit a de l'altitude ou du dévers. */
  readonly hilly: boolean;
  /** Hauteur du maillage du sol (sous la route entre les haies). */
  heightAt(x: number, z: number): number;
  /** Hauteur où poser un objet : surface de la route entre les haies, relief au-delà. */
  groundAt(x: number, z: number): number;
}

export const FLAT_TERRAIN: Terrain = { hilly: false, heightAt: () => 0, groundAt: () => 0 };

/** Distance (m) au-delà des haies sur laquelle le relief redescend au niveau 0. */
export const TERRAIN_FADE = 40;
/** Le maillage du sol reste sous la route de cet écart (m). */
const UNDER_ROAD = 0.08;
/** Taille des cellules de recherche des échantillons (m). */
const CELL = 12;

export function createTerrain(track: TrackQuery): Terrain {
  const hilly = track.samples.some((sample) => sample.height !== 0 || sample.bank !== 0);
  if (!hilly) return FLAT_TERRAIN;
  const wall = track.wallHalfWidth;
  const reach = wall + TERRAIN_FADE;
  const cells = new Map<string, TrackSample[]>();
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  for (const sample of track.samples) {
    const k = key(Math.floor(sample.position.x / CELL), Math.floor(sample.position.z / CELL));
    const list = cells.get(k);
    if (list) list.push(sample);
    else cells.set(k, [sample]);
  }
  let hint = 0;

  /** Hauteur hors de la route : mélange des plans des échantillons proches, fondu vers 0. */
  const around = (x: number, z: number): { height: number; nearest: number } => {
    const span = Math.ceil(reach / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let weights = 0;
    let sum = 0;
    let nearest = Infinity;
    for (let i = cx - span; i <= cx + span; i++) {
      for (let j = cz - span; j <= cz + span; j++) {
        for (const sample of cells.get(key(i, j)) ?? []) {
          const dx = x - sample.position.x;
          const dz = z - sample.position.z;
          const d = Math.hypot(dx, dz);
          if (d > reach) continue;
          nearest = Math.min(nearest, d);
          const lateral = clamp(dx * sample.left.x + dz * sample.left.z, -wall, wall);
          const along = dx * sample.tangent.x + dz * sample.tangent.z;
          const h = sample.height + sample.grade * along - lateral * Math.tan(sample.bank);
          const w = 1 / (d * d * d * d + 1e-3);
          weights += w;
          sum += w * h;
        }
      }
    }
    if (weights === 0) return { height: 0, nearest };
    const t = clamp(1 - (nearest - wall) / TERRAIN_FADE, 0, 1);
    const fade = t * t * (3 - 2 * t);
    return { height: (sum / weights) * fade, nearest };
  };

  const surface = (x: number, z: number): number | null => {
    const projection = track.project({ x, z }, hint);
    hint = projection.index;
    if (Math.abs(projection.lateral) > wall) return null;
    return track.surfaceAt(projection.s, projection.lateral).height;
  };

  const groundAt = (x: number, z: number): number => {
    const { height, nearest } = around(x, z);
    if (nearest > wall + 1) return height;
    return surface(x, z) ?? height;
  };
  return {
    hilly,
    groundAt,
    heightAt(x, z) {
      const { height, nearest } = around(x, z);
      if (nearest > wall + 1) return height;
      const road = surface(x, z);
      return road === null ? height : road - UNDER_ROAD;
    },
  };
}
```

- [ ] **Étape 3 : relancer, commiter**

Lancer le fichier de test : SUCCÈS attendu. Si « sous la route » échoue au bord intérieur, vérifier
que `heightAt` passe bien par `surface()` (projection exacte) dès que le point est à moins de
`wall + 1` m d'un échantillon.

```bash
npx prettier --write src/game/render/terrain.ts src/game/render/terrain.spec.ts src/game/testing/hilly-track.ts
git add src/game/render/terrain.ts src/game/render/terrain.spec.ts src/game/testing/hilly-track.ts
git commit -m "Rendu : relief du sol autour de la piste

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 9 : rendu de la piste, du sol et du décor en relief

**Fichiers :**
- Modifier : `src/game/render/scene-theme.ts` (`buildWorld` reçoit le relief)
- Modifier : `src/game/render/themes.ts:20`, `snow-park.ts:153`, `beach-world.ts:342`
- Modifier : `src/game/render/garden-world.ts` (`buildGardenWorld`, sol, `WorldContext`)
- Modifier : `src/game/render/track-surface.ts` (`ribbonGeometry`, `buildCurbs`, `placeAcross`,
  `buildStartLine`, `buildGridMarks`)
- Modifier : `src/game/render/hedges.ts`, `decor.ts`, `beach-world.ts`, `beach-animals.ts`,
  `snow-park.ts`
- Modifier : `src/game/render/race-scene.ts:56-67`
- Test : `src/game/render/garden-world.spec.ts`, `src/game/render/themes.spec.ts`

**Interfaces :**
- Consomme : `Terrain`, `createTerrain`, `FLAT_TERRAIN` (tâche 8), `TrackQuery.surfaceAt`.
- Produit :
  - `SceneTheme.buildWorld(track: TrackQuery, decor?: TrackDecorHints, terrain?: Terrain): ThemeWorld`
  - `buildGardenWorld(track, decorHints?, style = GARDEN_STYLE, terrain = createTerrain(track))`
  - `WorldContext` + `terrain: Terrain`
  - `buildHedges(track, bag, style = GARDEN_HEDGES, terrain = FLAT_TERRAIN)`
  - `buildDecor(plan, bag, colors = GARDEN_DECOR_COLORS, terrain = FLAT_TERRAIN)`
  - maillage du sol nommé `'terrain'` (présent seulement si `terrain.hilly`)

- [ ] **Étape 1 : tests qui échouent**

Dans `garden-world.spec.ts`, ajouter (imports : `createHillyTrack` depuis `../testing/hilly-track`,
`createTerrain` depuis `./terrain`) :

```ts
describe('monde en relief', () => {
  it('circuit plat : pas de maillage de relief, pelouse à 0 comme avant', () => {
    const world = buildGardenWorld(createGardenTrack());
    expect(world.root.getObjectByName('terrain')).toBeUndefined();
    expect(world.root.getObjectByName('lawn')!.position.y).toBe(0);
    world.dispose();
  });

  it('circuit vallonné : maillage de relief et route à la hauteur de la piste', () => {
    const track = createHillyTrack();
    const world = buildGardenWorld(track);
    const terrain = world.root.getObjectByName('terrain') as THREE.Mesh;
    expect(terrain).toBeDefined();
    const road = world.root.getObjectByName('road') as THREE.Mesh;
    const positions = road.geometry.getAttribute('position');
    let highest = -Infinity;
    for (let i = 0; i < positions.count; i++) highest = Math.max(highest, positions.getY(i));
    expect(highest).toBeGreaterThan(7);
    world.dispose();
  });

  it('le décor est posé sur le relief', () => {
    const track = createHillyTrack();
    const terrain = createTerrain(track);
    const world = buildGardenWorld(track, undefined, undefined, terrain);
    world.root.updateMatrixWorld(true);
    const doghouse = world.root.getObjectByName('doghouse');
    if (doghouse) {
      const p = doghouse.getWorldPosition(new THREE.Vector3());
      expect(p.y).toBeCloseTo(terrain.groundAt(p.x, p.z), 3);
    }
    world.dispose();
  });
});
```

(`'road'` et `'lawn'` sont les noms donnés dans `track-surface.ts:122` et `garden-world.ts:79`.)

Lancer : `npx ng test --watch=false --include src/game/render/garden-world.spec.ts`
Attendu : ÉCHEC sur les tests de relief.

- [ ] **Étape 2 : relief transmis au monde**

- `scene-theme.ts` : `buildWorld(track: TrackQuery, decor?: TrackDecorHints, terrain?: Terrain): ThemeWorld;`
- `themes.ts`, `snow-park.ts`, `beach-world.ts` : `buildWorld: (track, decor, terrain) => buildGardenWorld(track, decor, <STYLE>, terrain)`
  (sans troisième style pour le jardin : `buildGardenWorld(track, decor, GARDEN_STYLE, terrain)`).
- `race-scene.ts` : créer `const terrain = createTerrain(track);` en tête du constructeur (avant
  `new CameraRig`), le garder dans un champ privé `terrain` (utilisé en tâche 10), et appeler
  `theme.buildWorld(track, options.decor, terrain)`.
- `garden-world.ts` : paramètre `terrain: Terrain = createTerrain(track)` ; `WorldContext` gagne
  `terrain` ; passer `terrain` à `buildHedges(track, bag, style.hedges, terrain)`,
  `buildDecor(plan, bag, style.decor, terrain)` et `style.extras?.({ track, plan, bounds, bag, terrain })`.
  `buildTrackSurface` garde sa signature : il lit directement `track.surfaceAt`.

- [ ] **Étape 3 : sol**

Dans `garden-world.ts`, si `terrain.hilly` : pelouse abaissée à `LAWN_DROP = -0.5` et maillage de
relief qui couvre la piste et tout le décor, bord rabattu sur la pelouse :

```ts
/** Sous le maillage de relief, la pelouse lointaine est abaissée d'autant (m). */
const LAWN_DROP = -0.5;
/** Maille du relief (m) et marge autour de la piste et du décor. */
const TERRAIN_CELL = 4;
const TERRAIN_MARGIN = 20;

function buildTerrainMesh(
  area: Bounds,
  terrain: Terrain,
  colors: readonly [string, string],
  bag: DisposalBag,
): THREE.Mesh {
  const width = area.maxX - area.minX;
  const depth = area.maxZ - area.minZ;
  const segX = Math.ceil(width / TERRAIN_CELL);
  const segZ = Math.ceil(depth / TERRAIN_CELL);
  const geometry = bag.add(new THREE.PlaneGeometry(width, depth, segX, segZ).rotateX(-Math.PI / 2));
  const centerX = (area.minX + area.maxX) / 2;
  const centerZ = (area.minZ + area.maxZ) / 2;
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const col = i % (segX + 1);
    const row = Math.floor(i / (segX + 1));
    const border = col === 0 || row === 0 || col === segX || row === segZ;
    const x = positions.getX(i) + centerX;
    const z = positions.getZ(i) + centerZ;
    positions.setY(i, border ? LAWN_DROP : terrain.heightAt(x, z));
  }
  geometry.computeVertexNormals();
  const texture = bag.add(createLawnTexture(colors[0], colors[1]));
  texture.repeat.set(width / LAWN_TILE, depth / LAWN_TILE);
  const mesh = new THREE.Mesh(geometry, bag.add(new THREE.MeshStandardMaterial({ map: texture, roughness: 1 })));
  mesh.name = 'terrain';
  mesh.position.set(centerX, 0, centerZ);
  mesh.receiveShadow = true;
  return mesh;
}
```

Zone couverte : l'union de `trackBounds(track, track.wallHalfWidth + TERRAIN_FADE + TERRAIN_MARGIN)`, du
rectangle `plan.fence` élargi de `TERRAIN_MARGIN`, et de l'emprise de `plan.placements`
(`x ± radius`, `z ± radius`). Dans `buildGardenWorld` : `buildLawn(…)` puis, si `terrain.hilly`,
`lawn.position.y = LAWN_DROP` et ajouter `buildTerrainMesh(area, terrain, style.ground, bag)` à `root`.

- [ ] **Étape 4 : piste**

`track-surface.ts` :
- `ribbonGeometry` : pour chaque sommet, `const ground = track.surfaceAt(s, lateral);` puis
  `positions[v * 3 + 1] = ground.height + y;` et la normale depuis le gradient :

```ts
        const nx = -ground.gradient.x;
        const nz = -ground.gradient.z;
        const inv = 1 / Math.hypot(nx, 1, nz);
        normals[v * 3] = nx * inv;
        normals[v * 3 + 1] = inv;
        normals[v * 3 + 2] = nz * inv;
```

  (`s` : utiliser `sample.s` pour la hauteur, la variable `s` existante sert aux UV ; au dernier rang,
  `sample.s` vaut 0, ce qui referme la boucle.)
- `buildCurbs` : `position.set(mx, track.surfaceAt(sMilieu, lateral).height + ROAD_Y + CURB_HEIGHT / 2, mz)`
  avec l'abscisse et le latéral de la bordure (déjà connus dans la boucle ; sinon
  `track.project({ x: mx, z: mz })`).
- `placeAcross` : `object.position.set(sample.position.x, track.surfaceAt(s, 0).height, sample.position.z);`
- `buildStartLine` : `line.position.y += MARKING_Y;` (au lieu de `=`).
- `buildGridMarks` : hauteur `track.surfaceAt(track.project(p).s, track.project(p).lateral).height + MARKING_Y`
  pour le point `p` de la marque (calculer la projection une fois).

`hedges.ts` : paramètre `terrain: Terrain = FLAT_TERRAIN` ; `const ground = terrain.groundAt(point.x, point.z);`
puis `position.set(point.x, ground + y, point.z)` et la calotte à `ground + y + height * 0.62`.

- [ ] **Étape 5 : décor et extras**

`decor.ts` : paramètre `terrain: Terrain = FLAT_TERRAIN` de `buildDecor`, transmis aux fonctions
internes ; ajouter `terrain.groundAt(x, z)` à **chaque** hauteur posée (liste exhaustive d'après le
code actuel) :
- pièces uniques `mesh.position.set(placement.x, 0, placement.z)` (ligne ~302) ;
- arroseur `sprinkler.position.set(placement.x, 0, placement.z)` (~328) ;
- tiges de fleurs `position.set(flower.x, 0, flower.z)` (~235) ;
- balles `new THREE.Vector3(ball.x, ball.size * 0.93, ball.z)` (~267-274) ;
- arbres `matrixOf(tree.x, h * 0.68, tree.z, …)` (~363) et troncs `matrixOf(tree.x, 0, tree.z, …)` (~386-395) ;
- buissons `matrixOf(bush.x, r * 0.5, bush.z, …)` (~409) ;
- pierres de gué `matrixOf(stone.x, 0.03, stone.z, …)` (~457) ;
- sapins, étages (~537-550) et troncs (~559-568) ;
- clôture : piquets et lisses (~496-506), à la hauteur du sol de chaque piquet.

Vérifier avec `grep -n "position.set\|matrixOf(\|Vector3(" src/game/render/decor.ts` qu'aucun appel
n'a été oublié.

`beach-world.ts` : palmiers (`new THREE.Vector3(palm.x, 0, palm.z)` et la couronne à `h`), accessoires
de plage et crabes reçoivent `terrain.groundAt(x, z)` via `context.terrain` ; la mer, le sable mouillé
et l'écume restent à leur hauteur fixe. `beach-animals.ts` : les crabes ajoutent
`terrain.groundAt(x, z)` à leur hauteur à chaque mise à jour (passer `terrain` à `buildCrabs`) ; les
mouettes ajoutent une fois `terrain.groundAt(centre)`. `snow-park.ts` : la boîte de neige suit la
caméra en hauteur : `positions[i * 3 + 1] = focus.y - SNOW_HEIGHT / 3 + wrap(…, SNOW_HEIGHT)`.

- [ ] **Étape 6 : relancer puis toute la suite**

Lancer `garden-world.spec.ts`, `themes.spec.ts`, puis `npx ng test --watch=false`.
Attendu : SUCCÈS ; les circuits plats donnent exactement le même monde (le test « pas de maillage de
relief » le garantit).

- [ ] **Étape 7 : commiter**

```bash
npx prettier --write src/game/render src/game/testing
git add -A src
git commit -m "Rendu : piste, haies, sol et décor suivent le relief

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 10 : rendu des karts, de la caméra, des effets et des objets en relief

**Fichiers :**
- Modifier : `src/game/render/racer-visuals.ts:38-51,106,121-146`
- Modifier : `src/game/render/camera-rig.ts` (`CameraTarget`, constructeur, `update`)
- Modifier : `src/game/render/lighting.ts` (`follow`)
- Modifier : `src/game/render/race-scene.ts` (cible de caméra, lumière, effets)
- Modifier : `src/game/render/effects.ts`, `skid-marks.ts`, `particles.ts`
- Modifier : `src/game/render/item-visuals.ts:192-245`
- Test : `racer-visuals.spec.ts`, `camera-rig.spec.ts`, `skid-marks.spec.ts`, `particles.spec.ts`

**Interfaces :**
- Consomme : `KartState.height/pitch/roll` et `prev*` (tâche 6), `ItemEntity.height`,
  `ItemBoxState.height` (tâche 7), `Terrain` (tâche 8), `RaceScene.terrain` (tâche 9).
- Produit :
  - `CameraTarget` + `y?: number` (0 par défaut : les tests existants restent valables) ;
    `new CameraRig(camera, reducedMotion, groundAt?: (x: number, z: number) => number)`
  - `SceneLighting.follow(x: number, z: number, y = 0)`
  - `SkidMarks.add(x0, z0, x1, z1, y0 = 0, y1 = y0)`
  - `ParticleOptions.floor?: number` (plancher de la particule, 0,03 par défaut)
  - `new Effects(racers, bag, track, terrain = FLAT_TERRAIN)`

- [ ] **Étape 1 : tests qui échouent**

`racer-visuals.spec.ts` :

```ts
it('pose le kart à sa hauteur interpolée, nez relevé en montée, penché à gauche si roll > 0', () => {
  const { racers, race } = setup();
  const racer = race.racers[0];
  Object.assign(racer.kart, {
    prevHeight: 2,
    height: 4,
    prevPitch: 0.2,
    pitch: 0.2,
    prevRoll: 0.15,
    roll: 0.15,
    visualYaw: 0,
  });
  racers.update(race, 0.5, DT);
  const root = racers.get(racer.id)!.model.root;
  expect(root.position.y).toBeCloseTo(3, 6);
  root.updateMatrixWorld(true);
  const nose = new THREE.Vector3(0, 0, 1).applyMatrix4(root.matrixWorld);
  const leftSide = new THREE.Vector3(1, 0, 0).applyMatrix4(root.matrixWorld);
  expect(nose.y).toBeGreaterThan(root.position.y + 0.1);
  expect(leftSide.y).toBeLessThan(root.position.y - 0.05);
});
```

`camera-rig.spec.ts` (réutilise la fabrique `rig()` du fichier pour le cas sans sol) :

```ts
it('suit la hauteur du kart et ne descend jamais sous le sol', () => {
  const target: CameraTarget = { x: 0, z: 0, heading: 0, boosting: false, y: 10 };
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 2000);
  new CameraRig(camera, true, () => 20).update(target, 'racing', 0, DT);
  expect(camera.position.y).toBeGreaterThanOrEqual(21.2 - 1e-9);
  const { rig: flat, camera: free } = rig(true);
  flat.update(target, 'racing', 0, DT);
  expect(free.position.y).toBeCloseTo(10 + CHASE.height, 6);
});
```

`skid-marks.spec.ts` : `marks.add(0, 0, 1, 0, 2, 2)` pose des sommets à `y ≈ 2 + MARK_Y`.
`particles.spec.ts` : une particule émise avec `{ gravity: -20, floor: 3 }` à y = 4 ne descend jamais
sous 3.

Lancer ces quatre fichiers : ÉCHEC attendu.

- [ ] **Étape 2 : karts**

`racer-visuals.ts` : commentaire de `position` → « Position interpolée du kart (y = hauteur du sol) ».
Dans `add()` : `new THREE.Vector3(racer.kart.position.x, racer.kart.height, racer.kart.position.z)`.
Dans `update()` :

```ts
        visual.position.set(
          kart.prevPosition.x + (kart.position.x - kart.prevPosition.x) * alpha,
          kart.prevHeight + (kart.height - kart.prevHeight) * alpha,
          kart.prevPosition.z + (kart.position.z - kart.prevPosition.z) * alpha,
        );
        // …
        root.position.copy(visual.position);
        // Lacet, puis tangage autour de l'axe latéral, puis roulis autour de l'axe avant.
        root.rotation.order = 'YXZ';
        const pitch = kart.prevPitch + (kart.pitch - kart.prevPitch) * alpha;
        const roll = kart.prevRoll + (kart.roll - kart.prevRoll) * alpha;
        root.rotation.set(-pitch, visual.heading + kart.visualYaw, -roll);
```

- [ ] **Étape 3 : caméra et lumière**

`camera-rig.ts` :
- `CameraTarget` : `/** Hauteur du sol sous le kart (m, 0 par défaut). */ y?: number;`
- constructeur : troisième paramètre `private readonly groundAt: (x: number, z: number) => number = () => -Infinity`,
  champ `private groundY = 0` ;
- dans `update`, `const y = target.y ?? 0;` ; la validité de la cible teste aussi
  `Number.isFinite(y)` ; à l'initialisation `this.groundY = y;` sinon
  `this.groundY = smoothTowards(this.groundY, y, CAMERA_Y_RATE, dt);` avec
  `const CAMERA_Y_RATE = 6;` et `const CAMERA_CLEARANCE = 1.2;` ;
- positions :

```ts
      camera.position.set(
        target.x + Math.sin(angle) * distance,
        this.groundY + height,
        target.z + Math.cos(angle) * distance,
      );
      // En descente, la caméra (derrière, donc plus haut sur la pente) reste au-dessus du sol.
      camera.position.y = Math.max(
        camera.position.y,
        this.groundAt(camera.position.x, camera.position.z) + CAMERA_CLEARANCE,
      );
      this.lookTarget.set(target.x + forwardX * lookAhead, this.groundY + CHASE.lookHeight, target.z + forwardZ * lookAhead);
```

`lighting.ts` : `follow(x: number, z: number, y = 0)`, en ajoutant `y * this.right.y`, `y * this.up.y`
et `y * this.sunDirection.y` aux trois produits scalaires `a`, `b`, `c` (à y = 0 rien ne change).

`race-scene.ts` : `new CameraRig(this.camera, options.reducedMotion, (x, z) => terrain.groundAt(x, z))`
(le relief est créé avant, tâche 9) ; `this.target.y = visual.position.y;` ;
`this.lighting.follow(visual.position.x, visual.position.z, visual.position.y);` ;
`new Effects(racerVisuals, this.bag, track, terrain)`. Le champ `target` initial gagne `y: 0`.

- [ ] **Étape 4 : effets**

- `particles.ts` : `ParticleOptions.floor?: number` (« plancher de la particule, m ; 0,03 par défaut ») ;
  tableau `floor = new Float32Array(capacity)` rempli à l'émission (`options.floor ?? 0.03`) ; dans
  `update`, `Math.max(this.floor[i], …)` au lieu de `Math.max(0.03, …)`.
- `skid-marks.ts` : `add(x0, z0, x1, z1, y0 = 0, y1 = y0)` ; `setVertex(v, x, z, y)` écrit
  `MARK_Y + y` ; les six appels passent `y0` pour les sommets en `x0/z0` et `y1` pour ceux en `x1/z1`.
- `effects.ts` : paramètre `terrain: Terrain = FLAT_TERRAIN` ; `const ground = (x: number, z: number) => this.terrain.groundAt(x, z);`
  - `emitSmoke` : y d'émission `ground(p.x, p.z) + 0.15`, options avec `floor: ground(p.x, p.z) + 0.03` ;
  - `emitDust` : idem avec `+ 0.2` ;
  - `emitWheelGlow` : `Math.max(ground(p.x, p.z) + 0.08, this.point.y - 0.18)` ;
  - `traceSkids` : mémoriser aussi la hauteur (le tableau `last` passe à 3 valeurs par roue :
    `x, z, y` ; adapter sa création) et appeler `this.skids.add(lastX, lastZ, x, z, lastY, y)` avec
    `y = ground(x, z)` ;
  - vérifier avec `grep -n "emit(" src/game/render/effects.ts` les autres émissions à hauteur fixe
    (étincelles de choc, gerbes d'objets) et leur ajouter `ground(x, z)`.

- [ ] **Étape 5 : objets**

`item-visuals.ts` : `visual.root.position.set(box.position.x, box.height, box.position.z);` et, pour
les entités, `object.position.set(x, 0, z)` puis `object.position.y = entity.height + <hauteur actuelle>`
dans chaque branche (`BONE_HEIGHT`, rebond de la balle, `MUD_Y`).

- [ ] **Étape 6 : relancer puis toute la suite**

Lancer les quatre fichiers de test de l'étape 1, puis `npx ng test --watch=false`.
Attendu : SUCCÈS ; les tests existants à plat ne changent pas (hauteur 0, tangage et roulis nuls).

- [ ] **Étape 7 : commiter**

```bash
npx prettier --write src/game/render
git add -A src
git commit -m "Rendu : karts, caméra, effets et objets à la hauteur du relief

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 11 : circuit de démonstration « La Colline »

**Fichiers :**
- Créer : `src/game/track/circuits/colline.json`
- Modifier : `src/game/track/catalog.ts`
- Test : `src/game/track/catalog.spec.ts`

**Interfaces :**
- Consomme : tout ce qui précède.
- Produit : `TRACK_CATALOG` avec 5 circuits, « La Colline » en dernier.

- [ ] **Étape 1 : test qui échoue**

Dans `catalog.spec.ts` :

```ts
it('La Colline a du vrai relief : au moins 10 m de dénivelé et des virages relevés', () => {
  const track = createTrack(findTrack('colline'));
  const heights = track.samples.map((sample) => sample.height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThanOrEqual(10);
  expect(track.samples.some((sample) => Math.abs(sample.bank) > 0.15)).toBe(true);
});
```

Lancer : `npx ng test --watch=false --include src/game/track/catalog.spec.ts` → ÉCHEC (circuit
inconnu, `findTrack` renvoie le Grand Jardin, plat).

- [ ] **Étape 2 : le circuit**

```json
{
  "$schema": "../circuit.schema.json",
  "id": "colline",
  "name": "La Colline",
  "description": "Une longue montée vers la niche, un faux plat au sommet, puis la grande descente.",
  "theme": "garden",
  "start": { "x": 0, "z": -80 },
  "corners": [
    { "x": -120, "z": -80, "radius": 30, "y": 0 },
    { "x": -120, "z": 0, "y": 8 },
    { "x": -120, "z": 60, "radius": 25, "y": 12, "bank": 10 },
    { "x": 0, "z": 60, "y": 12 },
    { "x": 120, "z": 60, "radius": 30, "y": 6, "bank": 12 },
    { "x": 120, "z": -80, "radius": 30, "y": 0 }
  ],
  "decor": {
    "landmarks": [
      { "kind": "doghouse", "x": -60, "z": 25, "radius": 5.5 },
      { "kind": "kibble-bowl", "x": 60, "z": -20, "radius": 4.4 },
      { "kind": "watering-can", "x": -165, "z": -20, "radius": 6.2 },
      { "kind": "gnome", "x": 0, "z": 100, "radius": 2.8 }
    ]
  }
}
```

Ajouter `import colline from './circuits/colline.json';` et `colline` en fin de liste dans
`TRACK_CATALOG`.

- [ ] **Étape 3 : relancer les tests du catalogue et des thèmes**

Lancer `catalog.spec.ts`, `themes.spec.ts`, `keyboard-drift.spec.ts`, `circuit-select.spec.ts`.
Attendu : SUCCÈS. Si le validateur signale un problème (message en français), corriger le JSON :
- pente > 20 % : éloigner le repère `{ x: -120, z: 0 }` vers z = 10, ou baisser son `y` ;
- sommet trop vif : éloigner les repères d'altitude ;
- rangées de boîtes : allonger les droites.

Si la course de 8 IA échoue (sortie de piste en descente, tour > 70 s) : d'abord vérifier avec un
`console.log` temporaire où les IA sortent ; ajouter alors dans `ai-controller.ts` une anticipation :
`cornerSpeed` multiplié par `clamp(1 + 1.5 * Math.tan(kart.pitch), 0.7, 1)` en descente (tangage < 0).
Relancer toute la suite ensuite.

- [ ] **Étape 4 : commiter**

```bash
npx prettier --write src/game/track
git add -A src
git commit -m "Nouveau circuit « La Colline » : montée, faux plat, descente et virages relevés

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Tâche 12 : documentation, version et journal

**Fichiers :**
- Modifier : `docs/circuits.md` (réécriture)
- Modifier : `docs/superpowers/specs/2026-09-27-format-circuits-relief-design.md` (écarts)
- Modifier : `package.json`, `package-lock.json` (via `npm run release:minor`)
- Modifier : `CHANGELOG.md`

- [ ] **Étape 1 : `docs/circuits.md`**

Réécrire en gardant l'esprit actuel (tableau « appli de gestion », recette, règles, thèmes) :
- le tableau d'équivalences pointe vers `circuits/*.json`, `circuit-loader.ts`, `circuit.schema.json` ;
- « Ajouter un circuit » : copier `colline.json`, dessiner le polygone sur papier quadrillé (x vers la
  droite, z vers le bas de la mini-carte), un rayon par coin, deux coins pour un virage de plus de
  150°, `start` sur la droite du dernier au premier coin, `y` sur les coins et les repères, `bank` sur
  les virages ; inscrire le fichier dans `catalog.ts` ; `npm test` ;
- les messages du loader et du validateur, avec deux exemples ;
- les règles, anciennes et nouvelles (valeurs de `TRACK_RULES`) ;
- une section « Relief » : effet de la pente (montée, descente, poids), virages relevés, sol autour.

- [ ] **Étape 2 : écarts à la spec**

Dans la spec, corriger : le type garde le nom `TrackDefinition` ; la masse de référence est celle
d'une race à 3 points de poids ; le sol en relief est un maillage séparé (pelouse lointaine abaissée
à −0,5 m), absent sur un circuit plat ; la pente modifie aussi la vitesse max (`slopeSpeedFactor`) en
plus de la gravité ; le test de budget de meshes cité n'existe pas pour la scène (le test « pas de
maillage de relief à plat » le remplace).

- [ ] **Étape 3 : version et journal**

```bash
git show main:package.json | grep '"version"'   # doit afficher 0.4.1 ; sinon partir de cette version
npm run release:minor
```

En tête de `CHANGELOG.md`, sous le titre et la phrase d'introduction :

```markdown
## [0.5.0] – JJ/MM/AAAA

- Ajout : circuits décrits en fichiers JSON (coins, rayons, altitude, dévers).
- Ajout : relief : côtes, descentes et virages relevés, qui changent la vitesse.
- Ajout : circuit La Colline.
```

(date du jour ; le lien de MR s'ajoute à l'ouverture de la PR, comme les entrées précédentes.)

- [ ] **Étape 4 : vérification finale**

```bash
npx ng build
npx ng test --watch=false
grep -rn "controlPoints\|GARDEN_CONTROL_POINTS" src docs/circuits.md   # aucun résultat
```

- [ ] **Étape 5 : commiter**

```bash
git add docs CHANGELOG.md package.json package-lock.json
git commit -m "Documentation des circuits JSON et du relief (v0.5.0)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
