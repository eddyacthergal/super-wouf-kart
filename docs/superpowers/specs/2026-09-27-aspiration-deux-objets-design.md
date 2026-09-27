# Aspiration, deux emplacements d'objets et quatre nouveaux cadeaux

## Objectif

- Rouler juste derrière un concurrent donne un turbo, comme dans Mario Kart.
- Chaque pilote peut garder **deux** objets, en file d'attente, sans nouvelle commande.
- Quatre nouveaux cadeaux : écureuil, os en or, sifflet, super-collier.
- Les règles valent pour tous les pilotes (joueur et IA).

## 1. Aspiration

Module `src/game/race/slipstream.ts`, appelé par `RaceSimulation` à chaque pas, après `stepKart` de
tous les pilotes et avant les collisions entre karts.

- **Condition** (évaluée pour chaque pilote en phase `racing`, hors tête-à-queue et hors arrêt de
  sifflet) : il existe un autre kart
  - à une distance de 3 à 14 m devant lui (distance entre centres) ;
  - dans un cône de ±12° autour de son cap ;
  - et le pilote roule à au moins 60 % de sa vitesse max (`tuning.maxSpeed`).
- **Jauge** `KartState.slipstream` (0 à 1) : +1/1,2 par seconde tant que la condition tient,
  −2/1,2 par seconde sinon (bornée à [0, 1]).
- **Déclenchement** : quand la jauge atteint 1, `applyBoost(kart, 1.0, 1.2)`, jauge remise à 0,
  événement `boost` de source `'slipstream'`.
- **Constantes** dans `SLIPSTREAM` (`constants.ts`) : `minDistance: 3`, `maxDistance: 14`,
  `halfAngle: 12°`, `minSpeedRatio: 0.6`, `chargeTime: 1.2`, `decayFactor: 2`, `boostDuration: 1.0`,
  `boostStrength: 1.2`.
- **Rendu** : traînées de vent blanches autour du kart tant que la jauge est > 0 (effets) ; le
  turbo réutilise flammes, champ de vision élargi et moteur plus aigu (déjà liés à `boostTime`).
- **HUD** : libellé « Aspiration ! » tant que la jauge du joueur est > 0.
- **Son** : `boostRush` accepte la source `'slipstream'` (souffle léger).
- L'événement `boost` voit son champ `tier` devenir facultatif pour les sources autres que `'drift'`.

## 2. Deux emplacements en file d'attente

- `RacerState.item: ItemKind | null` devient `RacerState.items: ItemKind[]` (au plus 2,
  `ITEMS.maxHeld = 2`). `itemRoulette > 0` signifie que le **dernier** objet de la liste est encore
  en roulette.
- **Boîte** : un pilote la ramasse si `items.length < 2` et `itemRoulette <= 0` ; l'objet tiré est
  ajouté en fin de liste et sa roulette démarre.
- **Utilisation** (« Objet ») : utilise `items[0]`, sauf si c'est le seul objet et qu'il est en
  roulette. Pendant la roulette du second, le premier reste utilisable. Après usage, le second
  devient le premier.
- Événements : `item-ready` et `item-use` inchangés (un objet à la fois).
- **HUD** : `HudSnapshot.items: ItemKind[]`, `rollingSlot: 0 | 1 | null`, `goldenBoneTime` (s) et
  `slipstreaming` (jauge > 0) ; `hud-item` affiche une
  grande case (objet suivant, nom et aide) et une petite case (réserve) ; la roulette tourne dans
  la case concernée.
