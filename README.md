# Wouf Kart 🐶🏎️

Jeu de kart arcade dans le navigateur, façon Mario Kart, où tous les pilotes sont de **petits chiens**.
Des chiens miniatures font la course dans un **jardin géant** (fleurs, balles de tennis, niche et arrosoir surdimensionnés).

Construit avec **Angular 22** pour l'interface et **three.js** pour la 3D.

## Fonctionnalités

- **1 circuit « jardin »** de 911 m : épingle de la niche, chicane, grande courbe, longue ligne droite de départ.
- **Course de 3 tours à 8 pilotes** : toi contre 7 chiens pilotés par l'ordinateur, compte à rebours, classement en direct, écran de résultats.
- **4 races**, chacune avec ses statistiques :

  | Race | Vitesse | Accélération | Poids | Maniabilité |
  |---|---|---|---|---|
  | Chihuahua | 3 | 5 | 1 | 5 |
  | Carlin | 4 | 2 | 5 | 3 |
  | Teckel | 5 | 3 | 4 | 2 |
  | Jack Russell | 4 | 4 | 3 | 3 |

- **Accessoires** à choisir au garage, un par emplacement :
  - tête : casquette, couronne, bonnet à pompon, chapeau de fête ;
  - cou : bandana, nœud papillon, collier à grelot ;
  - corps : pull rayé, cape de héros.

  Tes choix sont mémorisés.
- **Dérapage et mini-turbo** : 3 paliers (étincelles bleues, orange, violettes).
- **4 objets canins**, tirés dans les boîtes à objets :

  | Objet | Effet |
  |---|---|
  | Os | Lancé tout droit (ou en arrière en maintenant le frein), rebondit sur les haies |
  | Balle de tennis | Autoguidée vers le pilote juste devant |
  | Flaque de boue | Piège déposé derrière soi |
  | Croquette turbo | Boost immédiat |

- **Bruitages** générés en temps réel avec Web Audio (aucun fichier son), avec un bouton pour couper le son.
- **Aperçu 3D** de ton chien dans le garage.

## Démarrage

Prérequis : Node.js 22 et npm.

```bash
npm install
npm start
```

Puis ouvre http://localhost:4200.

> Lors de `npm install`, npm peut signaler que certains paquets ont des scripts d'installation non approuvés
> (`esbuild`, `lmdb`, `msgpackr-extract`, `@parcel/watcher`). Ce n'est pas bloquant : sur macOS et les plateformes
> courantes, des binaires précompilés sont fournis et le projet fonctionne sans les approuver.

## Commandes de jeu (clavier)

Les touches sont physiques : **ZQSD** sur un clavier AZERTY correspond à **WASD** sur un clavier QWERTY.

| Action | Touches |
|---|---|
| Accélérer | ↑ ou Z / W |
| Freiner, reculer | ↓ ou S |
| Tourner à gauche | ← ou Q / A |
| Tourner à droite | → ou D |
| Sauter, déraper (maintenir en virage) | Espace |
| Utiliser l'objet | E ou Maj |
| Pause | Échap ou P |

Pour déclencher un mini-turbo, maintiens **Espace** en tournant, puis relâche quand les étincelles changent de couleur.

### Paramètres d'URL (développement)

| URL | Effet |
|---|---|
| `/course?autopilot=1` | Ton kart est piloté par l'IA (démo, vérifications automatiques) |
| `/course?debug=1` | Journalise les événements clés dans la console, préfixés par `[WoufKart]` |

## Scripts

| Commande | Rôle |
|---|---|
| `npm start` | Serveur de développement (`ng serve`) |
| `npm run build` | Build de production dans `dist/` |
| `npm test` | Tests unitaires (Vitest, via `ng test`) |
| `npm run watch` | Build de développement en continu |

## Architecture

Le projet sépare strictement l'**interface** (Angular) et le **moteur de jeu** (TypeScript pur).

