# Format de circuit JSON et relief (côtes, descentes, virages relevés)

Spec 1 sur 2. La spec 2 (tremplins et sauts, état « en l'air ») viendra après ; les ponts sont hors périmètre.

## Objectif

- Créer un circuit en écrivant un fichier JSON lisible, sans calculer d'arcs de cercle à la main.
- Ajouter du relief qui compte dans la conduite : côtes, faux plats, descentes, virages relevés.
- Les circuits restent des fichiers du dépôt, intégrés au build (pas de chargement à l'exécution).

## Constat de départ

- Les définitions sont déjà des données pures et un lecteur universel (`Track`) dérive tout du tracé.
- Le frein à la création : `controlPoints` contient des points d'arcs calculés à la main
  (`{ x: -69.8, z: 80.3 }`), et il faut refermer la boucle soi-même.
- La simulation est 2D par conception (`vec2.ts`) ; la hauteur n'existe que dans le rendu, à y fixe.

## 1. Format de fichier

Un fichier par circuit : `src/game/track/circuits/<id>.json`, validé dans l'éditeur par
`src/game/track/circuit.schema.json` (champ `$schema`).

```jsonc
{
  "$schema": "../circuit.schema.json",
  "id": "colline",
  "name": "La Colline",
  "description": "Une montée raide vers la niche, puis la grande descente.",
  "theme": "garden",
  "laps": 3,
  "start": { "x": -17, "z": -90 },
  "corners": [
    { "x": -112, "z": -90, "radius": 35, "y": 0 },
    { "x": -112, "z": -40, "y": 6 },
    { "x": -112, "z": 10, "radius": 22, "y": 6, "bank": 12 },
    { "x": 90, "z": 10, "radius": 30, "bank": 8 },
    { "x": 90, "z": -90, "radius": 30, "y": 0 },
  ],
  "decor": { "landmarks": [{ "kind": "doghouse", "x": -60, "z": -40, "radius": 5.5 }] },
}
```

Lecture : départ vers l'ouest sur la droite z = -90, virage 1 à plat, montée de 6 m jusqu'au virage 2
relevé, descente sur le virage 3 relevé, retour à plat avant le virage 4 et la ligne droite de départ.

| Champ                                                 | Règle                                                                                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `description`, `theme`, `laps`, `decor` | inchangés par rapport à `TrackDefinition`                                                                                                                                                           |
| `corners`                                             | polygone fermé, dans l'ordre de course, au moins 3 coins avec rayon                                                                                                                                 |
| `corners[].radius`                                    | (m) le coin devient un arc tangent aux deux droites voisines                                                                                                                                        |
| coin sans `radius`                                    | repère d'altitude sur une droite ; refusé si la ligne y fait un angle de plus de 1°                                                                                                                 |
| `corners[].y`                                         | (m) altitude au sommet de l'arc ou au repère. Un coin sans `y` n'est pas un repère : son altitude est interpolée entre les repères voisins. Aucun `y` : circuit plat ; un seul : altitude constante |
| `corners[].bank`                                      | (°) dévers vers l'intérieur du virage, facultatif, uniquement sur un coin avec rayon                                                                                                                |
| `start`                                               | point sur la droite qui arrive au premier coin : ligne de départ et grille                                                                                                                          |

`controlPoints` disparaît ; `TrackDefinition` est remplacé par ce format (type `CircuitDefinition`).

## 2. Du fichier à la piste (`src/game/track/`, sans three.js)

- `circuit-loader.ts` : contrôle le JSON et renvoie une définition valide ou une liste d'erreurs en
  français, par exemple « Coin 3 : rayon 35 m trop grand, il faudrait 48 m entre les coins 2 et 4, il y
  en a 41 ». Contrôles : types, rayon qui tient entre ses voisins (les deux arcs qui se partagent une
  droite ne se chevauchent pas), repères alignés, départ sur la bonne droite.
- `centerline.ts` : coins et rayons → enchaînement exact de droites et d'arcs → ligne médiane dense
  (pas de 0,25 m), avec l'abscisse du départ, du sommet de chaque arc et de chaque repère. L'abscisse 0
  est au point `start`.
- `profile.ts` :
  - altitude : interpolation cubique monotone (Fritsch-Carlson), périodique sur le tour : pas de palier
    à chaque repère, pas de bosse entre deux repères de même altitude ;
  - dévers : valeur pleine sur l'arc, rampe linéaire sur 15 m avant et après.
- `Track` : construit depuis la ligne médiane et le profil (la spline Catmull-Rom disparaît).
  - `TrackSample` gagne `height` (m), `grade` (pente, sans unité) et `bank` (rad).
  - Nouveau `surfaceAt(s, lateral)` → `{ height, pitch, roll }` ; le dévers relève le bord extérieur.
  - `project()`, `sampleAt()`, `gridSlot()` gardent leur signature.
- `terrain.ts` : hauteur du sol en (x, z) pour le rendu. Entre les haies : juste sous la route.
  Au-delà : moyenne des hauteurs des portions proches, pondérée par la distance, qui redescend au
  niveau 0 sur 40 m.
- `catalog.ts` : importe les `.json` en statique (`resolveJsonModule` est déjà actif) et les passe au
  loader ; un fichier invalide fait échouer les tests du catalogue avec les messages du loader.

### Nouvelles règles du validateur (`TRACK_RULES`)

| Règle                     | Valeur initiale                                                      |
| ------------------------- | -------------------------------------------------------------------- |
| `maxGrade`                | 20 %                                                                 |
| `maxBank`                 | 20°                                                                  |
| `minHeight` / `maxHeight` | 0 / 25 m                                                             |
| `startMaxGrade`           | 2 % sur les ±60 m du départ                                          |
| `minCrestRadius`          | 40 m (rayon vertical des sommets, tant que les sauts n'existent pas) |

Les règles actuelles restent (longueur, rayon mini, lignes droites du départ, écart entre portions,
emprise, rangées de boîtes).

## 3. Physique, IA, objets

- `stepSpeed` (`kart-physics.ts`) : terme `-slopeGravity · pente` appliqué à chaque pas, la pente étant
  mesurée dans la direction du cap (pente de la piste et dévers compris).
  - En montée l'équilibre s'établit sous la vitesse max ; en descente au-dessus, freiné par
    `OVERSPEED_DECELERATION`.
  - Poids : gravité × (1 + `slopeWeightInfluence` · écart), avec
    `écart = (masse − masse moyenne des races) / masse moyenne`, en montée comme en descente : un
    lourd prend plus d'élan en descente et ralentit plus en montée.
- Dévers : en tournant vers l'intérieur d'un virage relevé, taux de braquage × (1 + `bankGrip` · dévers).
- `KartState` gagne `height`, `pitch`, `roll`, `prevHeight`, `prevPitch`, `prevRoll`, calculés depuis
  la projection déjà faite dans `collideWithTrack`.
- Murs, collisions entre karts, progression et tours : inchangés (2D).
- IA : aucune logique de pente au départ ; sa fenêtre de freinage croît déjà avec la vitesse. Si le
  test de course sur circuit vallonné échoue, ajout d'une anticipation de vitesse en descente.
- Objets (os, balle, boue, boîtes) : déplacement 2D inchangé, hauteur lue par `surfaceAt`.
- Nouvelles constantes dans `PHYSICS` : `slopeGravity`, `slopeWeightInfluence`, `bankGrip`.

## 4. Rendu

- Route, bas-côtés, bordures, haies : sommets à la hauteur de `surfaceAt`.
- Sol : grille de relief (±230 m, maille ~4 m) tirée de `terrain.ts`, calculée une fois ; plate sur un
  circuit plat.
- Décor et extras de thème posés à la hauteur du relief ; la mer reste au niveau 0.
- Karts : hauteur, tangage et roulis interpolés ; l'animation du petit saut dans le modèle est inchangée.
- Caméra : hauteur et visée relatives au kart, lissées, jamais sous le relief.
- Traces de pneus, poussière, fumée, objets : posés à la hauteur de la surface ; le plancher des
  particules devient leur hauteur d'apparition.
- Mini-carte et aperçu : inchangés.
- Nettoyage : `decor-plan.ts` et `track.ts` n'importent plus le fichier de Grand Jardin directement.

## 5. Conversion, démonstration, tests, livraison

- Conversion : les 4 circuits passent au format `corners`, tracé à l'identique à quelques centimètres
  près (ils ont été construits en droites et arcs), sans relief. Coins déduits une fois par un script
  jetable (non versionné). Un test temporaire compare l'ancienne et la nouvelle ligne médiane (écart
  max 0,5 m) ; il est retiré avec les anciens points, dans la même PR.
- Démonstration : nouveau circuit « La Colline » (thème jardin) avec montée, faux plat, descente et
  deux virages relevés.
- Tests unitaires : loader (chaque erreur), centerline (arc exact, fermeture, repères), profile
  (monotonie, périodicité, rampes de dévers), `surfaceAt`, terrain, pente et poids dans `stepSpeed`.
- Tests existants conservés pour chaque circuit du catalogue : validateur, course de 8 IA entre 20 et
  70 s au tour sans franchir les murs, construction du monde de chaque thème, budget de meshes.
- Doc : `docs/circuits.md` réécrit pour le nouveau format (recette d'ajout d'un circuit).
- Version : `npm run release:minor` (0.4.1 → 0.5.0) et entrée dans `CHANGELOG.md`.

## Hors périmètre

- Ponts (tracé qui passe au-dessus de lui-même).
- Tremplins et sauts : spec 2.
- Chargement de circuits sans recompiler, éditeur visuel.
- Couleurs de l'aperçu de l'écran Circuits selon le thème (correction séparée).

## Écarts avec l'implémentation

- Le type des définitions garde son nom `TrackDefinition` (`track-definition.ts`) : pas de nouveau
  type `CircuitDefinition`, pour changer moins de fichiers.
- La « masse moyenne des races » de la section Physique est en fait une **masse de référence**
  fixe, celle d'une race à 3 points de poids (`REFERENCE_MASS`, `kart-physics.ts`), pas une moyenne
  calculée sur les races réellement en course.
- Le sol en relief (section Rendu) est un **maillage séparé** (`terrain`, ajouté dans
  `garden-world.ts` seulement quand `terrain.hilly`), distinct de la pelouse lointaine ; celle-ci est
  abaissée de 0,5 m (`LAWN_DROP`) pour se raccorder sans couture au bord du maillage de relief. Sur
  un circuit plat, ce maillage est **absent** (pas seulement plat) : rien n'est calculé ni ajouté à
  la scène (`FLAT_TERRAIN`).
- La pente ne fait pas qu'ajouter une accélération constante (`slopeGravity`) : elle réduit aussi la
  vitesse maximale effective en montée et l'augmente en descente, via `PHYSICS.slopeSpeedFactor`
  (`stepSpeed`, `kart-physics.ts`).
- Le test de « budget de meshes » cité en section 5 pour la scène n'existe pas. Il est remplacé par
  le test « circuit plat : pas de maillage de relief » (`garden-world.spec.ts`), qui vérifie
  l'absence du maillage sur un circuit sans relief et sa présence sur un circuit vallonné.
- Le bump de version (`npm run release:minor`, 0.4.1 → 0.5.0) a eu lieu avec la tâche de physique du
  relief, pas à la fin comme rangé en section 5 : la règle du dépôt (un seul bump par PR) l'imposait
  dès la première tâche qui touchait au comportement.
- Le circuit de démonstration « La Colline » a **7 coins**, pas 5 comme l'exemple de la section 1 :
  son dernier virage, proche de 90°, est scindé en deux coins de 26,6° puis 63,4°, pour que le test
  existant de dérapage au clavier (`keyboard-drift.spec.ts`) trouve au moins 5 dérapages par tour sur
  ce circuit aussi.
- `CameraTarget.y` (`camera-rig.ts`) est **facultatif**, par défaut 0 : un détail d'implémentation
  non fixé par la spec.
- La conversion des 4 circuits existants s'écarte de l'ancienne ligne médiane d'au plus **0,49 m**,
  et non de « quelques centimètres » comme annoncé en section 5 ; le seuil du plan (0,5 m) était le
  bon repère.
