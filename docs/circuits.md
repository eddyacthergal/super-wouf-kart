# Circuits : fonctionnement et ajout d'un circuit

## Le principe, en termes d'application de gestion

| Jeu                                         | Équivalent « appli de gestion »                           | Fichier                              |
| ------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| Définition d'un circuit (`TrackDefinition`) | un enregistrement : données pures, en JSON                | `src/game/track/circuits/*.json`     |
| Lecteur (`parseCircuit`)                    | le contrôle de saisie à l'import                          | `src/game/track/circuit-loader.ts`   |
| Schéma d'édition (`circuit.schema.json`)    | la validation dans l'éditeur (VS Code, JSON Schema)       | `src/game/track/circuit.schema.json` |
| Catalogue (`TRACK_CATALOG`)                 | la table / le référentiel des circuits                    | `src/game/track/catalog.ts`          |
| Validateur (`validateTrack`)                | les règles métier, vérifiées à chaque build par les tests | `src/game/track/track-validator.ts`  |
| Course d'IA du catalogue                    | un test d'intégration par enregistrement                  | `src/game/track/catalog.spec.ts`     |
| Thème (`theme`)                             | le « rendu » : couleurs, décor, ciel (code, pas données)  | `src/game/render/`                   |

Une définition ne contient **aucun code** : un identifiant, un nom, une description, un thème, une
ligne de départ, une liste de coins (position, rayon, altitude, dévers) et des indications de décor.
Elle vient telle quelle d'un fichier JSON du dépôt (`circuits/<id>.json`), intégré au build (pas de
chargement à l'exécution) et contrôlé par `parseCircuit`. Le type qui la porte garde son nom
historique, `TrackDefinition`.

Le reste est **générique**, en trois étapes sans aucune dépendance à three.js :

1. `circuit-loader.ts` (`parseCircuit`) contrôle les champs du JSON, puis appelle `centerline.ts`
   pour contrôler la géométrie (rayons qui tiennent, repères alignés, départ bien placé). Toute une
   liste de problèmes est levée d'un coup, en français, dans une `CircuitError`.
2. `centerline.ts` (`buildCenterline`) transforme les coins en un enchaînement exact de droites et
   d'arcs de cercle, puis en une ligne médiane dense (un point tous les 0,25 m), en retenant
   l'abscisse du départ et de chaque coin.
3. `profile.ts` (`buildProfile`) calcule, à partir des `y` et `bank` des coins, l'altitude, la pente
   et le dévers en fonction de l'abscisse.

`Track` (`track.ts`) réunit la ligne médiane et le profil en une piste échantillonnée tous les
mètres environ (murs, grille de départ, rangées de boîtes d'objets, trajectoire des IA, mini-carte,
aperçu de l'écran de choix et décor en dérivent). `surfaceAt(s, lateral)` (`surface.ts`) donne la
hauteur et la pente du sol de la piste en un point quelconque, haies comprises.

Les cinq circuits du catalogue (Grand Jardin, Potager, Parc enneigé, Plage au couchant, La Colline)
ont tous du relief : altitude et virages relevés, dans l'esprit propre à chacun (vallon et épingle
en hauteur, bosse et plongée, piste de luge, dunes en bord de mer…). Aucun n'est plat.

## Le format JSON d'un circuit

```jsonc
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
    { "x": 120, "z": -20, "radius": 25, "y": 3 },
    { "x": 90, "z": -80, "radius": 25, "y": 0 },
  ],
  "decor": { "landmarks": [{ "kind": "doghouse", "x": -60, "z": 25, "radius": 5.5 }] },
}
```

