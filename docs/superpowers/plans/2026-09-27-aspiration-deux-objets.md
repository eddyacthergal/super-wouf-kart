# Aspiration, deux emplacements et quatre nouveaux cadeaux — plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (recommandé) ou
> superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** turbo d'aspiration derrière un concurrent, deux objets en file d'attente, et quatre
nouveaux cadeaux (écureuil, os en or, sifflet, super-collier).

**Architecture :** l'inventaire devient une liste (`RacerState.items`) ; l'aspiration est un module de
course (`race/slipstream.ts`) appelé à chaque pas ; chaque nouveau cadeau est une tranche verticale
(type, tirage, effet dans `item-system.ts`, physique si besoin, IA, icône, nom, rendu, son).

**Pile :** Angular 22, TypeScript 6 strict, three.js, Vitest via `@angular/build:unit-test`.

**Spec :** `docs/superpowers/specs/2026-09-27-aspiration-deux-objets-design.md`

## Contraintes globales

- Code, commentaires, messages et libellés en français, dans le style du code existant.
- Aucune nouvelle dépendance npm. Mise en forme : `npx prettier --write <fichiers>`.
- Un fichier de test : `npx ng test --watch=false --include <chemin>` ; toute la suite :
  `npx ng test --watch=false` ; compilation : `npx ng build`.
- La course de 8 IA de `src/game/track/catalog.spec.ts` doit rester verte après chaque tâche (tout
  le monde finit, 20 à 70 s au tour, jamais au-delà des haies), ainsi que `keyboard-drift.spec.ts`.
- Accessibilité du HUD (CLAUDE.md) : contraste AA sur le panneau sombre, libellés `aria-label`.
- Aspiration : 3 à 14 m, cône ±12°, ≥ 60 % de `tuning.maxSpeed`, jauge pleine en 1,2 s, vidange
  2× plus rapide, turbo 1,0 s ×1,2.
