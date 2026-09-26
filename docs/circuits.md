# Circuits : fonctionnement et ajout d'un circuit

## Le principe, en termes d'application de gestion

| Jeu                                         | Équivalent « appli de gestion »                           | Fichier                             |
| ------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Définition d'un circuit (`TrackDefinition`) | un enregistrement : données pures, sérialisables en JSON  | `src/game/track/circuits/*.ts`      |
| Catalogue (`TRACK_CATALOG`)                 | la table / le référentiel des circuits                    | `src/game/track/catalog.ts`         |
| Validateur (`validateTrack`)                | les règles métier, vérifiées à chaque build par les tests | `src/game/track/track-validator.ts` |
| Course d'IA du catalogue                    | un test d'intégration par enregistrement                  | `src/game/track/catalog.spec.ts`    |
| Thème (`theme`)                             | le « rendu » : couleurs, décor, ciel (code, pas données)  | `src/game/render/`                  |

Une définition ne contient **aucun code** : un identifiant, un nom, une description, un thème, des
points de contrôle et des indications de décor. Elle pourrait donc demain venir d'un fichier JSON ou
d'une API sans changer le moteur.

Le reste est **générique** : à partir des points de contrôle, le moteur calcule la piste (spline
Catmull-Rom), les murs, la grille de départ, les rangées de boîtes d'objets, la trajectoire des IA,
la mini-carte, l'aperçu de l'écran de choix et le décor (haies, arbres, fleurs…).

## Ajouter un circuit

1. **Créer** `src/game/track/circuits/<id>.ts`, sur le modèle de `potager.ts` :
   - `controlPoints` : la ligne médiane de la piste, en mètres (x vers la droite, z vers le bas de la
     mini-carte). Le point 0 est sur la ligne de départ et la course suit les indices croissants. Pour
     un virage régulier, placer un point tous les 15 à 20° de l'arc ; pour une ligne droite, deux
     points à 5 m de chaque extrémité.
   - `decor.landmarks` : les pièces uniques (niche, gamelle, arrosoir, arroseur, os géant, nains), à
     placer hors de la piste (sinon le décor les décale au plus près).
   - `decor.path` : un chemin de pierres (facultatif).
2. **Inscrire** le circuit dans `TRACK_CATALOG` (`catalog.ts`). Il apparaît alors dans l'écran
   « Circuits ».
3. **Lancer les tests** (`npm test`). Le catalogue vérifie automatiquement, pour chaque circuit :
   - les règles communes de `validateTrack` : longueur de 500 à 1 400 m, une seule boucle, rayon de
     virage d'au moins 16 m, ligne droite de 60 m avant et 40 m après le départ, 27 m minimum entre
     deux portions éloignées de la piste, circuit contenu dans ±230 m, 3 rangées de boîtes espacées ;
   - une course complète de 8 IA : tout le monde finit, entre 20 et 70 s au tour, sans traverser
     les murs ;
   - que la définition passe telle quelle en JSON.

   Chaque règle non respectée produit un message en français (« Virage trop serré : rayon 12,0 m < 16 m »).

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
