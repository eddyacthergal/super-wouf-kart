# Wouf Kart — spec de conception du prototype

Date : 2026-09-23 · Statut : validé (vision et jalons validés par l'utilisateur, qui a délégué les choix détaillés)

## 1. Vision

Jeu de kart arcade dans le navigateur, façon Mario Kart 8 Deluxe, où tous les pilotes sont de petits chiens.
Des chiens miniatures font la course dans un **jardin géant**. Style 3D **classique** (couleurs vives, éclairage standard).

Prototype complet :

- 1 circuit « jardin », 3 tours, 8 pilotes (le joueur + 7 IA) ;
- 4 races avec des stats différentes : chihuahua, carlin, teckel, jack russell ;
- skins (chapeaux, accessoires de cou, vêtements) choisis au garage ;
- dérapage avec mini-turbo (3 paliers) ;
- 4 objets canins ;
- bruitages procéduraux simples (Web Audio), bouton muet ;
- contrôle au clavier uniquement.

Hors périmètre : multijoueur, manette, mobile, circuits supplémentaires, musique, progression, style mosaïque.

## 2. Jalons

| Jalon | Contenu |
|---|---|
| J1 Conduite | moteur, circuit jardin (spline), kart + chien, caméra, clavier, dérapage/mini-turbo, tours et chrono |
| J2 Course | 7 IA, compte à rebours, classement, HUD, résultats |
| J3 Chiens | 4 races par code, stats, garage, skins, choix mémorisé |
| J4 Objets | boîtes à objets, 4 objets, usage par l'IA |
| J5 Son | bruitages, bouton muet |

L'implémentation est découpée par modules (voir §5), développés en parallèle contre les contrats de `src/game/core`.

## 3. Architecture

**Approche A retenue : Angular pour l'interface, moteur de jeu en TypeScript pur.**

```
src/
  app/                      ← Angular (menus, garage, HUD, pause, résultats)
    core/                   ← SettingsStore, GameSessionService
    features/home|garage|race
  game/                     ← moteur, aucune dépendance Angular
    core/                   ← contrats partagés (types, vecteurs, constantes, RNG, état du kart)
    testing/                ← circuits factices et fabriques pour les tests
    track/                  ← circuit jardin (spline Catmull-Rom), projection
    kart/                   ← stats → réglages, physique arcade, dérapage
    items/                  ← boîtes, tirage, projectiles, pièges, impacts
    ai/                     ← pilotes IA
    race/                   ← grille, progression, classement, collisions, simulation
    dogs/                   ← races, skins (données) + modèles three.js (chien, kart, accessoires)
    render/                 ← rendu three.js (monde, karts, objets, effets, caméra)
    audio/                  ← bruitages Web Audio procéduraux
    input/                  ← clavier, contrôleur joueur
    engine/                 ← boucle à pas fixe
    game-api.ts             ← API publique (types) pour Angular
    game.ts                 ← createGame() : assemble tout
```

Règles :

- `src/game/**` n'importe jamais `@angular/*`. `src/app/**` n'importe du jeu que `game-api.ts`, les données
  `dogs/breeds.ts`, `dogs/skins-catalog.ts` et `input/keyboard-input.ts` (`KEY_BINDINGS` pour l'aide des commandes),
  les constructeurs de modèles pour l'aperçu du garage, et
  `game.ts` **uniquement par import dynamique** (three.js reste hors du bundle initial).
- La simulation (core, track, kart, items, ai, race) n'importe **pas** three.js : elle est testable en Node.
- La simulation est **2D sur le plan du sol** (x, z). La hauteur n'existe que dans le rendu.
- Boucle à **pas fixe 60 Hz** ; le rendu interpole entre `prevPosition` et `position` (alpha).
- Aléatoire uniquement via `Rng` (graine) : simulation déterministe et testable.

### Conventions (non négociables)

- Unités : mètres, secondes, radians. Repère three.js : Y vers le haut.
- Cap θ : avant = `(sin θ, cos θ)`. Un modèle orienté vers +Z local reçoit `rotation.y = θ`.
- Gauche du pilote = `(cos θ, -sin θ)`. `steer = +1` = droite ⇒ θ **diminue** ; tourner à gauche augmente θ.
- Circuit : `s` croît dans le sens de la course ; `left = (tangent.z, -tangent.x)` ; `lateral > 0` = à gauche ;
  courbure > 0 = virage à gauche.
- `progress` (non bouclé) = distance parcourue ; négatif sur la grille ; tours finis = `floor(progress / length)`.

## 4. Gameplay détaillé

### Physique arcade (`kart/`)

- Stats 1–5 → réglages via `PHYSICS` (constants.ts) : vitesse max 25,5–31,5 m/s, accélération 9–17 m/s²,
  rotation 1,8–2,6 rad/s, masse 0,9–1,3, facteur bas-côté 0,53–0,65.
- Gaz : accélère vers la vitesse max effective (accélération dégressive près du max). Frein : 25 m/s², puis
  marche arrière jusqu'à 8 m/s. Sans gaz : 4 m/s².
- Vitesse max effective = max × (boost ? force du boost : 1) × (bas-côté et pas de boost ? facteur bas-côté : 1).
  Au-dessus du max effectif, la vitesse redescend en douceur (pas de coupure brutale).
- Direction : le volant converge vers la consigne (`steerResponse`) ; dθ = −steer × turnRate × min(1, |v| / 6) × signe(v).
- **Haies** : si |lateral| > wallHalfWidth − KART_RADIUS, le kart est replacé à la limite, perd de la vitesse
  (`wallSpeedRetention`, pondéré par l'angle d'impact), son cap est ramené vers la tangente ; événement `wall`.
- **Dérapage** : touche maintenue + braquage |steer| > 0,2 + vitesse ≥ 12 m/s ⇒ saut (hop) puis dérapage dans
  le sens du braquage. Le braquage module le rayon entre `steerMin` (contre-braquage, ≈ 65 m à pleine vitesse)
  et `steerMax` (serré, ≈ 12 m) : le dérapage tient dans tous les virages du jardin, même les plus doux.
  Charge : paliers à 0,6 / 1,2 / 2,0 s (bleu / orange / violet), ×1,5 en braquant dans le sens du dérapage.
  Relâcher ⇒ boost de 0,6 / 1,1 / 1,7 s (×1,28). Sous 70 % de la vitesse mini, le dérapage s'annule sans boost.
  Pose visuelle : le kart se met en travers (`visualYaw` 0,7 rad ± 0,2 selon le braquage), châssis incliné
  vers l'extérieur, roues avant en contre-braquage.
- Touche maintenue sans braquage : simple saut, pas de dérapage.
- **Tête-à-queue** (impact) : 1 s sans contrôle, vitesse ×0,3, rotation visuelle rapide.

### Circuit « jardin » (`track/`)

- Spline Catmull-Rom centripète fermée, rééchantillonnée ~1 m par échantillon, abscisse uniforme.
- Longueur 750–950 m ; route 14 m de large ; bas-côté de 3,5 m ; haie à 10,5 m de l'axe.
- Rayon de virage ≥ 16 m ; mélange de virages à gauche et à droite ; épingle, chicane (S), grande courbe,
  longue ligne droite de départ (≥ 80 m, grille comprise).
- Les couloirs ne se chevauchent jamais : deux points séparés de plus de 60 m d'abscisse sont à ≥ 27 m.
- Grille : 2 colonnes décalées derrière la ligne ; 3 rangées de 4 boîtes à objets.

### Course (`race/`)

- Compte à rebours 3 s (3, 2, 1, GO) ; personne ne bouge avant GO.
- Ordre d'un pas : contrôleurs → physique de chaque kart (rubber band IA) → objets utilisés → collisions entre karts
  → système d'objets → progression/tours/arrivée → classement → temps.
- Classement : arrivés par temps, puis progression décroissante.
- Le joueur part **dernier** (8ᵉ). Quand il franchit l'arrivée : phase `finished`, résultats calculés (temps estimés
  pour les autres), le kart du joueur passe en pilote automatique, la simulation continue derrière l'écran de résultats.
- Rubber band IA : vitesse max × `aiSkill` × [0,94 ; 1,08] selon l'écart avec le joueur.
- Collisions entre karts : cercles de rayon 1 m, séparation pondérée par la masse, échange partiel de vitesse ; `bump`.

### Objets (`items/`)

| Objet | Effet |
|---|---|
| Os (`bone`) | lancé tout droit (ou en arrière si frein maintenu), 45 m/s, rebondit 3 fois sur les haies, 5 s |
| Balle de tennis (`tennis-ball`) | autoguidée vers le pilote juste devant, suit le circuit, 40 m/s, 8 s |
| Flaque de boue (`mud`) | déposée derrière, reste 30 s, rayon 1,6 m |
| Croquette turbo (`kibble-turbo`) | boost immédiat 1,6 s (×1,35) |

- Boîtes : ramassage à 1,8 m si aucun objet ; réapparition 3 s ; roulette 1,2 s avant usage.
- Tirage pondéré par le classement (les derniers reçoivent plus de balles et de turbos).
- Impact : tête-à-queue, 1,5 s d'invulnérabilité. Un objet ne touche pas son lanceur pendant 0,35 s.
  Un os ou une balle qui touche une flaque détruit les deux.

### IA (`ai/`)

- Vise un point en avant sur la ligne médiane (anticipation proportionnelle à la vitesse), avec un décalage de
  couloir propre à chaque personnalité et une préférence pour l'intérieur des virages.
- Freine si la vitesse dépasse la vitesse de virage admissible (≈ √(26 / |κ|)).
- Dérape dans les virages longs et serrés, relâche en sortie (les IA douées visent le palier 2).
- Évite un kart juste devant ; sort d'un blocage en reculant ; fait demi-tour si à contre-sens.
- Objets : turbo en ligne droite, os si un kart est devant dans l'axe, balle dès que possible si pas 1ᵉʳ,
  flaque si un kart suit de près (sinon après un délai aléatoire).

### Chiens et skins (`dogs/`)

| Race | Vitesse | Accél. | Poids | Maniab. | Silhouette |
|---|---|---|---|---|---|
| Chihuahua | 3 | 5 | 1 | 5 | petit, grandes oreilles dressées, museau court |
| Carlin | 4 | 2 | 5 | 3 | trapu, masque noir, oreilles repliées, queue en tire-bouchon |
| Teckel | 5 | 3 | 4 | 2 | corps très long, pattes courtes, longues oreilles tombantes |
| Jack Russell | 4 | 4 | 3 | 3 | équilibré, blanc à taches marron, oreilles mi-tombantes |

- Chiens construits par code (primitives three.js), assis dans le kart ; animation légère (oreilles selon la vitesse,
  inclinaison de la tête dans les virages, queue).
- Points d'attache : `head`, `neck`, `body`. Skins v1 : tête (casquette, couronne, bonnet à pompon, chapeau de fête),
  cou (bandana, nœud papillon, collier à grelot), corps (pull rayé, cape de héros).

### Rendu (`render/`)

- Jardin géant : pelouse, allée de gravier clair (route), bordures en brique, haies (murs), fleurs géantes, niche,
  balles géantes, arrosoir, clôture, pierres de gué, arche de départ en damier.
- Ombres portées (lumière directionnelle qui suit le joueur), brouillard léger, ciel en dégradé.
- Caméra de poursuite lissée ; champ de vision élargi en boost (désactivé si « réduire les animations »).
- Effets : dérapage (étincelles et halo aux roues arrière de la couleur du palier — jaune avant le premier
  palier —, fumée, traces de pneus au sol qui s'effacent), flammes de boost, poussière hors piste, étoiles d'impact.

### Son (`audio/`)

Bruitages procéduraux Web Audio (aucun fichier) : moteur (oscillateur selon la vitesse), dérapage (bruit filtré),
boost, aboiement, objets (ramassage, lancer, impact), bips du compte à rebours, tour, arrivée, choc contre une haie.
Aucun son avant une interaction utilisateur ; bouton muet mémorisé.

### Interface Angular (`app/`)

- Routes (chargement paresseux) : `''` accueil, `garage`, `course` ; toute autre route → accueil.
- **Accueil** : titre, « Jouer », « Garage », rappel des commandes.
- **Garage** : choix de la race (cartes radio avec barres de stats), accessoires par emplacement, aperçu 3D tournant,
  « Lancer la course ». Choix mémorisés (`localStorage`).
- **Course** : canvas plein écran, HUD (position, tour, chrono, objet avec roulette, jauge de dérapage, mini-carte,
  alerte contre-sens), compte à rebours, pause (`<dialog>` natif, Échap/P), résultats (classement, temps, rejouer).
- Commandes : flèches ou ZQSD/WASD (touches physiques), Espace = saut/dérapage, E ou Maj = objet, Échap ou P = pause.
- Accessibilité : AXE, WCAG AA, focus géré à l'ouverture des dialogues et des résultats, annonces `aria-live`
  (tour, dernier tour, arrivée), canvas avec `role="img"` et libellé, contraste AA, `prefers-reduced-motion`.
- `GameSessionService` expose l'état en signals (HUD ~10 Hz) ; le jeu est chargé par import dynamique.

## 5. Modules et API exportées

Chaque module respecte exactement ces exports (les agents codent contre eux).

- `track/garden-layout.ts` : `GARDEN_CONTROL_POINTS: readonly Vec2[]`
- `track/track.ts` : `class Track implements TrackQuery` (`constructor(controlPoints: readonly Vec2[])`),
  `createGardenTrack(): Track`
- `kart/tuning.ts` : `tuningFromStats(stats: StatBlock): KartTuning`
- `kart/kart-physics.ts` : `stepKart(kart, input, tuning, track, dt, emit: (e: KartEvent) => void): void`
- `items/item-rules.ts` : `rollItem(rank, racerCount, rng): ItemKind`
- `items/item-system.ts` : `createItemBoxes(track)`, `useItem(race, racer, track, backwards, emit)`,
  `stepItems(race, track, rng, dt, emit)`
- `ai/personality.ts` : `interface AiPersonality`, `createAiPersonality(rng, index)`
- `ai/ai-controller.ts` : `class AiController implements DriverController` (`constructor(racerId, personality, rng)`)
- `dogs/breeds.ts` : `BREEDS`, `BREED_LIST`, `interface BreedDefinition extends BreedInfo { look: DogLook }`
- `dogs/skins-catalog.ts` : `SKINS`, `skinsForSlot(slot)`, `sanitizeSkins(value: unknown): SkinSelection`
- `dogs/racer-model.ts` : `buildRacerModel({ breed, skins, kartColor }): RacerModel`, `RacerVisualState`
- `audio/audio-engine.ts` : `class AudioEngine`
- `engine/fixed-step-loop.ts` : `class FixedStepLoop`
- `input/keyboard-input.ts` : `class KeyboardInput`, `KEY_BINDINGS`
- `input/player-controller.ts` : `class PlayerController implements DriverController`
- `race/roster.ts` : `createRoster(playerBreed, playerSkins, rng): RacerEntry[]`
- `race/race-setup.ts` : `createRaceState(track, entries, options): RaceState`
- `race/simulation.ts` : `class RaceSimulation`
- `render/race-renderer.ts` : `class RaceRenderer`
- `game.ts` : `createGame: CreateGame`

## 6. Gestion des erreurs

- WebGL indisponible ou erreur de chargement : `onError` → message clair dans la page de course, retour à l'accueil.
- `localStorage` indisponible : valeurs par défaut, aucune exception.
- Web Audio indisponible : jeu silencieux, aucune exception.
- Onglet masqué : la boucle ne rattrape pas plus de 5 pas ; pause automatique quand la page perd la visibilité.
- `dispose()` libère géométries, matériaux, textures, écouteurs et contexte audio (pas de fuite en rejouant).

## 7. Tests

- Vitest (via `ng test`) ; les specs importent explicitement `describe/it/expect` depuis `vitest`.
- Unitaires : circuit (géométrie, projection, non-chevauchement), physique (accélération, freinage, direction,
  dérapage et paliers, haies, bas-côté, boost, tête-à-queue), objets (tirage, lancers, rebonds, autoguidage, impacts,
  boîtes), IA (reste sur la piste, boucle un tour sur circuit factice), course (grille, tours, arrivée, classement,
  collisions, résultats), données des races et skins, modèles three.js (construction sans WebGL), boucle à pas fixe,
  clavier, audio (sans AudioContext), services et composants Angular.
- Intégration : une course complète simulée sans rendu (8 IA) se termine avec des résultats cohérents.
- Vérification réelle : build de production + Chrome headless en pilote automatique (`/course?autopilot=1`),
  captures d'écran et console sans erreur.