- File : 2 objets au plus ; « Objet » utilise le premier (sauf s'il est seul et en roulette).
- Os en or 7 s, turbo 1,0 s ×1,3 par appui ; sifflet : arrêt 1 s (décélération 30 m/s²) des pilotes
  mieux classés ; super-collier 6 s, vitesse max ×1,15 ; écureuil 90 m/s par le plus court chemin
  le long du circuit (vers l'avant ou vers l'arrière), tête-à-queue 1,5 s, vie 20 s, jamais tiré par
  les rangs 1 à 3.
- Poids de tirage (fractions 0 / 0,5 / 1) : os 40/25/10, flaque 40/15/5, balle 5/20/20,
  croquette 10/20/15, os en or 0/10/15, sifflet 0/3/8, super-collier 0/5/12, écureuil 0/2/10.
- Branche `feature/aspiration-objets` (créée, la spec y est commitée) ; commits en français.
- Version : un seul `npm run release:minor` (0.6.0 → 0.7.0) et une entrée au `CHANGELOG.md`, en
  tâche 9 seulement.

## Points de vigilance

1. Un kart qui arrive **en face** (contresens) dans le cône ne doit pas donner d'aspiration : il faut
   que l'autre roule dans le même sens. → test en tâche 3.
2. Le sifflet utilisé par le **premier** n'arrête personne, et l'objet est consommé. → tâche 6.
3. Deux porteurs de super-collier qui se percutent : simple choc, aucun tête-à-queue. → tâche 7.
4. L'écureuil dont la cible franchit l'arrivée : il change de cible (nouveau premier) ou disparaît
   s'il n'y en a plus. → tâche 8.
5. Os en or actif + un objet en réserve : une boîte ne donne pas de troisième objet. → tâche 5.

---

### Tâche 1 : inventaire à deux emplacements (simulation et IA)

**Fichiers :**
- Modifier : `src/game/core/types.ts` (`RacerState`), `src/game/core/constants.ts` (`ITEMS`)
- Modifier : `src/game/items/item-system.ts` (`useItem`, `updateRacerTimers`, `updateBoxes`, nouvel
  export `usableItem`)
- Modifier : `src/game/race/race-setup.ts` (`createRacer`), `src/game/testing/fixtures.ts`
- Modifier : `src/game/ai/ai-controller.ts` (`updateItems`, frein de l'os)
- Modifier : `src/game/hud.ts` (compatibilité, en attendant la tâche 2)
- Tests : `item-system.spec.ts`, `ai-controller.spec.ts`, `simulation.spec.ts`, `race-setup.spec.ts`,
  `hud.spec.ts`

**Interfaces :**
- Produit : `RacerState.items: ItemKind[]` (remplace `item`), `ITEMS.maxHeld = 2`,
  `usableItem(racer: RacerState): ItemKind | null` (exporté par `item-system.ts`).

- [ ] **Étape 1 : tests qui échouent** (dans `item-system.spec.ts`, `describe('boîtes et roulette')`)

```ts
  it('ramasse un second objet, jamais un troisième, dans l’ordre', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const [racer] = race.racers;
    race.itemBoxes = [{ id: 0, position: clone(racer.kart.position), respawn: 0, height: 0 }];
    racer.items = ['mud'];
    const { events, emit } = recorder();
    stepItems(race, track, fixedRng(0), FIXED_DT, emit);
    expect(racer.items).toEqual(['mud', 'bone']);
    expect(racer.itemRoulette).toBe(ITEMS.rouletteDuration);
    expect(events).toContainEqual({ type: 'item-box', racerId: racer.id });

    race.itemBoxes[0].respawn = 0;
    racer.itemRoulette = 0;
    stepItems(race, track, fixedRng(0), FIXED_DT, emit);
    expect(racer.items).toEqual(['mud', 'bone']);
    expect(race.itemBoxes[0].respawn).toBe(ITEMS.boxRespawn);
  });

  it('utilise le premier objet pendant la roulette du second, puis le second avance', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const [racer] = race.racers;
    placeOnTrack(racer, track, 100);
    racer.items = ['kibble-turbo', 'bone'];
    racer.itemRoulette = 0.5;
    const { events, emit } = recorder();
    useItem(race, racer, track, false, emit);
    expect(events).toContainEqual({ type: 'item-use', racerId: racer.id, item: 'kibble-turbo' });
    expect(racer.items).toEqual(['bone']);
    // Seul et encore en roulette : inutilisable.
    useItem(race, racer, track, false, emit);
    expect(racer.items).toEqual(['bone']);
    racer.itemRoulette = 0;
    useItem(race, racer, track, false, emit);
    expect(racer.items).toEqual([]);
  });

  it('usableItem : le premier objet, sauf s’il est seul et en roulette', () => {
    const racer = createTestRace(createCircleTrack(STRAIGHT_RADIUS), 1).racers[0];
    expect(usableItem(racer)).toBeNull();
    racer.items = ['mud'];
    racer.itemRoulette = 0.3;
    expect(usableItem(racer)).toBeNull();
    racer.items = ['mud', 'bone'];
    expect(usableItem(racer)).toBe('mud');
    racer.itemRoulette = 0;
    expect(usableItem(racer)).toBe('mud');
  });
```

Lancer `npx ng test --watch=false --include src/game/items/item-system.spec.ts` : échec attendu
(`items`, `usableItem` inexistants).

- [ ] **Étape 2 : types et constantes**

`RacerState` : remplacer `item: ItemKind | null;` et le commentaire de `itemRoulette` par

```ts
  /** Objets tenus, dans l'ordre d'utilisation (au plus ITEMS.maxHeld). */
  items: ItemKind[];
  /** Temps restant de la roulette du dernier objet de `items` (0 : aucune roulette en cours). */
  itemRoulette: number;
```

`ITEMS` : ajouter `/** Objets tenus au plus (file d'attente). */ maxHeld: 2,`.
`createRacer` et `createTestRacer` : `items: [],` au lieu de `item: null,`.

- [ ] **Étape 3 : `item-system.ts`**

```ts
/** Objet utilisable maintenant : le premier de la file, sauf s'il est seul et encore en roulette. */
export function usableItem(racer: RacerState): ItemKind | null {
  const first = racer.items[0];
  if (first === undefined) return null;
  if (racer.itemRoulette > 0 && racer.items.length === 1) return null;
  return first;
}
```

- `useItem` : remplacer les trois premières lignes par
  `const item = usableItem(racer); if (item === null) return; racer.items.shift();` (l'événement
  `item-use` et le `switch` restent identiques).
- `updateRacerTimers` : à la fin de la roulette, annoncer le dernier objet :
  `const last = racer.items.at(-1); if (racer.itemRoulette === 0 && last !== undefined) emit({ type: 'item-ready', racerId: racer.id, item: last });`
- `updateBoxes` : peut recevoir `racer.items.length < ITEMS.maxHeld && racer.itemRoulette <= 0` ;
  réception : `receiver.items.push(rollItem(receiver.rank, race.racers.length, rng));` puis la
  roulette comme avant. Importer `ItemKind` si nécessaire.

- [ ] **Étape 4 : IA** (`ai-controller.ts`)

- `updateItems` : `const item = usableItem(racer);` (import depuis `../items/item-system`) au lieu de
  `racer.itemRoulette > 0 ? null : racer.item`.
- `update` : `if (input.useItem && usableItem(racer) === 'bone') input.brake = false;`

- [ ] **Étape 5 : HUD, compatibilité provisoire** (`hud.ts`, remplacé en tâche 2)

```ts
      item: player?.items[0] ?? null,
      itemRolling: (player?.itemRoulette ?? 0) > 0 && player?.items.length === 1,
```

- [ ] **Étape 6 : adapter les tests existants**

Suivre les erreurs de compilation (`npx ng build`, puis la suite) : `racer.item = X` →
`racer.items = [X]`, `racer.item = null` → `racer.items = []`, `expect(racer.item).toBe(X)` →
`expect(racer.items).toEqual([X])` (ou `[]`), `overrides: { item }` →
`overrides: { items: item ? [item] : [] }`. Dans `ai-controller.spec.ts`, `simulate` consomme le
premier objet : `if (input.useItem) racers[i].items.shift();` ; `consumed.racer.item = null` →
`consumed.racer.items = []`. Le test « une boîte cassée ne redonne pas d'objet à qui en a déjà un »
devient « … à qui en a déjà deux » (lui donner deux objets). Garder l'intention de chaque test.

- [ ] **Étape 7 : toute la suite, commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write src/game
git add -A src
git commit -m "Objets : deux emplacements en file d'attente"
```

---

### Tâche 2 : HUD à deux cases

**Fichiers :**
- Modifier : `src/game/game-api.ts` (`HudSnapshot`), `src/game/hud.ts`
- Créer : `src/app/features/race/hud/hud-item-slot.ts`
- Modifier : `src/app/features/race/hud/hud-item.ts`, `race-hud.ts`
- Modifier : `src/app/testing/fake-game.ts` (`fakeHud`)
- Tests : `src/game/hud.spec.ts`, `src/app/features/race/race-page.spec.ts`

**Interfaces :**
- Consomme : `RacerState.items`, `itemRoulette` (tâche 1).
- Produit : `HudSnapshot.items: ItemKind[]` et `HudSnapshot.rollingSlot: 0 | 1 | null` (remplacent
  `item` et `itemRolling`) ; composant `HudItemSlot` (`app-hud-item-slot`).

- [ ] **Étape 1 : tests qui échouent**

`hud.spec.ts` :

```ts
  it('publie les deux objets et la case dont la roulette tourne', () => {
    const { state, player } = setup(); // réutiliser la fabrique existante du fichier
    player.items = ['mud', 'bone'];
    player.itemRoulette = 0.4;
    const hud = buildHudSnapshot(state, false);
    expect(hud.items).toEqual(['mud', 'bone']);
    expect(hud.rollingSlot).toBe(1);
    player.itemRoulette = 0;
    expect(buildHudSnapshot(state, false).rollingSlot).toBeNull();
  });
```

(adapter `setup()` au nom de la fabrique réellement utilisée par `hud.spec.ts`.)

`race-page.spec.ts` :

```ts
  it('affiche l’objet suivant en grand et la réserve en petit', async () => {
    game.last.callbacks.onReady(FAKE_INFO);
    game.last.callbacks.onHud(fakeHud({ items: ['bone', 'tennis-ball'], rollingSlot: null }));
    await settle(fixture);
    expect(element.querySelector('[aria-label="Objet : Os"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Réserve : Balle de tennis"]')).not.toBeNull();
    expect(text()).toContain('Lancé devant (derrière en freinant)');
  });

  it('fait tourner la roulette dans la réserve sans cacher l’objet suivant', async () => {
    game.last.callbacks.onReady(FAKE_INFO);
    game.last.callbacks.onHud(fakeHud({ items: ['mud', 'bone'], rollingSlot: 1 }));
    await settle(fixture);
    expect(element.querySelector('[aria-label="Objet : Flaque de boue"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Réserve : tirage en cours"]')).not.toBeNull();
  });
```

Adapter les tests existants : `item: 'bone'` → `items: ['bone']` ; `itemRolling: true` →
`items: ['bone'], rollingSlot: 0` (libellé attendu inchangé : « Objet : tirage en cours ») ;
`item: null, itemRolling: false` → `items: [], rollingSlot: null` (libellés « Objet : aucun » et
« Réserve : vide »). `fakeHud` : valeurs par défaut `items: []`, `rollingSlot: null`.

- [ ] **Étape 2 : instantané**

`HudSnapshot` : remplacer `item` et `itemRolling` par

```ts
  /** Objets tenus (au plus 2) ; le premier est le prochain utilisé. */
  items: ItemKind[];
  /** Case dont la roulette tourne (0 = objet suivant, 1 = réserve), ou null. */
  rollingSlot: 0 | 1 | null;
```

`buildHudSnapshot` :

```ts
      items: [...(player?.items ?? [])],
      rollingSlot:
        player && player.itemRoulette > 0 && player.items.length > 0
          ? ((player.items.length - 1) as 0 | 1)
          : null,
```

- [ ] **Étape 3 : composants**

`hud-item-slot.ts` reprend le contenu de la case actuelle de `hud-item.ts` (roulette, icône,
empreinte de patte vide, styles de la roulette et `prefers-reduced-motion`), paramétré :

```ts
@Component({
  selector: 'app-hud-item-slot',
  imports: [ItemIcon],
  host: { class: 'block' },
  template: `
    <div
      role="img"
      [attr.aria-label]="label()"
      class="grid place-items-center overflow-hidden border-white/85 bg-slate-900/80 shadow-lg"
      [class]="large() ? 'size-20 rounded-2xl border-4' : 'size-12 rounded-xl border-2'"
    >
      <!-- même contenu que la case actuelle : roulette (bande ROULETTE) si rolling(), icône si kind(),
           sinon l'empreinte de patte ; icône size-14 (grande) ou size-8 (petite) -->
    </div>
  `,
  styles: `/* styles actuels de hud-item.ts : .roulette-strip, .roulette-static, @keyframes, reduced motion */`,
})
export class HudItemSlot {
  readonly kind = input<ItemKind | null>(null);
  readonly rolling = input(false);
  readonly large = input(true);
  /** Libellé complet de la case (« Objet : Os », « Réserve : vide »…). */
  readonly label = input.required<string>();
  protected readonly roulette = ROULETTE;
}
```

(déplacer `ROULETTE` dans ce fichier ; recopier tel quel le balisage de la case actuelle en
remplaçant `item()`/`held` par `kind()` et la taille d'icône selon `large()`.)

`hud-item.ts` compose deux cases et la légende :

```ts
@Component({
  selector: 'app-hud-item',
  imports: [HudItemSlot],
  host: { class: 'flex flex-col items-end gap-1' },
  template: `
    <div class="flex items-end gap-2">
      <app-hud-item-slot
        [large]="false"
        [kind]="items()[1] ?? null"
        [rolling]="rollingSlot() === 1"
        [label]="reserveLabel()"
      />
      <app-hud-item-slot
        [kind]="items()[0] ?? null"
        [rolling]="rollingSlot() === 0"
        [label]="mainLabel()"
      />
    </div>
    @if (caption(); as text) {
      <!-- légende actuelle, inchangée -->
    }
  `,
})
export class HudItem {
  readonly items = input<readonly ItemKind[]>([]);
  readonly rollingSlot = input<0 | 1 | null>(null);

  protected readonly caption = computed(() => {
    const item = this.items()[0];
    return item && this.rollingSlot() !== 0 ? { name: itemName(item), hint: itemHint(item) } : null;
  });
  protected readonly mainLabel = computed(() => slotLabel('Objet', 'aucun', this.items()[0], this.rollingSlot() === 0));
  protected readonly reserveLabel = computed(() => slotLabel('Réserve', 'vide', this.items()[1], this.rollingSlot() === 1));
}

/** « Objet : Os », « Réserve : tirage en cours », « Objet : aucun »… */
function slotLabel(name: string, empty: string, kind: ItemKind | undefined, rolling: boolean): string {
  if (rolling) return `${name} : tirage en cours`;
  return kind ? `${name} : ${itemName(kind)}` : `${name} : ${empty}`;
}
```

`race-hud.ts` : `<app-hud-item [items]="hud().items" [rollingSlot]="hud().rollingSlot" />`.

- [ ] **Étape 4 : toute la suite, commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write src/game src/app
git add -A src
git commit -m "HUD : objet suivant et réserve"
```

---

### Tâche 3 : aspiration (simulation, son)

**Fichiers :**
- Modifier : `src/game/core/constants.ts` (`SLIPSTREAM`), `src/game/core/types.ts` (`KartState`,
  `GameEvent`), `src/game/core/kart-state.ts`
- Créer : `src/game/race/slipstream.ts` ; Test : `src/game/race/slipstream.spec.ts`
- Modifier : `src/game/race/simulation.ts` (`stepRace`), `src/game/items/item-system.ts` (événement
  boost de la croquette), `src/game/audio/sound-effects.ts` (`boostRush`),
  `src/game/audio/audio-engine.ts`, `src/game/render/effects.ts` (`handleEvents`, teinte)

**Interfaces :**
- Produit : `SLIPSTREAM` ; `KartState.slipstream: number` (0 à 1) ; `inSlipstream(self, racers)` et
  `stepSlipstream(racers, dt, emit)` ; `GameEvent` boost scindé :
  `{ type: 'boost'; racerId; source: 'drift'; tier: DriftTier } | { type: 'boost'; racerId; source: 'item' | 'slipstream' }`.

- [ ] **Étape 1 : tests qui échouent**

```ts
// src/game/race/slipstream.spec.ts
import { describe, expect, it } from 'vitest';
import { FIXED_DT, SLIPSTREAM } from '../core/constants';
import type { GameEvent, RacerState } from '../core/types';
import { TEST_TUNING, createTestRacer } from '../testing/fixtures';
import { inSlipstream, stepSlipstream } from './slipstream';

/** Deux pilotes sur l'axe +z (cap 0) : le suiveur en (x, 0), le meneur en (0, ahead). */
function pair(ahead: number, x = 0, speedRatio = 0.8, leaderHeading = 0): [RacerState, RacerState] {
  const follower = createTestRacer(1, { x, z: 0 }, 0);
  follower.kart.speed = speedRatio * TEST_TUNING.maxSpeed;
  const leader = createTestRacer(2, { x: 0, z: ahead }, leaderHeading);
  return [follower, leader];
}

describe('aspiration', () => {
  it('dans le sillage : assez près, dans l’axe, assez vite, même sens', () => {
    const [follower, leader] = pair(8);
    expect(inSlipstream(follower, [follower, leader])).toBe(true);
  });

  it.each([
    ['trop près', pair(2)],
    ['trop loin', pair(16)],
    ['hors du cône', pair(8, 8 * Math.tan((20 * Math.PI) / 180))],
    ['trop lent', pair(8, 0, 0.5)],
    ['kart en face (contresens)', pair(8, 0, 0.8, Math.PI)],
  ])('pas d’aspiration : %s', (_label, [follower, leader]) => {
    expect(inSlipstream(follower, [follower, leader])).toBe(false);
  });

  it('pas d’aspiration en tête-à-queue', () => {
    const [follower, leader] = pair(8);
    follower.kart.spinTime = 0.5;
    expect(inSlipstream(follower, [follower, leader])).toBe(false);
  });

  it('la jauge se remplit en 1,2 s puis donne un turbo, une seule fois', () => {
    const [follower, leader] = pair(8);
    const events: GameEvent[] = [];
    const steps = Math.round(SLIPSTREAM.chargeTime / FIXED_DT);
    for (let i = 0; i < steps - 1; i++) stepSlipstream([follower, leader], FIXED_DT, (e) => events.push(e));
    expect(follower.kart.slipstream).toBeGreaterThan(0.95);
    expect(follower.kart.boostTime).toBe(0);
    stepSlipstream([follower, leader], FIXED_DT, (e) => events.push(e));
    stepSlipstream([follower, leader], FIXED_DT, (e) => events.push(e));
    expect(events).toEqual([{ type: 'boost', racerId: 1, source: 'slipstream' }]);
    expect(follower.kart.boostTime).toBeCloseTo(SLIPSTREAM.boostDuration, 5);
    expect(follower.kart.boostStrength).toBe(SLIPSTREAM.boostStrength);
    expect(follower.kart.slipstream).toBeLessThan(0.1);
  });

  it('hors du sillage, la jauge se vide deux fois plus vite', () => {
    const [follower, leader] = pair(30);
    follower.kart.slipstream = 0.5;
    const steps = Math.round(0.3 / FIXED_DT);
    for (let i = 0; i < steps; i++) stepSlipstream([follower, leader], FIXED_DT, () => undefined);
    expect(follower.kart.slipstream).toBeCloseTo(0, 5);
  });
});
```

Lancer le fichier : échec attendu (module inexistant).

- [ ] **Étape 2 : constantes, état, événement**

`constants.ts`, après `ITEMS` :

```ts
/** Aspiration : rouler dans le sillage d'un kart remplit une jauge, puis donne un turbo. */
export const SLIPSTREAM = {
  minDistance: 3,
  maxDistance: 14,
  /** Demi-angle du cône devant le kart (rad). */
  halfAngle: (12 * Math.PI) / 180,
  /** Fraction de la vitesse max en dessous de laquelle l'aspiration ne joue pas. */
  minSpeedRatio: 0.6,
  /** Temps (s) pour remplir la jauge. */
  chargeTime: 1.2,
  /** Hors du sillage, la jauge se vide ce nombre de fois plus vite. */
  decayFactor: 2,
  boostDuration: 1.0,
  boostStrength: 1.2,
} as const;
```

`KartState` : `/** Jauge d'aspiration (0 à 1) ; pleine, elle donne un turbo. */ slipstream: number;` ;
`createKartState` : `slipstream: 0,`.
`GameEvent` : remplacer la ligne `boost` par

```ts
  | { type: 'boost'; racerId: number; source: 'drift'; tier: DriftTier }
  | { type: 'boost'; racerId: number; source: 'item' | 'slipstream' }
```

`useItem` (croquette) : `emit({ type: 'boost', racerId: racer.id, source: 'item' });` (sans `tier`).

- [ ] **Étape 3 : module**

```ts
// src/game/race/slipstream.ts
/**
 * Aspiration : un kart qui roule dans le sillage d'un autre (assez près, dans son axe, assez vite,
 * dans le même sens) remplit une jauge ; pleine, elle donne un turbo. Vaut pour tous les pilotes.
 */
import { SLIPSTREAM } from '../core/constants';
import { applyBoost } from '../core/kart-state';
import type { EmitEvent, RacerState } from '../core/types';
import { wrapAngle } from '../core/vec2';

/** Vrai si `self` roule dans le sillage d'un autre pilote. */
export function inSlipstream(self: RacerState, racers: readonly RacerState[]): boolean {
  const kart = self.kart;
  if (kart.spinTime > 0) return false;
  if (kart.speed < SLIPSTREAM.minSpeedRatio * self.tuning.maxSpeed) return false;
  const minSq = SLIPSTREAM.minDistance ** 2;
  const maxSq = SLIPSTREAM.maxDistance ** 2;
  for (const other of racers) {
    if (other.id === self.id) continue;
    const dx = other.kart.position.x - kart.position.x;
    const dz = other.kart.position.z - kart.position.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < minSq || distanceSq > maxSq) continue;
    // Même sens : un kart qui arrive en face ne protège pas du vent.
    if (Math.cos(other.kart.heading - kart.heading) <= 0) continue;
    const bearing = wrapAngle(Math.atan2(dx, dz) - kart.heading);
    if (Math.abs(bearing) <= SLIPSTREAM.halfAngle) return true;
  }
  return false;
}

/** Remplit ou vide la jauge de chaque pilote ; turbo quand elle est pleine. */
export function stepSlipstream(racers: readonly RacerState[], dt: number, emit: EmitEvent): void {
  const rate = dt / SLIPSTREAM.chargeTime;
  for (const racer of racers) {
    const kart = racer.kart;
    kart.slipstream = inSlipstream(racer, racers)
      ? kart.slipstream + rate
      : Math.max(0, kart.slipstream - rate * SLIPSTREAM.decayFactor);
    if (kart.slipstream >= 1 - 1e-9) {
      kart.slipstream = 0;
      applyBoost(kart, SLIPSTREAM.boostDuration, SLIPSTREAM.boostStrength);
      emit({ type: 'boost', racerId: racer.id, source: 'slipstream' });
    }
  }
}
```

`simulation.ts`, `stepRace` : après la boucle des pilotes, avant `resolveKartCollisions` :
`stepSlipstream(racers, dt, this.emit);` (import depuis `./slipstream`).

- [ ] **Étape 4 : son et teinte**

`boostRush(voice: Voice, source: 'drift' | 'item' | 'slipstream', tier: DriftTier = 0)` :
`const strength = source === 'drift' ? DRIFT_BOOST_STRENGTH[tier] : source === 'slipstream' ? 0.7 : 1;`
`audio-engine.ts` : `sfx.boostRush(this.startVoice(graph), event.source, event.source === 'drift' ? event.tier : 0);`
`effects.ts` : `const WIND = color('#dff3ff');` ; teinte du boost :
`event.source === 'drift' ? TIER_COLORS[event.tier] : event.source === 'slipstream' ? WIND : FLAME`.

- [ ] **Étape 5 : toute la suite (dont la course de 8 IA), commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write src/game
git add -A src
git commit -m "Aspiration : turbo dans le sillage d'un concurrent"
```

---

### Tâche 4 : aspiration visible (traînées de vent, HUD)

**Fichiers :**
- Modifier : `src/game/render/effects.ts` (`update`, `Emitter`, nouvel `emitWind`)
- Modifier : `src/game/game-api.ts`, `src/game/hud.ts` (`slipstreaming`)
- Créer : `src/app/features/race/hud/hud-slipstream.ts` ; Modifier : `race-hud.ts`, `fake-game.ts`
- Tests : `effects.spec.ts`, `hud.spec.ts`, `race-page.spec.ts`

**Interfaces :**
- Consomme : `KartState.slipstream` (tâche 3).
- Produit : `HudSnapshot.slipstreaming: boolean` ; composant `app-hud-slipstream` (entrée `active`).

- [ ] **Étape 1 : tests qui échouent**

`hud.spec.ts` : `player.kart.slipstream = 0.4` → `slipstreaming` vrai ; `0` → faux.
`race-page.spec.ts` :

```ts
  it('annonce l’aspiration', async () => {
    game.last.callbacks.onReady(FAKE_INFO);
    game.last.callbacks.onHud(fakeHud({ slipstreaming: true }));
    await settle(fixture);
    expect(text()).toContain('Aspiration !');
  });
```

`effects.spec.ts` (avec la mise en place déjà utilisée par les tests de poussière du fichier) : un
kart à `slipstream = 0.5`, après `update(...)` sur 0,2 s, le réservoir `soft` compte plus de
particules vivantes qu'avec `slipstream = 0` (`effects['soft'].activeCount`).

- [ ] **Étape 2 : traînées de vent** (`effects.ts`)

```ts
const WIND_RATE = 40;
const WIND_OPTIONS: ParticleOptions = { gravity: 0, drag: 0, opacity: 0.55 };
```

`Emitter` gagne `wind: number` (initialisé à 0 dans le constructeur). Dans `update`, par pilote :

```ts
      // Aspiration : traînées de vent autour du kart pendant la charge.
      if (kart.slipstream > 0) {
        emitter.wind += WIND_RATE * (0.4 + kart.slipstream) * dt;
        while (emitter.wind >= 1) {
          emitter.wind -= 1;
          this.emitWind(visual);
        }
      } else {
        emitter.wind = 0;
      }
```

```ts
  /** Filet d'air qui file vers l'arrière autour du kart (aspiration). */
  private emitWind(visual: RacerVisual): void {
    const rng = this.rng;
    const forwardX = Math.sin(visual.heading);
    const forwardZ = Math.cos(visual.heading);
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(1.1, 1.6);
    const x = visual.position.x + Math.cos(angle) * radius + forwardX * 1.5;
    const z = visual.position.z - Math.sin(angle) * radius + forwardZ * 1.5;
    const speed = rng.range(14, 20);
    this.soft.emit(
      x,
      visual.position.y + rng.range(0.4, 1.4),
      z,
      -forwardX * speed,
      0,
      -forwardZ * speed,
      WIND,
      rng.range(0.07, 0.11),
      rng.range(0.16, 0.26),
      WIND_OPTIONS,
    );
  }
```

- [ ] **Étape 3 : HUD**

`HudSnapshot` : `/** Vrai pendant la charge de l'aspiration du joueur. */ slipstreaming: boolean;` ;
`buildHudSnapshot` : `slipstreaming: (kart?.slipstream ?? 0) > 0,` ; `fakeHud` : `slipstreaming: false`.

```ts
// src/app/features/race/hud/hud-slipstream.ts
import { Component, input } from '@angular/core';

/** « Aspiration ! » pendant la charge (texte clair sur le panneau sombre : contraste AA). */
@Component({
  selector: 'app-hud-slipstream',
  host: { class: 'block' },
  template: `
    @if (active()) {
      <p class="hud-panel font-black text-sky-200" [class.text-sm]="!compact()" [class.text-xs]="compact()">
        Aspiration !
      </p>
    }
  `,
})
export class HudSlipstream {
  readonly active = input(false);
  readonly compact = input(false);
}
```

`race-hud.ts` : importer `HudSlipstream`, l'ajouter au bloc des jauges, avant `app-hud-drift` :
`<app-hud-slipstream [active]="hud().slipstreaming" [compact]="touch()" />`.

- [ ] **Étape 4 : toute la suite, commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write src/game src/app
git add -A src
git commit -m "Aspiration : traînées de vent et libellé du HUD"
```

---

### Tâche 5 : os en or

**Fichiers :** `types.ts` (`ItemKind`, `ItemEntityKind`, `RacerState`), `constants.ts` (`ITEMS`),
`item-rules.ts`, `item-system.ts`, `race-setup.ts`, `fixtures.ts`, `game-api.ts`, `hud.ts`,
`hud-item.ts`, `hud-item-slot.ts`, `item-icon.ts`, `format.ts`, `ai-controller.ts`, `fake-game.ts` ;
tests `item-rules.spec.ts`, `item-system.spec.ts`, `ai-controller.spec.ts`, `hud.spec.ts`,
`format.spec.ts`.

**Interfaces :**
- Produit : `ItemKind` + `'golden-bone'` ; `ItemEntityKind = Exclude<ItemKind, 'kibble-turbo' | 'golden-bone'>` ;
  `RacerState.goldenBoneTime: number` ; `ITEMS.goldenBoneDuration = 7`,
  `goldenBoneTurboDuration = 1.0`, `goldenBoneTurboStrength = 1.3` ; `HudSnapshot.goldenBoneTime: number` ;
  `itemWeights` construit à partir de `ITEM_KINDS` (les tâches 6 à 8 n'ajoutent qu'une ligne).

- [ ] **Étape 1 : tests qui échouent**

`item-system.spec.ts`, nouveau `describe('os en or')` :

```ts
  it('chaque appui donne un turbo pendant 7 s, puis l’os disparaît et la réserve avance', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const [racer] = race.racers;
    placeOnTrack(racer, track, 100);
    racer.items = ['golden-bone', 'mud'];
    const { events, emit } = recorder();
    useItem(race, racer, track, false, emit);
    expect(racer.goldenBoneTime).toBe(ITEMS.goldenBoneDuration);
    expect(racer.kart.boostTime).toBe(ITEMS.goldenBoneTurboDuration);
    expect(racer.items).toEqual(['golden-bone', 'mud']);
    racer.kart.boostTime = 0;
    stepUntil(race, track, emit, 60, () => false);
    useItem(race, racer, track, false, emit);
    expect(racer.kart.boostTime).toBe(ITEMS.goldenBoneTurboDuration);
    expect(events.filter((e) => e.type === 'boost')).toHaveLength(2);
    stepUntil(race, track, emit, Math.round(ITEMS.goldenBoneDuration / FIXED_DT), () => racer.goldenBoneTime === 0);
    expect(racer.items).toEqual(['mud']);
  });

  it('os en or actif et un objet en réserve : pas de troisième objet', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const [racer] = race.racers;
    racer.items = ['golden-bone', 'mud'];
    racer.goldenBoneTime = 5;
    race.itemBoxes = [{ id: 0, position: clone(racer.kart.position), respawn: 0, height: 0 }];
    stepItems(race, track, fixedRng(0), FIXED_DT, () => undefined);
    expect(racer.items).toEqual(['golden-bone', 'mud']);
  });
```

`item-rules.spec.ts` : poids du premier (rang 1 sur 8) = os 40, flaque 40, balle 5, croquette 10,
os en or 0 ; du dernier = 10, 5, 20, 15, 15 ; et `ITEM_KINDS` se termine par `'golden-bone'`.
`ai-controller.spec.ts` (`describe('objets')`) :

```ts
    it('os en or : appuis répétés en ligne droite, espacés d’au moins 0,5 s', () => {
      const { step } = scenario({ item: 'golden-bone' });
      const uses: number[] = [];
      for (let i = 1; i <= 180; i++) if (step().useItem) uses.push(i * FIXED_DT);
      expect(uses.length).toBeGreaterThanOrEqual(3);
      for (let k = 1; k < uses.length; k++) expect(uses[k] - uses[k - 1]).toBeGreaterThanOrEqual(0.5 - 1e-9);
    });

    it('os en or : gardé dans un virage', () => {
      expect(scenario({ item: 'golden-bone', track: createCircleTrack(40, 'right') }).firstUse(5)).toBeNull();
    });
```

`format.spec.ts` : `itemName('golden-bone')` = « Os en or », `itemHint('golden-bone')` = « Turbo à
chaque appui, 7 s ».

- [ ] **Étape 2 : types, constantes, tirage**

`ItemKind` += `| 'golden-bone'` ; `ItemEntityKind = Exclude<ItemKind, 'kibble-turbo' | 'golden-bone'>` ;
`RacerState` : `/** Temps restant de l'os en or actif (s) ; 0 : inactif. */ goldenBoneTime: number;`
(`createRacer`, `createTestRacer` : `goldenBoneTime: 0`). `ITEMS` : `goldenBoneDuration: 7,
goldenBoneTurboDuration: 1.0, goldenBoneTurboStrength: 1.3,`.

`item-rules.ts` :

```ts
export const ITEM_KINDS: readonly ItemKind[] = ['bone', 'mud', 'tennis-ball', 'kibble-turbo', 'golden-bone'];

const WEIGHT_TABLE: Readonly<Record<ItemKind, readonly [number, number, number]>> = {
  bone: [40, 25, 10],
  mud: [40, 15, 5],
  'tennis-ball': [5, 20, 20],
  'kibble-turbo': [10, 20, 15],
  'golden-bone': [0, 10, 15],
};

export function itemWeights(rank: number, racerCount: number): Record<ItemKind, number> {
  const f = rankFraction(rank, racerCount);
  const interpolate = ([first, middle, last]: readonly [number, number, number]): number =>
    f <= 0.5 ? first + (middle - first) * (f / 0.5) : middle + (last - middle) * ((f - 0.5) / 0.5);
  const weights = {} as Record<ItemKind, number>;
  for (const kind of ITEM_KINDS) weights[kind] = interpolate(WEIGHT_TABLE[kind]);
  return weights;
}
```

(mettre à jour l'en-tête du fichier : les derniers reçoivent aussi les objets les plus puissants.)

- [ ] **Étape 3 : effet** (`item-system.ts`)

Dans `useItem`, juste après `const item = usableItem(racer); if (item === null) return;` :

```ts
  // L'os en or reste dans la case pendant sa durée : chaque appui redonne un turbo.
  if (item === 'golden-bone') {
    if (racer.goldenBoneTime <= 0) racer.goldenBoneTime = ITEMS.goldenBoneDuration;
    emit({ type: 'item-use', racerId: racer.id, item });
    applyBoost(racer.kart, ITEMS.goldenBoneTurboDuration, ITEMS.goldenBoneTurboStrength);
    emit({ type: 'boost', racerId: racer.id, source: 'item' });
    return;
  }
```

(le `racer.items.shift()` vient après ce bloc ; ajouter `case 'golden-bone': break;` au `switch` si
TypeScript l'exige.) `updateRacerTimers` :

```ts
    if (racer.goldenBoneTime > 0) {
      racer.goldenBoneTime = Math.max(0, racer.goldenBoneTime - dt);
      if (racer.goldenBoneTime === 0 && racer.items[0] === 'golden-bone') racer.items.shift();
    }
```

- [ ] **Étape 4 : HUD, icône, nom, IA**

- `HudSnapshot.goldenBoneTime: number` (s) ; `buildHudSnapshot` : `goldenBoneTime: player?.goldenBoneTime ?? 0` ;
  `fakeHud` : `goldenBoneTime: 0`.
- `HudItem` : entrée `goldenBoneTime = input(0)`, transmise à la grande case ; `HudItemSlot` :
  entrée `timeLeft = input(0)` ; si `timeLeft() > 0`, barre sous l'icône
  `<span class="absolute inset-x-2 bottom-1.5 h-1.5 rounded-full bg-sun-400" [style.width.%]="(timeLeft() / goldenDuration) * 100"></span>`
  (`goldenDuration = ITEMS.goldenBoneDuration`, case en `relative`) ; libellé principal
  « Objet : Os en or, N s » quand il est actif (N arrondi au supérieur). `race-hud.ts` :
  `[goldenBoneTime]="hud().goldenBoneTime"`.
- `item-icon.ts` : `@case ('golden-bone')` = copie du cas `bone` avec remplissage `#f5c542` et
  contour `#8a6a12`, plus deux petites étincelles (`<path d="M38 8 l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z" fill="#fff6c2" />`).
- `hud-item-slot.ts` : `ROULETTE` = `ITEM_KINDS` (importé de `item-rules`) pour que la bande montre
  tous les objets.
- `format.ts` : `'golden-bone': 'Os en or'` ; aide `'Turbo à chaque appui, 7 s'`.
- IA : `wantsToUse` : `case 'golden-bone': return cornerCurvature < TURBO_MAX_CURVATURE;` ;
  `drawItemDelay` : `case 'golden-bone': return 0;` ; dans `updateItems`, après usage :
  `this.itemRetry = item === 'golden-bone' ? this.rng.range(0.5, 0.8) : ITEM_RETRY_DELAY;`.

- [ ] **Étape 5 : toute la suite, commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write src/game src/app
git add -A src
git commit -m "Nouveau cadeau : os en or"
```

---

### Tâche 6 : sifflet

**Fichiers :** `types.ts` (`ItemKind`, `ItemEntityKind`, `KartState`, `GameEvent`), `constants.ts`,
`kart-state.ts`, `kart-physics.ts` (`tickTimers`, `stepKart`, nouveau `stepStun`), `item-rules.ts`,
`item-system.ts`, `race/slipstream.ts`, `ai-controller.ts`, `item-icon.ts`, `format.ts`,
`effects.ts` (notes de musique), `sound-effects.ts`, `audio-engine.ts` ; tests `item-system.spec.ts`,
`kart-physics.spec.ts`, `slipstream.spec.ts`, `ai-controller.spec.ts`, `item-rules.spec.ts`,
`format.spec.ts`, `audio-engine.spec.ts` (si un test couvre `item-use`).

**Interfaces :**
- Produit : `'whistle'` ; `ItemEntityKind = Exclude<ItemKind, 'kibble-turbo' | 'golden-bone' | 'whistle'>` ;
  `KartState.stunTime: number` ; `ITEMS.whistleStun = 1`, `ITEMS.stunDeceleration = 30` ;
  `GameEvent` + `{ type: 'stun'; racerId: number; ownerId: number }` ; `sfx.whistle(voice)`.

- [ ] **Étape 1 : tests qui échouent**

`item-system.spec.ts`, `describe('sifflet')` :

```ts
  it('arrête 1 s les pilotes mieux classés, pas les autres', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 4);
    const [first, second, thrower, last] = race.racers;
    [first.rank, second.rank, thrower.rank, last.rank] = [1, 2, 3, 4];
    thrower.items = ['whistle'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    expect(first.kart.stunTime).toBe(ITEMS.whistleStun);
    expect(second.kart.stunTime).toBe(ITEMS.whistleStun);
    expect(last.kart.stunTime).toBe(0);
    expect(thrower.kart.stunTime).toBe(0);
    const stuns = events.filter((e): e is Extract<GameEvent, { type: 'stun' }> => e.type === 'stun');
    expect(stuns.map((e) => e.racerId).sort()).toEqual([first.id, second.id].sort());
  });

  it('utilisé par le premier : personne n’est arrêté, l’objet est consommé', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 3);
    const [leader, ...others] = race.racers;
    leader.rank = 1;
    leader.items = ['whistle'];
    useItem(race, leader, track, false, () => undefined);
    expect(leader.items).toEqual([]);
    for (const other of others) expect(other.kart.stunTime).toBe(0);
  });
```

`kart-physics.spec.ts` :

```ts
  it('arrêté par un sifflet : ralentit fort, ignore gaz et braquage, garde son turbo', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 25);
    kart.stunTime = 1;
    kart.boostTime = 2;
    const heading = kart.heading;
    run(kart, 0.5, { throttle: true, steer: 1 });
    expect(kart.speed).toBeLessThan(25 - 30 * 0.5 + 1);
    expect(Math.abs(wrapAngle(kart.heading - heading))).toBeLessThan(0.02);
    expect(kart.boostTime).toBeGreaterThan(1);
    run(kart, 0.6, { throttle: true });
    expect(kart.stunTime).toBe(0);
  });