```
src/
  app/                 ← Angular : menus, garage, HUD, pause, résultats
    core/              ← SettingsStore (préférences), GameSessionService (pont vers le jeu, en signals)
    features/
      home/            ← accueil, rappel des commandes
      garage/          ← choix de la race, accessoires, aperçu 3D
      race/            ← canvas, HUD, compte à rebours, pause, résultats
    shared/            ← formatage (temps, rangs), préférence « réduire les animations »
  game/                ← moteur de jeu, sans aucune dépendance à Angular
    core/              ← contrats partagés : types, vecteurs 2D, constantes de réglage, RNG déterministe
    track/             ← circuit (spline Catmull-Rom), projection sur la piste
    kart/              ← physique arcade, dérapage, mini-turbo
    items/             ← boîtes à objets, tirage, projectiles, pièges, impacts
    ai/                ← pilotes IA (trajectoire, freinage, dérapage, objets)
    race/              ← grille, tours, classement, collisions, résultats, simulation
    dogs/              ← races et accessoires (données) + modèles 3D construits par code
    render/            ← rendu three.js : jardin, karts, objets, effets, caméra
    audio/             ← bruitages Web Audio procéduraux
    input/             ← clavier, contrôleur du joueur
    engine/            ← boucle de jeu à pas fixe (60 Hz)
    game-api.ts        ← API publique consommée par Angular
    game.ts            ← createGame() : assemble le tout
```

Principes :

- **La simulation est en 2D** sur le plan du sol, déterministe (graine aléatoire) et **sans three.js**. Elle se teste en Node, sans navigateur.
- **Boucle à pas fixe** (60 Hz). Le rendu interpole entre deux pas pour rester fluide sur les écrans à 120 Hz.
- **Angular ne tourne pas à chaque image.** Le jeu publie l'état du HUD environ 10 fois par seconde, et `GameSessionService` l'expose en signals.
- **three.js est chargé à la demande**, uniquement en ouvrant le garage ou la course. Le bundle initial fait environ 260 kB.
- **Tout le modèle 3D est construit par code** : chiens, karts, accessoires, décor et textures. Il n'y a aucun asset externe.
- Les conventions d'axes et d'unités (mètres, secondes, radians ; cap θ avec l'avant = (sin θ, cos θ)) sont décrites dans la spec.

## Tests et vérification

- **Tests unitaires** (`npm test`) : ils couvrent chaque module du moteur (circuit, physique, dérapage, objets, IA, course, rendu sans WebGL, audio sans AudioContext, boucle, clavier) et l'interface (services, composants, pages).
- **Course d'intégration** : une course complète à 8 IA sur le vrai circuit, simulée dans les tests. Elle vérifie que tous les pilotes finissent, que personne ne sort de la piste et que la simulation est déterministe.
- **Vérifications réelles** : des courses complètes jouées dans Chrome headless (`/course?autopilot=1&debug=1`), avec captures d'écran, lecture de la console et audit d'accessibilité **axe-core** (0 violation visée).

## Accessibilité

L'interface vise **WCAG AA** et **0 violation AXE** :
- menus entièrement utilisables au clavier, focus visible et géré (dialogue de pause, résultats, changement de page) ;
- annonces `aria-live` pour les tours, le dernier tour et l'arrivée ;
- contrastes AA, y compris sur le HUD posé sur la 3D ;
- respect de `prefers-reduced-motion` : pas de secousses de caméra, pas d'effet de champ de vision, pas de rotation de l'aperçu du garage.

## Documentation

- Spec de conception : [`docs/superpowers/specs/2026-09-23-wouf-kart-design.md`](docs/superpowers/specs/2026-09-23-wouf-kart-design.md)
- Règles de code Angular du projet : [`CLAUDE.md`](CLAUDE.md)

## Limites et pistes

Hors du périmètre du prototype : multijoueur (écran partagé ou en ligne), manette, mobile tactile, circuits supplémentaires, musique, progression et déblocages.

La structure permet de les ajouter progressivement :
- **une nouvelle race** : une entrée de données dans `src/game/dogs/breeds.ts` ;
- **un nouvel accessoire** : une entrée dans `skins-catalog.ts` et son constructeur dans `skin-models.ts` ;
- **un nouveau circuit** : une liste de points de contrôle, sur le modèle de `src/game/track/garden-layout.ts`.