- **IA** : `updateItems` raisonne sur `items[0]` (s'il est utilisable) ; un nouveau délai est tiré
  quand le premier objet change.

## 3. Nouveaux cadeaux

`ItemKind` gagne `'squirrel' | 'golden-bone' | 'whistle' | 'super-collar'` ; `ItemEntityKind` gagne
`'squirrel'` (seul nouvel objet qui existe sur la piste). L'événement `hit` accepte
`by: 'squirrel' | 'super-collar'` en plus des projectiles actuels, et un nouvel événement
`{ type: 'stun'; racerId }` signale l'arrêt dû au sifflet.

### Écureuil
- Cible : le pilote en tête (rang 1) ; si c'est le lanceur, le 2ᵉ. Cible réévaluée à chaque pas.
- Déplacement : suit la ligne médiane de la piste par son abscisse (60 m/s), sans rebond ni
  collision avec les haies ni avec les autres karts ; latéral qui rejoint celui de la cible sur les
  20 derniers mètres ; hauteur de la piste.
- Impact : à moins de 2 m de la cible → tête-à-queue de 1,5 s (`ITEMS.squirrelSpin`), événement
  `hit` `by: 'squirrel'` ; l'écureuil disparaît. Durée de vie maximale 12 s.
- Protection : super-collier seulement (l'immunité après un choc ne le bloque pas).
- Rendu : petit écureuil (corps brun, queue en panache) qui court ; icône HUD.

### Os en or
- Au premier appui, démarre un compte à rebours de 7 s (`RacerState.goldenBoneTime`) et donne un
  turbo ; chaque appui suivant pendant ces 7 s redonne un turbo (`applyBoost(1.0, 1.3)`, événement
  `boost` source `'item'`).
- L'os en or reste dans la première case pendant les 7 s, puis disparaît (la réserve avance).
- HUD : la case affiche le temps restant (barre qui se vide).

### Sifflet
- Instantané : chaque pilote classé devant le lanceur (rang meilleur) s'arrête net pendant 1 s
  (`KartState.stunTime`, `ITEMS.whistleStun = 1`) : pas de gaz ni de braquage, décélération forte
  vers 0 (30 m/s²), dérapage annulé, turbo conservé. Événement `stun` pour chacun.
- Protection : super-collier seulement.
- Rendu : note de musique au-dessus des chiens arrêtés ; son de sifflet à l'usage.

### Super-collier
- 6 s (`KartState.collarTime`, `ITEMS.collarDuration = 6`) : vitesse max ×1,15, pas de
  ralentissement sur le bas-côté, insensible aux os, balles, flaques, écureuil et sifflet.
- Choc avec un autre kart sans collier : l'autre part en tête-à-queue (`applySpinOut`), événement
  `hit` `by: 'super-collar'` ; le porteur ne ralentit pas.
- Rendu : halo doré qui tourne autour du kart ; son à l'activation.

### Tirage selon le classement (`item-rules.ts`)

Poids aux fractions de classement 0 (premier), 0,5 et 1 (dernier) :

| Objet | 0 | 0,5 | 1 |
|---|---|---|---|
| os | 40 | 25 | 10 |
| flaque | 40 | 15 | 5 |
| balle de tennis | 5 | 20 | 20 |
| croquette turbo | 10 | 20 | 15 |
| os en or | 0 | 10 | 15 |
| sifflet | 0 | 3 | 8 |
| super-collier | 0 | 5 | 12 |
| écureuil | 0 | 2 | 10 |

L'écureuil n'est jamais tiré par les 3 premiers (poids forcé à 0 pour les rangs 1 à 3).

### IA
- Écureuil : lancé après 0,5 à 2 s si l'IA n'est pas première.
- Os en or : activé en ligne droite, puis un appui toutes les 0,5 à 0,8 s en ligne droite.
- Sifflet : utilisé après 0,3 à 1 s si l'IA n'est pas première.
- Super-collier : utilisé après 0,5 à 1,5 s.

### Commun à chaque objet
Icône (`item-icon.ts`), nom et aide (`format.ts`), bande de roulette (`hud-item.ts`), règle d'IA,
tests. Sons propres : sifflet et super-collier ; les autres gardent les sons génériques.

## Tests

- Aspiration : charge dans le cône et la distance, pas hors cône / trop loin / trop près / trop
  lent, décroissance, turbo au plein, pour l'IA comme le joueur.
- File : ramassage d'un second objet, refus d'un troisième, usage du premier pendant la roulette
  du second, le second avance après usage, HUD à deux cases.
- Chaque nouvel objet : effet, cible, protection par le collier, fin de durée ; tirage (écureuil
  impossible pour les 3 premiers ; le premier n'a que les 4 anciens objets).
- IA : usage de chaque nouvel objet ; la course de 8 IA sur chaque circuit reste entre 20 et 70 s
  au tour et tout le monde finit.

## Documentation et version

README : tableau des 8 objets, paragraphe sur l'aspiration et les deux emplacements.
`npm run release:minor` (0.6.0 → 0.7.0) et entrée au `CHANGELOG.md`.

## Hors périmètre

- Choisir quel objet utiliser (touche d'échange), tenir un objet derrière soi comme bouclier.
- Objets en triple (trois os d'un coup).
- Aspiration visible sur la mini-carte.