```

`slipstream.spec.ts` : `follower.kart.stunTime = 0.5` → pas d'aspiration.
`ai-controller.spec.ts` : sifflet utilisé entre 0,3 et 1 s au rang 3 ; gardé au rang 1.
`item-rules.spec.ts` : `whistle` 0 au premier, 8 au dernier. `format.spec.ts` : « Sifflet »,
« Arrête net les chiens devant ».

- [ ] **Étape 2 : état et physique**

`KartState` : `/** Temps restant d'arrêt net (sifflet) : ni gaz ni braquage. */ stunTime: number;`
(`createKartState` : `stunTime: 0`). `ITEMS` : `whistleStun: 1, stunDeceleration: 30,`.
`tickTimers` : `kart.stunTime = Math.max(0, kart.stunTime - dt);`. Dans `stepKart` :

```ts
  const spinning = kart.spinTime > 0;
  if (spinning) {
    stepSpin(kart, dt);
  } else if (kart.stunTime > 0) {
    stepStun(kart, dt);
  } else {
    // … branche actuelle inchangée …
  }
```

```ts
/** Arrêt net (sifflet) : ni gaz ni braquage, forte décélération ; le dérapage s'annule, le turbo reste. */
function stepStun(kart: KartState, dt: number): void {
  kart.steer = 0;
  resetDrift(kart.drift);
  kart.speed = approach(kart.speed, 0, ITEMS.stunDeceleration * dt);
}
```

(importer `ITEMS` depuis `../core/constants`.) `slipstream.ts` : `if (kart.spinTime > 0 || kart.stunTime > 0) return false;`.

- [ ] **Étape 3 : effet, tirage, IA, icône, nom**

- `ItemKind` += `| 'whistle'` ; `ItemEntityKind` exclut aussi `'whistle'` ; `GameEvent` += `stun`.
- `ITEM_KINDS` += `'whistle'` ; `WEIGHT_TABLE.whistle = [0, 3, 8]`.
- `useItem`, `switch` :

```ts
    case 'whistle':
      // Tous les pilotes mieux classés s'arrêtent net pour écouter.
      for (const other of race.racers) {
        if (other.id === racer.id || other.finished || other.rank >= racer.rank) continue;
        other.kart.stunTime = ITEMS.whistleStun;
        emit({ type: 'stun', racerId: other.id, ownerId: racer.id });
      }
      break;