| Champ                       | Règle                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `description` | identifiant (minuscules et tirets), nom et phrase de l'écran de choix                                                                                                                    |
| `theme`                     | `garden`, `snow` ou `beach`                                                                                                                                                              |
| `laps`                      | facultatif, 1 à 9 tours (par défaut `RACE_LAPS`, 3)                                                                                                                                      |
| `start`                     | point sur la droite qui va du dernier coin au premier : ligne de départ et grille                                                                                                        |
| `corners`                   | polygone fermé, dans l'ordre de course, au moins 3 coins                                                                                                                                 |
| `corners[].radius`          | (m) le coin devient un arc tangent aux deux droites voisines                                                                                                                             |
| coin sans `radius`          | repère d'altitude sur une droite ; refusé si la ligne y fait un angle de plus de 1°                                                                                                      |
| `corners[].y`               | (m, 0 à 25) altitude au sommet de l'arc ou au repère ; interpolée entre les repères voisins sur un coin sans `y`. Aucun `y` sur le circuit : circuit plat ; un seul : altitude constante |
| `corners[].bank`            | (°, 0 à 20) dévers vers l'intérieur du virage, facultatif, uniquement sur un coin avec rayon                                                                                             |
| `decor.landmarks`           | pièces uniques (niche, gamelle, arrosoir…) : `kind`, position et encombrement (`radius`)                                                                                                 |
| `decor.path`                | chemin de pierres facultatif, entre deux points                                                                                                                                          |

Un virage de plus de 150° se décrit avec **deux coins successifs** (au-delà, la géométrie devient
ambiguë). Le champ `$schema` sert uniquement à la complétion et à la validation dans l'éditeur ; il
est ignoré par le loader.

## Ajouter un circuit

1. **Copier** `src/game/track/circuits/colline.json` vers `<id>.json`, et dessiner le polygone sur
   papier quadrillé (x vers la droite, z vers le bas, comme sur la mini-carte) :
   - un point par coin, avec son rayon (m), sauf pour un simple repère d'altitude sur une ligne
     droite ;
   - un virage de plus de 150° : deux coins ;
   - `start` sur la droite qui va du dernier coin au premier ;
   - `y` sur les coins qui doivent porter une altitude (les autres sont interpolés) ;
   - `bank` sur les virages qu'on veut relevés (seulement sur un coin à rayon).
   - `decor.landmarks` : à placer hors de la piste (sinon le décor les décale au plus près).
2. **Inscrire** le circuit dans `TRACK_CATALOG` (`catalog.ts`) : importer le fichier JSON et
   l'ajouter à la liste passée à `parseCircuit`. Il apparaît alors dans l'écran « Circuits ».
3. **Lancer les tests** (`npm test`). Le catalogue vérifie automatiquement, pour chaque circuit :
   - le loader, dès l'import (types, géométrie qui tient) ;
   - les règles communes de `validateTrack` (voir tableau plus bas) ;
   - une course complète de 8 IA : tout le monde finit, entre 20 et 70 s au tour, sans traverser
     les murs ;
   - un tour au clavier avec l'assistance au dérapage (`keyboard-drift.spec.ts`) : au moins 5
     dérapages par tour, sans choc, sans contresens ni sortie de piste, et plus vite que sans
     déraper — prévoir au moins 5 vrais virages ;
   - que le circuit a du relief : au moins 5 m de dénivelé et un virage relevé ;
   - que la définition passe telle quelle en JSON.

## Messages du loader et du validateur

Chaque problème est signalé en français ; le loader les liste tous d'un coup dans une seule
`CircuitError`, préfixée par l'identifiant du circuit.

- Une faute de frappe dans un champ (le loader refuse tout champ inconnu, en nommant le coin) :
  `Coin 3 : champ inconnu « radious ».`
- Une géométrie impossible (rayons qui ne tiennent pas entre deux coins voisins) :
  `Coins 2 et 4 : rayons trop grands, il faudrait 48.0 m entre eux, il y en a 41.0.`

Le validateur (`validateTrack`), lui, mesure le tracé échantillonné et compare à `TRACK_RULES` :

- `Virage trop serré : rayon 12.0 m < 16 m.`
- `Pente trop forte : 24.3 % > 20 %.`

## Les règles (`TRACK_RULES`)

Règles déjà présentes avant le format JSON, sur le tracé en 2D :