```

- IA : `wantsToUse` : `case 'whistle': return waited && racer.rank > 1;` ; `drawItemDelay` :
  `case 'whistle': return this.rng.range(0.3, 1);`.
- `item-icon.ts` : `@case ('whistle')` : sifflet argenté
  (`<rect x="8" y="20" width="22" height="14" rx="7" fill="#c9d3dc" stroke="#44515c" stroke-width="2" /><rect x="28" y="22" width="12" height="6" rx="2" fill="#c9d3dc" stroke="#44515c" stroke-width="2" /><circle cx="15" cy="27" r="3" fill="#44515c" />`).
- `format.ts` : « Sifflet » / « Arrête net les chiens devant ».

- [ ] **Étape 4 : notes de musique et son**

`effects.ts` : au-dessus de chaque kart arrêté, une note (croche) qui oscille, sur le modèle des
étoiles de tête-à-queue : deux `InstancedMesh` (`note-heads` : `SphereGeometry(0.12, 10, 8)` aplatie
`.scale(1.3, 1, 0.5)` ; `note-stems` : `BoxGeometry(0.035, 0.42, 0.035).translate(0.13, 0.21, 0)`),
matériau `MeshBasicMaterial({ color: '#2b2d42' })`, capacité = nombre de karts ; dans `update`, pour
`kart.stunTime > 0` : position `visual.position.y + 2.1 + Math.sin(time * 8 + racer.id) * 0.1`,
rotation `y = time * 3`, puis `count` et `needsUpdate` comme pour les étoiles.

`sound-effects.ts` :

```ts
/** Coup de sifflet : deux notes aiguës. */
export function whistle(voice: Voice): void {
  voice.tone({ type: 'sine', freq: 2100, freqEnd: 2500, duration: 0.14, peak: 0.18, attack: 0.005 });
  voice.tone({ type: 'sine', freq: 2450, freqEnd: 2300, duration: 0.32, peak: 0.16, attack: 0.01, delay: 0.16 });
}
```

`audio-engine.ts` : dans le premier `switch` (événements globaux),
`case 'stun': if (event.racerId === playerId) sfx.whistle(this.startVoice(graph)); return;` ; dans le
second, `case 'item-use': if (event.item === 'whistle') sfx.whistle(this.startVoice(graph)); else sfx.itemWhoosh(this.startVoice(graph)); return;`.

- [ ] **Étape 5 : toute la suite, commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write src/game src/app
git add -A src
git commit -m "Nouveau cadeau : sifflet"
```

---

### Tâche 7 : super-collier

**Fichiers :** `types.ts`, `constants.ts`, `kart-state.ts`, `kart-physics.ts` (`tickTimers`,
`stepSpeed`), `race/collisions.ts`, `item-rules.ts`, `item-system.ts` (`useItem`,
`collideWithRacers`, sifflet), `ai-controller.ts`, `item-icon.ts`, `format.ts`, `effects.ts` (halo),
`sound-effects.ts`, `audio-engine.ts` ; tests `item-system.spec.ts`, `kart-physics.spec.ts`,
`collisions.spec.ts`, `ai-controller.spec.ts`, `item-rules.spec.ts`, `format.spec.ts`.

**Interfaces :**
- Produit : `'super-collar'` ; `ItemEntityKind` exclut aussi `'super-collar'` ;
  `KartState.collarTime: number` ; `ITEMS.collarDuration = 6`, `ITEMS.collarSpeedFactor = 1.15` ;
  `GameEvent` `hit` : `by: ItemEntityKind | 'super-collar'` ; `sfx.collarChime(voice)`.

- [ ] **Étape 1 : tests qui échouent**

`item-system.spec.ts`, `describe('super-collier')` :

```ts
  it('rend insensible aux os et au sifflet pendant 6 s', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [thrower, victim] = race.racers;
    placeOnTrack(thrower, track, 100);
    placeOnTrack(victim, track, 130);
    victim.items = ['super-collar'];
    useItem(race, victim, track, false, () => undefined);
    expect(victim.kart.collarTime).toBe(ITEMS.collarDuration);
    thrower.items = ['bone'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    stepUntil(race, track, emit, 90, () => false);
    expect(hits(events)).toEqual([]);
    [victim.rank, thrower.rank] = [1, 2];
    thrower.items = ['whistle'];
    useItem(race, thrower, track, false, emit);
    expect(victim.kart.stunTime).toBe(0);
  });
```