| Règle                                           | Valeur                                    |
| ----------------------------------------------- | ----------------------------------------- |
| Longueur d'un tour                              | 500 à 1 400 m                             |
| Une seule boucle                                | le cap tourne d'exactement ±360°          |
| Rayon de virage minimal                         | 16 m                                      |
| Ligne droite au départ                          | 60 m avant, 40 m après                    |
| Écart entre deux portions éloignées de la piste | au moins 27 m (`2 × WALL_HALF_WIDTH + 6`) |
| Emprise du circuit                              | dans ±230 m                               |
| Rangées de boîtes d'objets                      | 3 minimum, espacées d'au moins 100 m      |

Nouvelles règles, apportées par le relief :

| Règle                     | Valeur                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `maxGrade`                | 20 % (au-delà, la côte bloque et la descente jette dans les haies)                               |
| `maxBank`                 | 20°                                                                                              |
| `minHeight` / `maxHeight` | 0 à 25 m (le sol de base est à 0, le brouillard cache au-delà)                                   |
| `startMaxGrade`           | 2 % sur les 60 m avant et 40 m après le départ (la grille reste à plat)                          |
| `minCrestRadius`          | 40 m de rayon vertical à un sommet de côte (pas de décollage, tant que les sauts n'existent pas) |

Chaque règle non respectée produit un message en français nommant la valeur mesurée et la limite
(voir ci-dessus).

## Relief

Les coins `y` et `bank` ne changent pas que le décor : ils changent la conduite.

- **Pente** (`stepSpeed`, `kart-physics.ts`) : la vitesse maximale effective est réduite en montée
  et augmentée en descente, d'une fraction de la pente (`PHYSICS.slopeSpeedFactor`) ; une
  accélération constante (`PHYSICS.slopeGravity`) s'ajoute à chaque pas, dans le même sens.
  L'un et l'autre sont amplifiés par le poids du kart : plus il est lourd que la masse d'une race
  moyenne (3 points de poids), plus il prend d'élan en descente et peine en montée
  (`PHYSICS.slopeWeightInfluence`) ; un kart léger est moins affecté.
- **Virages relevés** (`bankGripFactor`, `kart-physics.ts`) : en tournant vers le côté bas d'un
  virage relevé, le taux de braquage augmente avec le dévers (`PHYSICS.bankGrip`) — le kart mord
  mieux dans un virage relevé qu'à plat.
- **Le sol autour de la piste** (`terrain.ts`) : entre les haies, il suit exactement la surface de
  la piste (légèrement en dessous, pour le maillage). Au-delà, c'est un mélange des portions de
  piste proches, pondéré par la distance, qui redescend au niveau 0 sur 40 m (`TERRAIN_FADE`). Sur
  un circuit plat, ce calcul est sauté entièrement (`FLAT_TERRAIN`) : aucun maillage de relief n'est
  construit, comme avant le format JSON.
- Décor, haies, karts (hauteur, tangage, roulis) et caméra suivent ce relief ; la mer d'un circuit
  plage reste, elle, au niveau 0.

## Thèmes

Trois thèmes existent : `garden` (jardin d'été), `snow` (parc enneigé) et `beach` (plage au
couchant). Un thème regroupe le rendu, sans toucher à la conduite :

- l'**ambiance** (`SceneTheme`, `src/game/render/themes.ts`) : ciel, soleil, brouillard, lumière, nuages ;
- le **monde** (`OutdoorStyle`, `src/game/render/garden-world.ts`) : couleurs du sol, de la piste,
  des bordures et du décor, recette du décor (quels objets semer autour de la piste) ;
- les **extras** propres au thème : neige qui tombe (`snow-park.ts`), mer, palmiers et animaux
  (`beach-world.ts`, `beach-animals.ts`).

Ajouter un thème : un style et une ambiance, puis une entrée dans `SCENE_THEMES` et un nom dans
`TrackThemeId`. `themes.spec.ts` construit et anime le monde de chaque circuit du catalogue et
échoue à la moindre erreur three.js.