`collisions.spec.ts` :

```ts
  it('le porteur du super-collier fait partir l’autre en tête-à-queue sans ralentir', () => {
    const holder = createTestRacer(0, { x: 0, z: 0 }, 0);
    const other = createTestRacer(1, { x: 0, z: 1.5 }, 0);
    holder.kart.speed = 30;
    other.kart.speed = 10;
    holder.kart.collarTime = 3;
    const events: GameEvent[] = [];
    resolveKartCollisions([holder, other], (e) => events.push(e));
    expect(other.kart.spinTime).toBeGreaterThan(0);
    expect(holder.kart.speed).toBe(30);
    expect(events).toContainEqual({ type: 'hit', racerId: 1, by: 'super-collar', ownerId: 0 });
  });

  it('deux porteurs du super-collier : simple choc, pas de tête-à-queue', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 0, z: 1.5 }, 0);
    a.kart.speed = 30;
    a.kart.collarTime = 3;
    b.kart.collarTime = 3;
    resolveKartCollisions([a, b], () => undefined);
    expect(a.kart.spinTime).toBe(0);
    expect(b.kart.spinTime).toBe(0);
  });
```

`kart-physics.spec.ts` : avec `collarTime = 6` (renouvelé chaque pas dans `run`), la vitesse de
croisière dépasse `1.1 × maxSpeed` ; sur le bas-côté (`lateral` 8,5 m), elle reste au-dessus de
`0.95 × maxSpeed`. `ai-controller.spec.ts` : utilisé entre 0,5 et 1,5 s. `item-rules.spec.ts` :
`super-collar` 0 / 12. `format.spec.ts` : « Super-collier » / « Invincible 6 s ».

- [ ] **Étape 2 : état, physique, collisions**

`KartState` : `/** Temps restant du super-collier (s). */ collarTime: number;` (0 par défaut) ;
`tickTimers` : `kart.collarTime = Math.max(0, kart.collarTime - dt);` ; `ITEMS` :
`collarDuration: 6, collarSpeedFactor: 1.15,`. `stepSpeed`, calcul de `maxSpeed` :

```ts
  const collar = kart.collarTime > 0;
  const maxSpeed =
    tuning.maxSpeed *
    (boosting ? kart.boostStrength : 1) *
    (collar ? ITEMS.collarSpeedFactor : 1) *
    (kart.offroad && !boosting && !collar ? tuning.offroadFactor : 1) *
    slopeFactor;
```

`collisions.ts`, dans la boucle, juste avant `separate(...)` :

```ts
        // Super-collier : l'autre part en tête-à-queue, le porteur garde sa vitesse.
        const collarA = a.kart.collarTime > 0;
        const collarB = b.kart.collarTime > 0;
        const holder = collarA !== collarB ? (collarA ? a : b) : null;
        const holderSpeed = holder?.kart.speed ?? 0;
        if (holder) {
          const victim = holder === a ? b : a;
          if (victim.kart.spinTime <= 0) {
            applySpinOut(victim.kart);
            emit({ type: 'hit', racerId: victim.id, by: 'super-collar', ownerId: holder.id });
          }
        }
```

et après `exchangeImpulse(...)` : `if (holder) holder.kart.speed = holderSpeed;` (importer
`applySpinOut`).

- [ ] **Étape 3 : effet, protection, tirage, IA, icône, nom**

- `ItemKind` += `| 'super-collar'` ; `ItemEntityKind` exclut aussi `'super-collar'` ; `hit.by` :
  `ItemEntityKind | 'super-collar'`.
- `ITEM_KINDS` += `'super-collar'` ; `WEIGHT_TABLE['super-collar'] = [0, 5, 12]`.
- `useItem` : `case 'super-collar': racer.kart.collarTime = ITEMS.collarDuration; break;`.
- `collideWithRacers` : `if (racer.hitImmunity > 0 || racer.kart.collarTime > 0) continue;`.
- Sifflet : `if (other.id === racer.id || other.finished || other.rank >= racer.rank || other.kart.collarTime > 0) continue;`.
- IA : `case 'super-collar': return waited;` ; délai `this.rng.range(0.5, 1.5)`.
- `item-icon.ts` : collier doré (`<circle cx="24" cy="22" r="13" fill="none" stroke="#f5c542" stroke-width="5" /><path d="M24 33 l3 6 6 1 -4.5 4 1 6 -5.5 -3 -5.5 3 1 -6 -4.5 -4 6 -1z" fill="#ffe27a" stroke="#8a6a12" stroke-width="1.2" />`).
- `format.ts` : « Super-collier » / « Invincible 6 s ».

- [ ] **Étape 4 : halo et son**

`effects.ts` : halo doré autour de chaque kart porteur : `InstancedMesh` `collar-halos`
(`TorusGeometry(1.35, 0.07, 8, 32).rotateX(Math.PI / 2)`, `MeshBasicMaterial({ color: '#ffd23f',
transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })`,
capacité = nombre de karts) ; dans `update`, pour `kart.collarTime > 0` : position
`(visual.position.x, visual.position.y + 0.55, visual.position.z)`, rotation `y = time * 4`,
échelle `1 + Math.sin(time * 10) * 0.05`.

`sound-effects.ts` :

```ts
/** Super-collier : arpège montant et brillant. */
export function collarChime(voice: Voice): void {
  [660, 880, 1100, 1320].forEach((freq, i) =>
    voice.tone({ type: 'triangle', freq, duration: 0.14, peak: 0.14, attack: 0.005, delay: i * 0.06 }),
  );
}
```

`audio-engine.ts`, `item-use` : `'whistle'` → `whistle`, `'super-collar'` → `collarChime`, sinon
`itemWhoosh`.

- [ ] **Étape 5 : toute la suite, commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write src/game src/app
git add -A src
git commit -m "Nouveau cadeau : super-collier"
```

---

### Tâche 8 : écureuil

**Fichiers :** `types.ts`, `constants.ts`, `item-rules.ts`, `item-system.ts` (`useItem`,
`ENTITY_LIFE`, `moveEntities`, nouveaux `moveSquirrel`, `squirrelTarget`, `collideSquirrels`,
`stepItems`, `collideWithRacers`, `collideProjectilesWithMud`), `item-visuals.ts`, `ai-controller.ts`,
`item-icon.ts`, `format.ts` ; tests `item-system.spec.ts`, `item-rules.spec.ts`,
`ai-controller.spec.ts`, `format.spec.ts`.

**Interfaces :**
- Produit : `'squirrel'` dans `ItemKind` et donc dans `ItemEntityKind` ; `ITEMS.squirrelSpeed = 90`,
  `squirrelLife = 20`, `squirrelSpin = 1.5`, `squirrelCatch = 1.5` (écart d'abscisse de capture, m).

- [ ] **Étape 1 : tests qui échouent**

`item-system.spec.ts`, `describe('écureuil')` :

```ts
  function squirrelRace(count: number) {
    const track = createCircleTrack(300);
    const race = createTestRace(track, count);
    race.racers.forEach((racer, i) => {
      placeOnTrack(racer, track, 400 - i * 60, i % 2 === 0 ? 4 : -4);
      racer.rank = i + 1;
    });
    return { track, race };
  }

  it('fonce sur le premier, quel que soit son couloir, et le fait tourner 1,5 s', () => {
    const { track, race } = squirrelRace(4);
    const [leader, second, , thrower] = race.racers;
    thrower.items = ['squirrel'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    stepUntil(race, track, emit, 600, () => hits(events).length > 0);
    expect(hits(events)).toEqual([{ type: 'hit', racerId: leader.id, by: 'squirrel', ownerId: thrower.id }]);
    expect(leader.kart.spinTime).toBeCloseTo(ITEMS.squirrelSpin, 1);
    expect(second.kart.spinTime).toBe(0);
    expect(race.items).toHaveLength(0);
  });

  it('lancé par le premier, vise le deuxième', () => {
    const { track, race } = squirrelRace(3);
    const [leader, second] = race.racers;
    leader.items = ['squirrel'];
    const { events, emit } = recorder();
    useItem(race, leader, track, false, emit);
    stepUntil(race, track, emit, 900, () => hits(events).length > 0);
    // Le deuxième est 60 m derrière : l'écureuil fait demi-tour au lieu de refaire un tour.
    expect(hits(events)[0].racerId).toBe(second.id);
  });

  it('le super-collier protège : l’écureuil disparaît sans effet', () => {
    const { track, race } = squirrelRace(3);
    const [leader, , thrower] = race.racers;
    leader.kart.collarTime = 100;
    thrower.items = ['squirrel'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    stepUntil(race, track, emit, 600, () => race.items.length === 0);
    expect(hits(events)).toEqual([]);
    expect(leader.kart.spinTime).toBe(0);
  });

  it('change de cible si le premier franchit l’arrivée, disparaît s’il n’y a plus personne', () => {
    const { track, race } = squirrelRace(3);
    const [leader, second, thrower] = race.racers;
    thrower.items = ['squirrel'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    leader.finished = true;
    stepUntil(race, track, emit, 900, () => hits(events).length > 0);
    expect(hits(events)[0].racerId).toBe(second.id);

    const solo = squirrelRace(2);
    const [finished, owner] = solo.race.racers;
    finished.finished = true;
    owner.items = ['squirrel'];
    useItem(solo.race, owner, solo.track, false, () => undefined);
    stepUntil(solo.race, solo.track, () => undefined, 30, () => false);
    expect(solo.race.items).toHaveLength(0);
  });
```

`item-rules.spec.ts` : `itemWeights(r, 8).squirrel` vaut 0 pour r = 1, 2, 3, et 10 pour r = 8 ; au
rang 1, les quatre nouveaux objets ont un poids nul.
`ai-controller.spec.ts` : écureuil lancé entre 0,5 et 2 s au rang 4 ; gardé au rang 1.
`format.spec.ts` : « Écureuil » / « Fonce sur le premier ».

- [ ] **Étape 2 : types, constantes, tirage**

`ItemKind` += `| 'squirrel'` (il devient un `ItemEntityKind`). `ITEMS` : `squirrelSpeed: 90,
squirrelLife: 20, squirrelSpin: 1.5, /** Écart d'abscisse (m) auquel l'écureuil attrape sa cible. */ squirrelCatch: 1.5,`.
`ITEM_KINDS` += `'squirrel'` ; `WEIGHT_TABLE.squirrel = [0, 2, 10]` ; à la fin de `itemWeights` :
`if (rank <= 3) weights.squirrel = 0;` (jamais pour les trois premiers).

- [ ] **Étape 3 : comportement** (`item-system.ts`)

```ts
/** Rapprochement latéral de l'écureuil vers sa cible sur ses derniers mètres (1/s) et distance (m). */
const SQUIRREL_HOMING_RATE = 6;
const SQUIRREL_HOMING_DISTANCE = 20;

/** Cible de l'écureuil : le premier encore en course, ou le deuxième si c'est le lanceur. */
function squirrelTarget(race: RaceState, ownerId: number): RacerState | null {
  const running = race.racers.filter((racer) => !racer.finished).sort((a, b) => a.rank - b.rank);
  return running.find((racer) => racer.id !== ownerId) ?? null;
}

/** Distance (m) le long du circuit, vers l'avant, de l'abscisse s jusqu'à l'échantillon `index`. */
function aheadGap(track: TrackQuery, s: number, index: number): number {
  const delta = track.samples[index].s - s;
  return ((delta % track.length) + track.length) % track.length;
}

/**
 * L'écureuil suit la ligne médiane par son abscisse, par le plus court chemin (vers l'avant ou vers
 * l'arrière), sans rebond ni haie, et rejoint le couloir de sa cible sur ses derniers mètres.
 */
function moveSquirrel(entity: ItemEntity, race: RaceState, track: TrackQuery, dt: number): void {
  const target = squirrelTarget(race, entity.ownerId);
  entity.targetId = target?.id ?? null;
  if (target === null) {
    entity.life = 0;
    return;
  }
  const here = track.project(entity.position, entity.trackIndex);
  const forward = aheadGap(track, here.s, target.kart.trackIndex);
  const direction = forward <= track.length / 2 ? 1 : -1;
  const remaining = Math.min(forward, track.length - forward);
  const s = here.s + direction * ITEMS.squirrelSpeed * dt;
  const near = remaining < SQUIRREL_HOMING_DISTANCE;
  const aim = near ? target.kart.lateral : 0;
  const lateral = here.lateral + (aim - here.lateral) * Math.min(1, (near ? SQUIRREL_HOMING_RATE : 1) * dt);
  const sample = track.sampleAt(s);
  entity.position = addScaled(sample.position, sample.left, lateral);
  entity.heading = headingOf(sample.tangent) + (direction < 0 ? Math.PI : 0);
  entity.trackIndex = track.project(entity.position, here.index).index;
  entity.height = track.surfaceAt(s, lateral).height;
}

/** L'écureuil attrape sa cible quand leurs abscisses se rejoignent (le super-collier protège). */
function collideSquirrels(race: RaceState, track: TrackQuery, emit: EmitEvent): void {
  for (const entity of race.items) {
    if (entity.kind !== 'squirrel' || entity.life <= 0 || entity.targetId === null) continue;
    const target = race.racers.find((racer) => racer.id === entity.targetId);
    if (!target) continue;
    const here = track.project(entity.position, entity.trackIndex);
    const gap = aheadGap(track, here.s, target.kart.trackIndex);
    if (gap > ITEMS.squirrelCatch && gap < track.length - ITEMS.squirrelCatch) continue;
    entity.life = 0;
    if (target.kart.collarTime > 0) continue;
    applySpinOut(target.kart);
    target.kart.spinTime = ITEMS.squirrelSpin;
    target.hitImmunity = ITEMS.hitImmunity;
    emit({ type: 'hit', racerId: target.id, by: 'squirrel', ownerId: entity.ownerId });
  }
}
```

- `ENTITY_LIFE.squirrel = ITEMS.squirrelLife` ; `moveEntities` :
  `else if (entity.kind === 'squirrel') moveSquirrel(entity, race, track, dt);` ;
  `stepItems` : `collideSquirrels(race, track, emit);` juste après `moveEntities(...)`.
- `collideWithRacers` et `collideProjectilesWithMud` : ignorer `entity.kind === 'squirrel'` (il ne
  touche que sa cible et passe sur la boue).
- `useItem` :

```ts
    case 'squirrel': {
      const target = squirrelTarget(race, racer.id);
      spawnEntity(race, racer, track, 'squirrel', ahead(throwDistance), kart.heading, ITEMS.squirrelSpeed, target?.id ?? null);
      break;
    }
```

- [ ] **Étape 4 : modèle, IA, icône, nom**

- `item-visuals.ts` : géométrie et matériau `squirrel` dans les tables existantes (construire
  comme celles de l'os) : corps `SphereGeometry(0.28, 10, 8)` étiré `.scale(1, 0.85, 1.4)`, tête
  `SphereGeometry(0.18, 10, 8)` en `(0, 0.2, 0.32)`, queue en panache `SphereGeometry(0.26, 10, 8)`
  `.scale(0.8, 1.6, 0.8)` en `(0, 0.38, -0.3)`, couleur `#9a5b2e` (fusionner avec la fonction de
  fusion déjà utilisée pour l'os, ou `paintedGeometry`) ; `update` :
  `case 'squirrel': object.position.y = entity.height + 0.3 + Math.abs(Math.sin(visual.age * 18)) * 0.12; object.rotation.y = entity.heading; break;`.
- IA : `case 'squirrel': return waited && racer.rank > 1;` ; délai `this.rng.range(0.5, 2)`.
- `item-icon.ts` : écureuil (`<ellipse cx="20" cy="30" rx="9" ry="8" fill="#9a5b2e" /><circle cx="27" cy="21" r="5.5" fill="#9a5b2e" /><path d="M13 32 Q3 20 12 9 Q20 5 19 16 Q16 22 17 28 Z" fill="#c07a3e" stroke="#5c3310" stroke-width="1.5" /><circle cx="29" cy="20" r="1.2" fill="#1b1b1b" />`).
- `format.ts` : « Écureuil » / « Fonce sur le premier ».

- [ ] **Étape 5 : toute la suite, commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write src/game src/app
git add -A src
git commit -m "Nouveau cadeau : écureuil"
```

---

### Tâche 9 : documentation, version et journal

**Fichiers :** `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`.

- [ ] **Étape 1 : README**

- Tableau des objets : « 8 objets canins », avec les quatre nouveaux (écureuil : fonce sur le
  premier et le fait tourner ; os en or : turbo à chaque appui pendant 7 s ; sifflet : arrête net les
  chiens devant ; super-collier : invincible 6 s, plus rapide, bouscule les karts).
- Ajouter : « **Deux objets** : une boîte remplit la première case libre ; « Objet » utilise toujours
  le premier, le second avance. » et « **Aspiration** : rouler dans le sillage d'un concurrent remplit
  une jauge (traînées de vent), puis donne un turbo. »

- [ ] **Étape 2 : version et journal**

```bash
npm run release:minor   # 0.6.0 → 0.7.0
```

En tête de `CHANGELOG.md` :

```markdown
## [0.7.0] – JJ/MM/AAAA

- Ajout : aspiration, un turbo en roulant dans le sillage d'un concurrent.
- Ajout : deux objets en réserve.
- Ajout : cadeaux Écureuil, Os en or, Sifflet et Super-collier.
```

- [ ] **Étape 3 : vérification finale, commit**

```bash
npx ng build && npx ng test --watch=false
npx prettier --write README.md CHANGELOG.md
git add README.md CHANGELOG.md package.json package-lock.json
git commit -m "Documentation des nouveaux cadeaux et de l'aspiration (v0.7.0)"
```
