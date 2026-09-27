# Revue de qualité du code — Super Wouf Kart

*27 septembre 2026, révisée le 28 septembre · branche `refactor/revue-qualite-code` (identique à `main`, version 0.7.0) · périmètre : `src/app` (Angular 22) et `src/game` (moteur TypeScript strict, rendu three.js 0.186).*

Aucune ligne de code n'a été modifiée pour cette revue. Les preuves sont données sous la forme `fichier:ligne`. Pour alléger, les fichiers du moteur sont cités par leur nom court (ils sont tous sous `src/game/`) ; les fichiers Angular sont sous `src/app/`. Quand un nom existe dans deux dossiers, le dossier est précisé (`render/resources.ts` contre `dogs/model-resources.ts`).

---

## 1. Synthèse

**État général : bon.** Environ 15 300 lignes de code utiles pour 12 500 lignes de tests (ratio 0,82). Des fonctions courtes (médiane 5 lignes). Aucun cycle d'import à l'exécution. Aucune dépendance de `src/game` vers Angular. three.js absent de la simulation. Un seul `let` au niveau d'un module, zéro `any`, zéro `enum`. La simulation est déterministe à graine et coûte 10 à 13 µs par pas pour 8 karts. Les défauts trouvés sont petits et localisés : aucun ne justifie une réécriture.

**Messages clés**

1. **Le style « fonctions et données » est le bon choix pour ce jeu, et il faut le garder.** Ce n'est pas du « tout procédural » : c'est un cœur orienté données (structures simples modifiées en place par des « systèmes » appelés dans un ordre fixe), entouré d'une coquille orientée objet pour tout ce qui a une durée de vie (rendu, audio, boucle, pilotes). ECS, classes métier, `enum` et état immuable sont déconseillés (§5.5).
2. **Quatre bugs visibles, faciles à corriger.**
   - Pendant l'arrêt net du sifflet, un kart qui a du turbo en réserve a la caméra et la pose du turbo, et le HUD annonce « turbo actif » aux lecteurs d'écran, alors qu'il n'y a ni flammes ni son (R02).
   - Quand le premier est arrivé, l'IA lance encore sifflet, balle et écureuil pour rien ; l'écureuil vise même un pilote derrière elle (R13).
   - La base du joystick tactile est calculée en pixels alors qu'elle est dessinée en `rem` : elle se décale du pouce si la taille de police du navigateur augmente (WCAG 1.4.4, R03).
   - Si le navigateur perd le contexte WebGL en pleine course, la course continue sans image, sans pause ni message. La fréquence n'est pas mesurée ; le cas est documenté sur mobile (R42).
3. **Il manque les filets de sécurité avant toute refonte.** Aucun test ne fige le résultat d'une graine. Il n'y a ni lint, ni intégration continue, ni contrôle AXE automatisé, ni mesure de couverture, ni aucun test en vrai navigateur (le rendu WebGL n'est jamais exécuté). Le filet de graine (R01) passe en premier, juste avant les corrections. Lint, CI, AXE, couverture et essai en vrai navigateur suivent aussitôt (R09, R04, R10, R41).
4. **Plusieurs oublis compileraient sans erreur.** Un 9e objet absent de `ITEM_KINDS`, un type de décor absent du `Set`, un repère mal orthographié dans un circuit JSON, un accessoire sans modèle 3D : dans chaque cas, l'élément disparaît sans message. Le compilateur et le lint peuvent vérifier tout cela à coût nul (R04, R05, R28, R29).
5. **Les gains de performance sont côté rendu, pas côté simulation, et ils sont à mesurer d'abord dans le navigateur** (R15). La simulation ne pèse pas 0,1 % d'une image. Le rendu compte jusqu'à environ 720 appels de dessin pour les seuls pilotes (passe d'ombre comprise) et renvoie jusqu'à environ 240 Ko au GPU par image, mais ces chiffres sont des maxima estimés sous Node. Une première sonde dans Chrome relève 784 à 828 appels de dessin par image pour toute la scène (R41).

**Verdict « procédural contre orienté objet ».** Ne pas choisir l'un contre l'autre : chacun est déjà à sa place. Les données de simulation restent des objets simples, parce que 8 karts ne justifient ni ECS ni tableaux par champ, et parce que l'ordre de traitement décide de l'issue des collisions. Les classes restent réservées aux ressources, aux acteurs à état privé (IA, boucle, réserve de particules) et aux contrats substituables en test. Les comportements qui dépendent d'un type (objet, thème, race) passent par des tables `Record<Union, …>` ou des `switch` exhaustifs, une par couche, pas par des hiérarchies de classes.

**La feuille de route en un coup d'œil :**
- 28 gains rapides (effort XS ou S, selon l'échelle du §5, risque faible) ;
- 6 refactorisations moyennes ;
- 1 chantier lourd, conditionné à une mesure ;
- 7 fiches « à ne pas faire » ;
- une quarantaine de propositions écartées à la contre-vérification (§6), dont une recommandation entière (R07).

---

## 2. Réponses aux cinq questions

### 2.1 Question 1 — Le style actuel est-il une bonne pratique en jeu vidéo ?

**Réponse : oui, pour un jeu de cette taille, avec une simulation à pas fixe qu'on veut rejouer à l'identique à partir d'une graine.**

Mesures sur `src/game` : 80 fichiers hors tests (15 388 lignes physiques), 28 classes, 116 interfaces, 0 `enum`, une dizaine d'unions de littéraux nommées, 2 unions discriminées d'événements, 1 seul `let` de module (`render/textures.ts:236`, un cache).

**Le code est organisé en quatre couches, chacune dans le style qui lui convient :**

| Couche | Style | Preuves |
|---|---|---|
| Cœur de simulation | Objets de données sans méthode, modifiés en place par des fonctions appelées dans un ordre fixe. C'est le « S » d'un ECS (des systèmes qui transforment des données), sans la partie entités/composants. | `RaceState`, `RacerState`, `KartState` : `types.ts:106-153`, `292-323`, `325-340`. Ordre du pas : `race/simulation.ts:157-168`. Compaction qui garde l'ordre : `items/item-system.ts:506-512`. |
| Pilotes | Classes à état privé derrière une interface | `DriverController` (`types.ts:379-382`), implémentée par `AiController` (`ai/ai-controller.ts:133`, état privé 135-151) et `PlayerController` (`input/player-controller.ts:36`). |
| Coquille impérative | Assemblage, dépendances injectables, seule source d'aléa non semé et d'horloge | `GameDeps` (`game.ts:55-99`). `Math.random` ne sert qu'à tirer la graine (`game.ts:136`). L'horloge n'est lue que dans `engine/fixed-step-loop.ts:63`. |
| Rendu et audio | Classes posées sur le graphe de scène three.js ; elles lisent l'état sans l'écrire et possèdent leurs ressources (`dispose`) | Objets de travail préalloués (`render/effects.ts:134-140`). Particules rangées en tableaux par champ, de type `Float32Array` (`render/particles.ts:55-66`). Hiérarchie roues/pots réellement utilisée (`effects.ts:243`, `288`, `499`). Scène testable sans WebGL (`render/race-scene.ts:2-3`). |

On peut appeler cela « cœur procédural déterministe, coquille impérative orientée objet ». Le cœur n'est pas pur, car il modifie l'état en place pour ne pas allouer. Mais il n'a ni entrée/sortie, ni horloge, ni aléa sans graine, ce qu'exige une simulation à 60 Hz rejouable.

**Comparaison avec les autres styles**

| Style | En deux mots | Ici | Verdict |
|---|---|---|---|
| ECS (bitecs, koota, miniplex) | Une entité est un identifiant, les composants sont des tableaux de données, les systèmes sont des requêtes sur ces tableaux. | Seulement 8 karts et quelques dizaines d'objets. Au retrait d'une entité, bitECS l'échange avec la dernière et recycle les identifiants (vérifié dans son code source, `EntityIndex.ts`). C'est déterministe, mais l'ordre de parcours ne suit plus l'ordre de création. Or cet ordre décide aujourd'hui qui reçoit une boîte (`item-system.ts:297-308`) et quelle flaque est consommée (`item-system.ts:495-500`). Il faudrait aussi reprendre environ 12 300 lignes de tests du moteur, qui construisent l'état en objets littéraux (`testing/fixtures.ts:22-83`). | Non (R34) |
| Orienté données poussé (simulation en tableaux par champ) | Un tableau typé par champ au lieu d'un tableau d'objets. | Déjà utilisé là où le volume le justifie : 2 800 particules. Pour 8 karts, rien à gagner en mémoire, beaucoup à perdre en lisibilité et en typage. | Non |
| Cœur fonctionnel immuable | Un nouvel état à chaque pas. | Il faudrait allouer tout l'état 60 fois par seconde. Le déterminisme vient déjà de la graine et de l'ordre fixe (`race/simulation.spec.ts:611-617`). | Non |
| « Cœur fonctionnel, coquille impérative » | Logique sans effets de bord, effets repoussés en périphérie. | C'est déjà le cas, dans une variante où le cœur modifie l'état en place. | À garder |
| Orienté objet « à la Unity » | Chaque objet de jeu a ses composants avec leur propre `update`. | L'ordre de mise à jour deviendrait implicite. On perdrait la simulation sans rendu (`race/simulation.ts:4`) et la scène testable en Node. | Non |
| Graphe de scène three.js | Hiérarchie d'`Object3D`. | Indispensable pour le rendu (roues, pots, flammes attachées). Il ne doit jamais contenir l'état du jeu (pas d'état dans `Object3D.userData`). | À garder pour le rendu |

**Quand l'orienté objet apporte :**
- une ressource qui a une durée de vie (`dispose`) ;
- l'état privé d'un acteur (IA, boucle, réserve de particules) ;
- un contrat substituable en test (`RendererLike`, `AudioLike`).

**Quand il nuit :** sur les données de simulation, avec des hiérarchies d'héritage, ou quand il cache de l'état.

**Défauts réels, tous petits :**
- un état de simulation caché dans un `WeakMap` de module (`kart/kart-physics.ts:109`), voir R06 ;
- des aiguillages sans valeur de retour que le compilateur ne vérifie pas (`item-system.ts:127-198`, `render/item-visuals.ts:248-272`, `features/race/hud/item-icon.ts:10`) : les deux `switch` sont couverts par le lint de R04 (vérifié par sonde), le gabarit et les listes par R05 ;
- quelques allocations à chaque image dans le rendu, voir R16 ;
- des règles d'architecture restées implicites, voir R06.

**Règles d'architecture à écrire noir sur blanc** (en tête de `race/simulation.ts` et de `core/types.ts`, version corrigée par les relecteurs) :
1. Aucun état de simulation dans une variable de module. Seuls les tampons de travail vidés à chaque appel sont permis, comme `race/ranking.ts:5`.
2. L'état d'un kart vit dans `KartState`, celui de la course dans `RaceState`. L'état de décision d'un pilote (`ai-controller.ts:135-151`) et le séquencement de la course (`simulation.ts:60-75` : compte à rebours annoncé, résultats) restent dans leurs classes. Écrire « tout l'état est dans `RaceState` » serait faux.
3. Les systèmes sont appelés dans l'ordre de `stepRace`, et chaque dépendance d'ordre est commentée. Aujourd'hui, seule `race/progress.ts:21` le fait.
4. Le rendu et l'audio lisent l'état sans l'écrire.
5. `Vec2` : on remplace un vecteur qu'on ne possède pas, comme la position d'un kart, qui peut être partagée (`race/collisions.ts:88`). On peut modifier en place un vecteur qu'on possède, comme celui d'une entité d'objet (`item-system.ts:518-535`).
6. La simulation peut allouer de petits objets. Le rendu, lui, n'alloue rien à chaque image.
7. Un comportement qui dépend d'un type passe par une table `Record<Union, …>` ou un `switch` exhaustif, une par couche.

### 2.2 Question 2 — Où l'état et les réglages sont-ils éparpillés, et comment les regrouper ?

**L'idée que « l'état est dans des variables de module » est fausse.** L'état mutable de module se réduit à :
- un cache : `render/textures.ts:236` ;
- quatre objets three.js temporaires, utilisés de façon synchrone : `render/resources.ts:33-36` ;
- quelques vecteurs en lecture seule ;
- un seul vrai état de simulation caché, le `WeakMap` `memories` : `kart-physics.ts:109` (R06).

L'état de la partie vit dans des instances (`RaceSimulation`, `AiController`, `CameraRig`) et dans les signaux Angular.

**Les réglages, eux, sont nombreux mais surtout bien placés.**
- 254 constantes numériques de module dans 45 fichiers. Classement fait à la main : 94 réglages de gameplay, 91 réglages visuels ou sonores, 61 détails d'implémentation, 8 invariants mathématiques.
- `core/constants.ts` centralise 81 réglages (`PHYSICS`, `DRIFT`, `ITEMS`, `SLIPSTREAM`, `constants.ts:8-171`).
- Environ 2 000 nombres écrits en dur, presque tous dans les modèles 3D et les recettes sonores. Dans la simulation, seuls 4 sont vraiment en dur : `ai-controller.ts:436`, `482`, `484`, `486`.
- Une règle implicite saine est suivie : ce qui est partagé ou règle la « sensation » va dans `constants.ts` ; ce qui est interne à un algorithme reste en tête de son module, commenté.
- L'historique le confirme : sur 55 commits, 30 changent une constante, `constants.ts` est touché 14 fois, et aucun autre fichier plus de 4 fois.

**Les vrais défauts sont aux frontières.** Une même notion y est définie ou recopiée à plusieurs endroits :

| Défaut | Preuves | Reco. |
|---|---|---|
| Textes d'interface qui recopient des durées de réglage. Si l'on change un réglage, l'interface affiche une durée fausse sans qu'aucun test ne casse. | `shared/format.ts:71` (« 7 s ») et `:73` (« 6 s ») contre `constants.ts:132` et `:142` ; `shared/format.spec.ts:73`, `:77` | R08 |
| Difficulté de l'IA répartie sur 3 fichiers, avec deux « skill » de sens différents | `race/roster.ts:38-39` (vitesse max) ; `ai/personality.ts:25-26` (vitesse en virage) ; `simulation.ts:48-52` (aide aux retardataires) ; `RacerEntry.aiSkill` (`types.ts:391`) contre `AiPersonality.skill` (`personality.ts:12`) | R11 |
| Règles du dérapage coupées en deux ; le commentaire de `constants.ts` décrit une valeur définie ailleurs | `constants.ts:60-61` décrit `DRIFT_CHARGE_STEER_BONUS` (`kart-physics.ts:39`) ; `kart-physics.ts:35-37` | R11 |
| Échelle des statistiques (1 à 5, moyenne 3) écrite 4 fois | `kart/tuning.ts:6-7`, `kart-physics.ts:62`, `dogs/racer-model.ts:52`, `features/garage/stat-bar.ts:26` | R11 |
| Thème jardin réparti sur une dizaine de fichiers et pris comme valeur par défaut muette par des constructeurs génériques | `render/palette.ts:5-27`, `sky.ts:12-32`, `lighting.ts:11-17`, `track-surface.ts:30-36`, `hedges.ts:33`, `decor.ts:46-53`, `decor-plan.ts:149-152`, `garden-world.ts:61-69`, `themes.ts:15-21`, `textures.ts:138-139` ; défauts muets à `decor.ts:133-134`, `sky.ts:63`, `sky.ts:97`, `lighting.ts:34`, `beach-world.ts:97`, `154` | R27 |
| Couches au sol : l'ordre anti-scintillement ne tient qu'à 5 hauteurs réparties dans 3 fichiers, et les décalages de profondeur ne suivent pas cet ordre | `track-surface.ts:39-41`, `skid-marks.ts:10` (commentaire recopié en `:9`), `item-visuals.ts:23` ; décalages -2, -4, -2, -6 (`track-surface.ts:126`, `239-240`, `skid-marks.ts:79-80`, `item-visuals.ts:198-199`) | R31 |
| Petits doublons | pas d'image maximal de 0,1 s écrit 3 fois (`race-scene.ts:33`, `camera-rig.ts:32`, `features/garage/dog-preview.ts:204`) ; couleur du kart du joueur écrite 2 fois (`race/roster.ts:12`, `dog-preview.ts:40`) ; délais d'objets de l'IA à moitié dans `ITEM_DELAY` (`ai-controller.ts:121-125`), à moitié en dur | R11, R13, R32 |
| État de kart caché hors des données | `kart-physics.ts:85-126` | R06 |

**Comment regrouper sans tout centraliser.** On ne centralise une valeur que si elle remplit au moins un de ces critères :
- elle est lue par deux modules ou plus ;
- elle doit rester cohérente avec une valeur d'un autre module ;
- elle est affichée au joueur ;
- c'est un bouton d'équilibrage (difficulté, durée d'un objet).

Concrètement :
- `constants.ts` reste un seul fichier découpé par objets de domaine, avec en tête la règle écrite (R11).
- On ajoute `GROUND_LAYERS` pour les couches au sol (R31).
- Restent locaux : les ~50 constantes internes du pilote IA, commentées à côté de leur algorithme (`ai-controller.ts:28-129`), les tailles de tampons, les graines, les coordonnées des modèles et les recettes sonores.
- Pas de `config.ts` unique, pas de réglages chargés depuis un JSON, pas de panneau de réglage livré (§5.5).

### 2.3 Question 3 — Simplifications et généralisations possibles

**Le code est peu dupliqué.** Un détecteur de copier-coller mesure 0,3 à 0,7 % de copie exacte et 1,9 % de copie structurelle, qui est surtout de la donnée (`dogs/breeds.ts`, styles de thèmes).

**Plusieurs généralisations sont déjà bien faites et servent de modèle :**
- **Thèmes** : ce sont des données (`OutdoorStyle`) passées à un constructeur commun avec un point d'extension `extras` (`garden-world.ts:48-59`, `148-197`). La neige tient en un fichier (`snow-park.ts:113-158`).
- **Races** : table `Record<BreedId, …>` (`breeds.ts:255`). Le portrait SVG est calculé à partir de la même fiche que le modèle 3D (`shared/dog-portrait.ts:29-50`).
- **Décor** : planifié en données pures, sans three.js (`decor-plan.ts:190-319`), puis construit.
- **Thèmes de circuit** : `TRACK_THEMES` en `as const`, d'où l'on dérive le type (`track/track-definition.ts:13-15`). C'est le modèle à reproduire.

**Discriminants répétés.**
- Aucun `switch` sur le thème, la surface ou la race.
- `ItemKind` apparaît dans une dizaine de fichiers. C'est la séparation en couches voulue (simulation, IA, rendu, audio, interface), pas un doublon à éliminer. Le vrai risque est l'exhaustivité : la liste d'exécution `ITEM_KINDS` recopie l'union, et plusieurs aiguillages ne sont pas vérifiés (R05).
- `GameEvent.type` est aiguillé par 5 abonnés (`audio/audio-engine.ts:186` et `:211`, `effects.ts:266`, `race-scene.ts:155`, `game.ts:461`) qui ne traitent chacun qu'une partie des événements. Un bus central n'apporterait rien.

**Un nouvel objet a demandé de toucher 13 à 15 fichiers hors tests** (os en or `cedc866` : 15 ; sifflet `eab92a5` : 13 ; super-collier `7e27259` : 13). La plupart portent un comportement propre à l'objet (physique, audio, effets, HUD). Un registre commun à toutes les couches n'en ferait gagner qu'un seul (fusion de `constants.ts` et `item-rules.ts`), et il couplerait le moteur aux textes et SVG de l'interface. Il n'est donc pas recommandé (R39). Le bon levier est que le compilateur signale chaque oubli (R05).

**Doublons réels à factoriser** (R23, R26, R31) :
- `smoothTowards`, identique dans `render/resources.ts:95-97` et `dogs/model-resources.ts:261-263` ;
- l'interface `Disposable`, déclarée deux fois (`resources.ts:8-10`, `model-resources.ts:8-10`) ;
- le modulo positif `((a % n) + n) % n`, recopié 13 fois dans 7 fichiers ;
- `dispose()` identique dans `audio/synth.ts:147-158` et `audio/continuous-sounds.ts:148-159` ;
- `yawPitch` privé (`render/decor-models.ts:13-28`) réécrit en ligne dans `beach-models.ts:45-51` ;
- la même fonction `matchMedia` dans `shared/reduced-motion.ts:2-9` et `shared/touch-device.ts:5-12` ;
- les classes de carte radio recopiées 3 fois (`features/circuits/circuit-select.ts:35`, `features/garage/breed-picker.ts:24`, `features/garage/skin-picker.ts:50`).

**Mondes construits de façon similaire.** La généralisation existe déjà : `buildGardenWorld` construit les trois mondes. Il ne reste que des scories :
- un champ mort, `SceneTheme.clouds` (`scene-theme.ts:48`, affecté 3 fois, jamais lu) ;
- trois lambdas `buildWorld` identiques (`themes.ts:20`, `snow-park.ts:157`, `beach-world.ts:352`) ;
- des valeurs par défaut muettes.

R27 traite ces points. La réorganisation complète en un fichier par thème est à faire seulement quand un 4e thème arrivera.

**Copies qui divergent volontairement, à laisser telles quelles :**
- `DisposalBag` (`render/resources.ts:13-25`, libération en bloc) et `ResourceScope`/`RefCountedCache` (`dogs/model-resources.ts:13-114`, compteur de références partagé entre garage et course) ;
- `paintedGeometry` (couleurs par sommet) et `mergeParts` (garde UV et index) ;
- les 4 fonctions de matrice aux ordres de rotation différents :
  - `transform` : Euler XYZ, `resources.ts:39` ;
  - `yawPitch` : YXZ ;
  - `matrixOf` : lacet seul, `decor.ts:114` ;
  - `partMatrix` : quaternion, `model-resources.ts:184` ;
- les seuils de contre-sens -0,5 pour l'alerte du HUD (`hud.ts:9`, avec vitesse et délai) et -0,3 pour le demi-tour de l'IA (`ai-controller.ts:108`, avec sortie à 0,5 à la ligne 109) ;
- les couleurs de palier du HUD, choisies pour le contraste WCAG (`features/race/hud/hud-drift.ts:5-13`), contre celles de la scène 3D (`palette.ts:30`).

### 2.4 Question 4 — Bibliothèques éprouvées : lesquelles adopter ?

**Une seule adoption nette : l'outillage de lint.** Il s'ajoute à deux outils de développement pour les tests (couverture, AXE), et un troisième est à essayer : le mode navigateur de Vitest (R41). Aucune bibliothèque d'exécution ne mérite d'entrer aujourd'hui. Chaque candidate testée casse au moins une contrainte du projet :
- les suites à graine (simulation, effets, audio) ;
- le « zéro allocation par image » du rendu ;
- l'injection de dépendances dont dépendent les tests ;
- les messages d'erreur en français.

Ou bien elle remplace du code court et déjà testé sans gain mesurable. Versions vérifiées par `npm view` le 27/09/2026. Les poids « gz » viennent de mesures esbuild ou de bundlephobia ; les tailles « décompressées » sont celles du paquet npm, pas le poids ajouté au bundle.

| Bibliothèque | Remplacerait | Compatibilité, poids, maintenance | Verdict | Raison |
|---|---|---|---|---|
| eslint 10.11.0 + typescript-eslint 8.70.1 + angular-eslint 22.5.0 | La relecture manuelle des règles de CLAUDE.md, l'ARIA statique des gabarits, les frontières entre couches | typescript-eslint accepte TypeScript >=4.8.4 <6.1.0 (6.0.3 installé) ; angular-eslint demande eslint ^9 ou ^10. `ng add angular-eslint@22` écrit typescript-eslint 8.69.0 (même plage TypeScript) et eslint ^10.9.1. 0 octet dans le bundle. Retardera une montée en TS 6.1 le temps que typescript-eslint suive. | **ADOPTER** (R04) | Rien ne vérifie ces règles aujourd'hui ; 32 gabarits inline ne sont analysés que pour leurs types. Essai : 29 erreurs (16 avec la seule configuration de `ng add`), 0 après corrections (R04). |
| @vitest/coverage-v8 (même version exacte que vitest, 4.1.11) | Rien : la couverture n'est pas mesurée | Dépendance paire stricte sur vitest ; la 5.x exige vitest 5. L'option `--coverage` est native du builder de tests d'Angular. | **ADOPTER** (R10), en dev | Carte de couverture avant les refactorisations du rendu. |
| axe-core 4.13.0 | L'audit AXE manuel du README (non versionné) | Dev seulement. Sous JSDOM, la règle de contraste n'est pas fiable et doit être désactivée. | **ADOPTER** (R10), en dev | CLAUDE.md exige AXE ; rien ne le vérifie. |
| @vitest/browser-playwright 4.1.11 + playwright 1.63.0 | Les contrôles manuels du rendu : contraste, appels de dessin, aspect | Paire stricte `vitest: 4.1.11` ; la 5.0.2 exige vitest 5, que `@angular/build` 22.1.8 refuse (`^4.0.8`) ; environ 20 Mo décompressés plus Chromium, en développement ; Playwright ajoute `--enable-unsafe-swiftshader` (WebGL sans GPU) | **À ESSAYER** (R41) | Seul moyen d'exécuter `RaceRenderer` en test ; captures stables au bit près sous SwiftShader ; références par plateforme, à tenir à jour sans option de mise à jour dans le builder. |
| @vitest/eslint-plugin 1.6.27 | — | dépendances paires eslint >=8.57, typescript >=5 | À ESSAYER | Seulement `no-focused-tests` ; `expect-expect` fait du bruit avec les assertions maison. |
| knip 6.38.0 | La recherche manuelle de code mort | Node ^20.19 ou >=22.12 | À ESSAYER, en lancement ponctuel (`npx`) | Rapport mesuré : 5 éléments vraiment morts, 2 faux positifs. Pas de quoi en faire une étape bloquante. |
| lil-gui 0.21.0 | — (nouvel outil) | 226 Ko décompressés, publié en oct. 2025 | À ESSAYER plus tard, derrière `?tune=1` en import dynamique | Seulement si un besoin de réglage en direct apparaît. Ne jamais le livrer par défaut. |
| valibot 1.5.0 + @valibot/to-json-schema 1.8.0 | Le contrôle de forme écrit à la main dans `track/circuit-loader.ts` | TypeScript >=5 ; environ 2 ko gz mesurés pour le schéma de circuit | NE PAS ADOPTER maintenant ; premier choix si l'import de circuits par l'utilisateur arrive | Les 5 circuits sont des fichiers du dépôt, validés à l'import (`track/catalog.ts:13-19`). Il faudrait réécrire un formateur « Coin n » pour garder les messages testés. R21 ferme la dérive sans dépendance (R38). |
| zod 4.x (classique ; zod/mini) | Idem | 19 à 26 ko gz mesurés par deux relecteurs (la mesure initiale de 93 ko n'a pas été reproduite) ; zod/mini environ 5 ko gz | NE PAS ADOPTER | Plus lourd que valibot pour le même service ; zod/mini reste une alternative acceptable le jour venu. |
| ajv, arktype, typebox | Idem | ajv compile par `new Function` (il faudrait `unsafe-eval` si une CSP était ajoutée ; il n'y en a pas aujourd'hui), messages en anglais ; arktype environ 46 ko gz | NE PAS ADOPTER | Aucun gain pour 5 fichiers internes. |
| @ngrx/signals 22.0.1 | `SettingsStore`, `GameSessionService` | Dépendance paire @angular/core ^22 ; environ 2,5 ko gz selon bundlephobia | NE PAS ADOPTER (R36) | Gain d'environ 25 lignes. Une persistance par `watchState` reçoit d'abord l'état initial et réécrirait le stockage dès le chargement (le test `core/settings.store.spec.ts:76` casserait). La logique d'annulation par `generation` resterait écrite à la main. |
| @ngrx-toolkit/core 22.0.1 (`withStorageSync`) | La persistance des réglages | Exige aussi @ngrx/store ^22 ; option `storage` dépréciée | NE PAS ADOPTER | On perdrait le jeton `SETTINGS_STORAGE` que 6 fichiers de tests remplacent, ainsi que la validation champ par champ. |
| bitecs 0.4.0 (MPL-2.0), koota 0.6.6, miniplex 2.0.0, ecsy 0.4.3 | La simulation | miniplex sans publication depuis juillet 2023, dépôt ecsy archivé en avril 2025, koota encore en 0.x (cœur utilisable sans React) | NE PAS ADOPTER (R34) | Aucun gain à cette échelle, et l'ordre de parcours changerait. |
| Rapier (`@dimforge/rapier2d-compat` 0.21.0), planck 1.5.0 | Collisions (`race/collisions.ts:22-84`) | Paquets de 12 et 9 Mo décompressés | NE PAS ADOPTER | Moteur rigide surdimensionné pour 28 paires de cercles ; le modèle « arcade » conserve le cap (`collisions.ts:115-132`). |
| three.quarks 0.17.1, three-nebula 13.3.0, @newkrok/three-particles 3.0.0 | `ParticlePool` (`particles.ts:53-201`) | 38,7 et 23,5 ko gz ; @newkrok exige three ^0.182 | NE PAS ADOPTER | `Math.random` interne : on perdrait les effets à graine (`effects.ts:133`) ; le pool actuel n'alloue rien. |
| Tone.js 15.1.22, howler 2.2.4, zzfx 1.3.2, unmute-ios-audio 3.3.0 | Audio procédural | Tone environ 76 ko gz ; howler lit des fichiers (le jeu n'en a pas) ; zzfx utilise `Math.random` ; unmute-ios-audio non publié depuis 2020 | NE PAS ADOPTER | Environ 1 000 lignes de tests reposent sur le faux `AudioContext` injecté (`audio-engine.ts:70`). |
| pure-rand 8.4, seedrandom 3.0.5 | `core/rng.ts:13-31` (mulberry32, 19 lignes) | seedrandom non publié depuis 2019 (types via @types) | NE PAS ADOPTER | Toutes les suites tirées changeraient, pour aucun gain. |
| gl-matrix, mainloop.js 1.0.4, xstate, yuka 0.7.8, ts-pattern, kdbush, simplex-noise, poisson-disk-sampling | `vec2.ts`, la boucle, l'IA, les aiguillages, les recherches spatiales, le décor | mainloop.js non publié depuis 2017, yuka depuis 2022 | NE PAS ADOPTER (R37) | Convention `{x, z}` contre `[x, y]`, singleton global, acteurs alloués à 60 Hz, `switch-exhaustiveness-check` (R04) et `@default never;` suffisent, tableau alloué à chaque requête. |
| @angular/cdk, nipplejs, tinykeys, @testing-library/angular | Dialogue, joystick, clavier, tests d'interface | — | NE PAS ADOPTER | `<dialog>` natif avec `showModal` et gestion du focus (`features/race/pause-dialog.ts:65-70`), joystick en signaux, lecture par `event.code`. |
| tweakpane 4.0.5, troika-three-text, three-stdlib, camera-controls, jscpd, dependency-cruiser, vitest-axe 0.1.0, fast-check | — | vitest-axe quasi abandonné (janv. 2025) | NE PAS ADOPTER | Rien à remplacer : duplication déjà mesurée, `no-restricted-imports` suffira une fois ESLint en place, addons three déjà fournis par three lui-même. |

### 2.5 Question 5 — Unions de littéraux, `enum` ou classes ?

**État des lieux (TypeScript 6.0.3) :**
- 0 `enum`, 0 `any`, 1 seul `satisfies` (`track/centerline.ts:92`), 42 `as const` ;
- environ 14 unions de littéraux nommées, plus des unions dérivées (`TrackThemeId`, `ItemEntityKind`) ;
- une vingtaine de tables `Record<Union, …>` hors tests (les décomptes varient de 19 à 24 selon la méthode) ;
- deux unions discriminées : `GameEvent` et `KartEvent` (`types.ts:347-363`, `156-160`). `audio-engine.ts:186-210` s'en sert bien : après le premier `switch`, `racerId` est connu sans conversion de type ;
- les 28 classes du moteur sont toutes dans la coquille. Les deux seuls héritages sont imposés par des API externes (`CorkscrewCurve extends THREE.Curve`, `dogs/dog-model.ts:154` ; `CircuitError extends Error`, `track/circuit-error.ts:2`).

**`enum` ou union de littéraux : garder les unions.**
- Un `enum` produit un objet à l'exécution.
- Il doit être exposé comme propriété de chaque composant qui l'utilise dans un gabarit, alors qu'une union se compare directement (`@case ('bone')`).
- Il se lit mal dans le JSON des circuits et dans les tests, qui écrivent `racer.items = ['bone']` une soixantaine de fois.
- `const enum` pose des pièges avec `isolatedModules` (activé, `tsconfig.json:12`).
- La documentation TypeScript oriente elle-même vers `as const`.

**Exhaustivité : le vrai manque.** Une sonde compilée avec TS 6.0.3 montre ce que le compilateur voit et ne voit pas :
- un `switch` qui renvoie une valeur est protégé (erreur TS2366 si un cas manque, grâce à `noImplicitReturns`, `tsconfig.json:9`) : c'est le cas de `ai-controller.ts:447-487` ;
- un `switch` sans valeur de retour, un tableau `readonly ItemKind[]` écrit à la main et un `@switch` de gabarit sans `@default never;` laissent passer un oubli sans rien signaler ;
- avec le lint de R04 (`switch-exhaustiveness-check`, typé), un `switch` sans valeur de retour et sans `default` est aussi protégé ; restent sans protection les listes écrites à la main et un `@switch` sans `@default never;` (sonde, R05).

La correction coûte quelques lignes et rien à l'exécution (R05). Côté Angular 22, `@default never;` ne fonctionne pas sur un appel de signal : il faut d'abord poser un `@let`.

**Classes ou données : ne pas créer de classes `Kart`, `Racer` ou `Race`.**
- Les tests construisent et modifient l'état directement : 69 appels à `createTestRace`, des surcharges `Partial<RacerState>` (`fixtures.ts:26`, `48`), une cinquantaine d'écritures directes de minuteries.
- `structuredClone` et JSON perdent le prototype d'une classe (`track/catalog.spec.ts:75`, `track/circuit-loader.spec.ts:41`).
- Des fonctions pures dans le même module protègent les invariants aussi bien.

**Le bon outil pour chaque invariant réel :**

| Invariant | Outil | Reco. |
|---|---|---|
| File de 2 objets | Déjà bornée par `item-system.ts:300`. Seul le cast `as 0 \| 1` (`hud.ts:63`) dépend sans contrôle de `maxHeld: 2` (`constants.ts:113`) : un verrou de compilation d'une ligne suffit. | R22 |
| Minuteries du kart (saut, tête-à-queue, arrêt net, collier, turbo) | Elles se chevauchent vraiment : le tête-à-queue passe avant l'arrêt net (`kart-physics.ts:150-155`), le turbo est suspendu pendant l'arrêt net (`kart-physics.ts:249-259`). Un statut unique changerait la physique : pas de machine à états exclusive. En revanche, les règles d'application d'un coup sont recopiées 3 fois : fonctions pures. | R02, R35 |
| `DriftState` | Garder la structure plate. Une union discriminée obligerait à allouer à chaque transition. Il suffit de centraliser `resetDrift`. | R02 |
| Mémoire du kart | Données explicites dans `KartState`, pas de classe. | R06 |
| Phases de course | Trois transitions seulement (`race/race-setup.ts:29`, `simulation.ts:146`, `171`) : rien à faire. | — |
| Identifiants | Pas de types marqués (branded) partout : aucun bug de confusion constaté. Seul `SkinId` gagne à être dérivé du catalogue, qui est fermé. | R29 |

**Options du compilateur (mesurées avec `tsc` 6.0.3) :**

| Option | Erreurs | Verdict |
|---|---|---|
| `noUncheckedIndexedAccess` | 310 dans l'application (render 139, track 101, race 45), 1 091 en comptant les tests | Ne pas activer : des `!` partout, pour des indices bornés par construction |
| `erasableSyntaxOnly` | 26 (38 avec les tests), toutes des *parameter properties* | Pas maintenant ; simplement ne pas introduire de syntaxe non effaçable (`enum`, `namespace`) |
| `exactOptionalPropertyTypes` | 4 (`dogs/model-resources.ts:195`, `game.ts:147`, `268`, `simulation.ts:81`) | Facultatif |
| `verbatimModuleSyntax` | 2 (`app.config.ts`, `app.routes.ts`) | Facultatif, à valider avec `ng build` |
| `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false` | 0 | Inutilisés : par `no-unused-vars` dans le lint (R04), sans script `typecheck` ; `allowUnreachableCode: false` directement dans `tsconfig.json` (R09) |

---

## 3. Points forts à préserver

**Déterminisme**
- Un seul générateur à graine pour la simulation (`game.ts:136-137`, `core/rng.ts:13-31`).
- Des générateurs séparés, à graine fixe, pour le cosmétique : effets `0xeffec7` (`effects.ts:133`), décor `0xdec0` (`decor.ts:138`), bruit audio `NOISE_SEED` (`audio-engine.ts:39`). Le rendu ne consomme jamais le flux de la simulation.
- Un nombre de tirages constant dans `createAiPersonality` (`ai/personality.ts:34-38`).
- Une compaction des entités qui garde l'ordre (`item-system.ts:506-512`).

**Boucle et coquille**
- `FixedStepLoop` : horloge, `requestAnimationFrame` et gestion d'erreur injectables (`fixed-step-loop.ts:26-31`) ; protection contre un redémarrage pendant un pas (`104-114`) ; au plus 5 pas par image, l'excédent est jeté, sans « spirale de la mort » (`107-118`).
- Dépendances injectables (`game.ts:55-99`), grâce auxquelles une course entière se joue dans les tests sans WebGL.
- Libérations en ordre inverse, chacune isolée des erreurs des autres (`game.ts:114-122`, `439-449`) ; handle inerte si le démarrage échoue (`427-437`).

**Simulation**
- Contextes des contrôleurs et relais d'événements créés une fois puis réutilisés (`simulation.ts:66-69`, `83-91`, `114-120`).
- Robuste aux valeurs invalides : consigne NaN (`kart-physics.ts:156-157`), position non finie (`progress.ts:18-20`), progression NaN (`ranking.ts:34-37`).
- Collision balayée contre l'effet tunnel (`item-system.ts:538-553`).

**Rendu**
- `RaceScene` construite et testée en Node ; `RaceRenderer` volontairement mince (`race-renderer.ts:1-4`).
- Particules et traces de pneus en tableaux typés préalloués, un seul appel de dessin chacune, rien d'alloué dans `emit` et `update` (`particles.ts:130-200`, `skid-marks.ts:41-48`).
- `DisposalBag` libère chaque ressource une seule fois (`render/resources.ts:13-25`) ; le contexte WebGL est rendu au navigateur (`race-renderer.ts:84-87`).
- Réserve : la perte du contexte WebGL **pendant** une course n'est pas traitée. La simulation, le son et le HUD continuent sans image, sans pause et sans message (R42).
- La caméra respecte « réduire les animations » (`camera-rig.ts:71`, `100`, `162`) ; ombres recalées sur les texels (`lighting.ts:66-80`).
- Budget de maillages testé (`dogs/racer-model.spec.ts:17`, `200-221`).

**Audio et entrées**
- Aucune panne sans Web Audio : tout devient sans effet (`audio-engine.ts:89-106`, `282-302`). Plafond de voix et anti-rafale (`252-274`).
- Clavier par `event.code`, donc AZERTY et QWERTY sans configuration (`input/keyboard-input.ts:2-3`). `KEY_BINDINGS` est la source unique de l'aide (`features/home/controls-help.ts:58`).
- Le joueur passe par le même contrat que l'IA (`player-controller.ts:35-45`).

**Angular**
- CLAUDE.md respecté partout : `input()`, `output()`, `model()`, objet `host`, contrôle de flux natif, `inject()`, routes paresseuses (`app.routes.ts:8-23`), `@Service()`.
- three.js hors du bundle initial grâce aux chargeurs injectables (`core/game-session.service.ts:18-20`, `features/garage/dog-preview.ts:32-38`).
- Le compteur `generation` écarte les rappels tardifs (`game-session.service.ts:56-57`, `145-168`).
- Stockage injectable qui ne lève jamais (`core/settings.store.ts:13-22`, `101-115`).
- Accessibilité travaillée : focus sur le titre après navigation (`core/page-focus.ts:14-35`), `<dialog>` natif, région `aria-live` alimentée par `linkedSignal` (`features/race/race-announcer.ts:35-42`), contrastes chiffrés.
- HUD publié à 10 Hz et non à chaque image (`game.ts:46`).

**Tests**
- Environ 900 tests ; 786 tests du moteur en 4,7 s.
- Des courses complètes de 8 IA sur chaque circuit (`catalog.spec.ts:86-96`).
- Un faux `AudioContext` qui relève les usages invalides de l'API (`audio-engine.spec.ts:6-10`).
- Aucun `.only`, `.skip` ni `@ts-ignore`.

---

## 4. Métriques de référence

Mesurées par des scripts Node en lecture seule, restés hors dépôt dans le dossier temporaire de la session : analyse de l'AST avec le TypeScript du projet, esbuild du projet, `tsc` 6.0.3, `git log`. Elles servent de point de départ pour suivre les progrès.

| Indicateur | Aujourd'hui | Cible après la feuille de route |
|---|---|---|
| Code / tests (lignes utiles, SLOC) | 15 312 (moteur 12 457, Angular 2 850) / 12 501 ; ratio 0,82 | Ratio ≥ 0,8 |
| Fonctions de plus de 100 lignes | 9 (dont `buildDecor` 371, `buildDog` 315, `startRace` 274) | ≤ 7 |
| Fonctions de complexité cyclomatique > 20 | 8 (`Effects.update` 31, `AiController.updateDrift` 29, `playEvent` 29) | ≤ 5, hors `switch` plats et exhaustifs |
| Plus grosse classe | `Effects`, 597 lignes, 34 membres | < 550 après R18 ; environ 400 si les marqueurs d'état sont extraits |
| Fichiers de plus de 400 lignes | 10 (29 % du code) | ≤ 9 |
| Cycles d'import | 0 à l'exécution, 1 de types (`audio/continuous-sounds.ts:6` ↔ `audio-engine.ts`) | 0 |
| Code mort | 1 fichier (`race/index.ts`) + 4 fonctions de `vec2.ts` | 0 |
| Duplication exacte | 0,3 à 0,7 % | < 1 % |
| Aiguillages non vérifiés | 4 (`useItem`, `ItemVisuals.update`, `moveEntities`, `item-icon`) | 0 (2 par le lint, `moveEntities` converti en `switch`, `item-icon` par `@default never;`) |
| Empreintes déterministes figées | 0 | 5 circuits + 1 course en câblage de production |
| Lint, CI | aucun ; essai : 29 erreurs (16 avec la configuration de `ng add`), dont 12 corrigées par `--fix` | 0 erreur, vérifié à chaque PR |
| Violations AXE (hors contraste) | non mesuré | 0 |
| Couverture | non mesurée | carte disponible (pas de seuil) |
| Simulation | 10 à 13 µs par pas (p99 de 14 à 44 µs) ; environ 31 Ko alloués par pas (environ 1,8 Mo/s) | À surveiller, pas de cible |
| Scène | 442 à 539 maillages, dont 387 à 443 projettent une ombre ; 8 pilotes = 360 maillages ; mesuré dans Chrome 153 : 784 à 828 appels de dessin par image, passe d'ombre comprise, et 0,60 à 1,03 million de triangles sur la grille de départ (sonde de R41) | À mesurer sur mobile (R15) |
| Contrôles en vrai navigateur | aucun (`race-renderer.ts:3`) | plafonds d'appels des 5 circuits, contraste AXE, captures de référence (R41) |
| Allocations par image dans le rendu | `terrain.groundAt` (environ 18 Ko et 5 µs par appel sur les circuits en relief), étiquettes, état audio, palmiers | 0 |
| Bundle (gzip) | moteur + three 189 Ko, `main` 73 Ko | Inchangé |
| Nouvel objet | 13 à 15 fichiers hors tests touchés | Inchangé ; chaque oubli devient une erreur de compilation |

Points chauds (nombre de commits × complexité) : `ai-controller.ts` 980, `item-system.ts` 927, `effects.ts` 759, `kart-physics.ts` 610, `game.ts` 476, `audio-engine.ts` 408. C'est là que les refactorisations rapportent le plus.

---

## 5. Constats et feuille de route

**Échelle d'effort.** Ce sont des ordres de grandeur, pour une personne qui connaît le code.
- **XS** : moins d'une demi-journée, quelques fichiers, aucun test existant à réécrire.
- **S** : une journée au plus, une seule PR. Les tests existants passent tels quels ou s'adaptent de façon mécanique.
- **M** : plusieurs jours, **ou** un résultat qu'on ne connaît pas d'avance. Par exemple : des tests qui vont échouer et qu'il faudra trier, des violations à découvrir, une campagne de mesure ou un essai sur un appareil.
- **L** : plusieurs PR de taille M.

**Règle de classement.** Une fiche est classée selon la borne haute de sa partie obligatoire. Les parties « facultatives » ne comptent pas.
- XS ou S : gain rapide (§5.2).
- M : refactorisation moyenne (§5.3).
- L : chantier lourd (§5.4).

La catégorie dit ce que coûte une fiche, pas quand la faire. L'ordre (§5.6) suit d'abord les dépendances, puis la gravité du §5.1.

Application aux fiches dont l'effort est donné sous forme de fourchette :

| Fiche | Effort écrit | Borne haute de la partie obligatoire | Catégorie |
|---|---|---|---|
| R09 | « S à M » (à cause du reformatage) | **S**. La fiche est coupée en deux étapes : la CI (S) et le reformatage (XS, une commande mécanique). Le coût du reformatage venait des conflits avec les autres branches ; on l'annule en le faisant à un point de synchronisation (§5.6). | Gain rapide |
| R15 | « S à M » | **M**. L'instrumentation (points 1 à 3) est S, mais le gain annoncé, « un classement chiffré », n'existe qu'après la campagne sur téléphone du point 4. | Refactorisation moyenne |
| R10 | « S à M » | **M**. Des violations AXE réelles peuvent apparaître. | Refactorisation moyenne |
| R12 | « S pour le code, M avec le recalibrage » | **M**. Le recalibrage est obligatoire : des tests échoueront, et c'est voulu. | Refactorisation moyenne |
| R18 | « S à M » | **M**. Il faut d'abord écrire les tests manquants, puis dédoublonner. | Refactorisation moyenne |
| R41 | « S à M » | **M**. L'essai tient en une PR, mais sa réussite dépend de critères inconnus d'avance (durée en CI, faux échecs). | Refactorisation moyenne |
| R19 | « S (étapes 1 et 2), M avec `DriftPlanner` » | **S**. `DriftPlanner` est facultatif, et l'étape 3 est le travail de R13 C. | Gain rapide |
| R14 | « XS à S » | **S** | Gain rapide |

Totaux : 28 gains rapides, 6 refactorisations moyennes (R10, R12, R15, R17, R18, R41) et 1 chantier lourd (R33b-c).

### 5.1 Constats classés par gravité

Aucun constat n'est critique (plantage, perte de données, faille). Les trois niveaux utilisés :

**À corriger (visible par le joueur ou lié à l'accessibilité)**
1. Turbo « actif » pendant l'arrêt net : caméra, pose, HUD et libellé lu par les lecteurs d'écran (R02).
2. L'IA gaspille ses objets quand le premier est arrivé ; l'écureuil vise un pilote derrière (R13).
3. Joystick calculé en pixels contre des `rem` (WCAG 1.4.4) (R03).
4. Perte du contexte WebGL en course : la course continue sans image, sans pause ni message, surtout sur mobile (R42).

**Risque latent (pas de bug aujourd'hui, mais un changement banal en créerait un sans alerte)**
5. Aucun résultat de graine figé : une refactorisation qui change l'ordre des tirages passerait inaperçue (R01).
6. Des oublis compilent : `ITEM_KINDS`, `DECOR_KINDS`, `switch` sans valeur de retour, `@switch`, repères JSON, accessoires (R04, R05, R28, R29).
7. Un circuit sans bloc `decor` recevrait le décor du Grand Jardin, même en neige ou à la plage (R03).
8. Durées d'objets recopiées dans les textes (R08).
9. État de kart caché hors des données (R06).
10. Tests de l'IA sur une fausse physique qui diverge de la vraie (R12).
11. Pas de lint, de CI, d'AXE, de couverture ni de test en vrai navigateur (R04, R09, R10, R41).
12. Valeurs par défaut muettes (relief plat, style jardin) (R27).
13. Format de circuit écrit 3 ou 4 fois, avec des écarts déjà présents (R21).

**Dette de maintenance**
14. Grosses fonctions dans les points chauds : `Effects`, `AiController.updateDrift`, `startRace` (R17, R18, R19).
15. Doublons et code mort (R23).
16. Réglages aux frontières floues (R11, R31).
17. Allocations à chaque image dans le rendu (R16).
18. Performance de rendu jamais mesurée sur mobile (R15).

### 5.2 Gains rapides (effort XS ou S, risque faible)

Chaque fiche donne : problème, proposition, gain, effort, risque, dépendances et avis des relecteurs. Toutes les fiches ont été contre-vérifiées par trois relecteurs (preuve, coût-bénéfice, avocat du diable), sauf R41 et R42, ajoutées à la révision, qui portent leur propre contre-vérification. Leurs corrections de faits sont intégrées au texte, et leurs réserves sont signalées.

#### R01 — Filet de non-régression déterministe : empreintes figées sur les courses existantes

- **Problème.** Aucun test ne fige le résultat d'une graine.
  - `race/simulation.spec.ts:611-619` et `race/roster.spec.ts:72-78` comparent deux exécutions du même code : si l'ordre des tirages change, ces tests restent verts.
  - Le câblage de production (`game.ts:136-186` : un seul générateur pour le plateau, les personnalités et les IA) tourne bien dans `game.spec.ts:452-508` et `712-722` (graine 7, pilote automatique, 1 tour), mais rien n'y fige l'issue de la course.
  - Les tests d'intégration du moteur câblent le générateur autrement, et c'est voulu : `catalog.spec.ts:17-33`, `simulation.spec.ts:56-68`, `input/keyboard-drift.spec.ts:35-62`.
- **Proposition.**
  1. Dans la course de `game.spec.ts:452-508`, comparer `[id, temps arrondi à la ms]` à une constante littérale. Cela couvre le vrai câblage de production, sans coût d'exécution supplémentaire.
  2. Faire renvoyer à la course de 8 IA déjà jouée par `catalog.spec.ts:86-96` l'ordre d'arrivée, les temps arrondis et le nombre d'événements par type. Comparer le tout à une table littérale par circuit.
  3. Écrire le message d'échec pour qu'il affiche les valeurs obtenues, prêtes à coller. Ne pas utiliser `toMatchSnapshot` : le builder de tests d'Angular n'a pas d'option de mise à jour des instantanés (aucune option `update` dans `node_modules/@angular/build/src/builders/unit-test/schema.json`, `additionalProperties: false` à la l.290). Il faudrait passer par un fichier de configuration Vitest chargé par `runnerConfig` (`schema.json:22-26`), dont l'équipe Angular ne prend pas en charge le contenu (l.24). Des constantes littérales évitent cette configuration et restent lisibles dans la revue de code.
  ```ts
  // Empreinte : change à chaque réglage de gameplay ET à toute réassociation d'opérations flottantes.
  // À mettre à jour sciemment, en disant pourquoi dans le message de commit.
  expect(fingerprint(race)).toEqual(EXPECTED_FINGERPRINTS[definition.id]);
  ```
- **Gain.** Les refactorisations de la simulation (R02, R06, R11, R12, R13, R19) deviennent vérifiables. Une empreinte identique vaut preuve de non-changement.
- **Effort** S · **Risque** faible · **Dépend de** —
- **Avis des relecteurs.**
  - Les trois corrigent l'affirmation « le câblage de production n'est testé nulle part » : il est exécuté, mais pas figé.
  - L'ordre des tirages décrit au départ était inexact. Le constructeur de `RaceSimulation` ne tire rien. On tire d'abord le plateau, puis une personnalité par IA dans l'ordre des pilotes, puis les tirages de la simulation et des IA s'entrelacent. Le contrôleur de repli du joueur tire après l'arrivée (`simulation.ts:196-201`), donc après que les résultats sont figés.
  - L'extraction d'une fonction `createRaceRun` et le hachage des positions sont écartés : les câblages de test divergent volontairement, et le hachage est redondant dans une simulation chaotique.

#### R02 — « Turbo actif » défini une seule fois (corrige le turbo affiché pendant l'arrêt net)

- **Problème.** « Turbo actif » a deux définitions.
  - Avec l'arrêt net pris en compte : `effects.ts:389` (flammes), `game.ts:210` (son), `kart-physics.ts:255` (le turbo est gelé pendant l'arrêt).
  - Sans l'arrêt net :
    - `race-scene.ts:110` : champ de vision de 75° au lieu de 65°, `camera-rig.ts:22-23`, `163` ;
    - `racer-visuals.ts:144` : pose turbo du chien, `dogs/racer-model.ts:172-186` ;
    - `hud.ts:68` : badge turbo, et le texte « turbo actif » lu par les lecteurs d'écran, `features/race/hud/hud-drift.ts:50`, `82`.
  - Aucun test ne combine arrêt net et turbo (`race-scene.spec.ts:267-277`, `hud.spec.ts:96-143`).
  - La séquence « touché » (`applySpinOut`, immunité, événement `hit`) est recopiée 3 fois, avec 3 politiques de protection :
    - écureuil : collier seul, et durée de tête-à-queue écrasée (`item-system.ts:464-467`) ;
    - projectiles : immunité ou collier (`479-483`) ;
    - choc sous collier : `spinTime` et immunité (`collisions.ts:55-58`).
    - Aucun test ne fixe le cas « écureuil + immunité ».
- **Proposition.**
  - *Étape 1, correction :*
    ```ts
    // core/kart-state.ts
    export const isBoostActive = (kart: KartState): boolean => kart.boostTime > 0 && kart.stunTime <= 0;
    // hud.ts:68, avant : boosting: (kart?.boostTime ?? 0) > 0,
    //               après : boosting: kart ? isBoostActive(kart) : false,
    ```
    Utiliser cette fonction dans `race-scene.ts:110`, `racer-visuals.ts:144`, `hud.ts:68`, `effects.ts:389`, `game.ts:210` (et `tickTimers`). Ajouter deux tests (`race-scene.spec`, `hud.spec`) avec `stunTime > 0` et `boostTime > 0`. Version de correctif et ligne « Correction » dans le CHANGELOG.
  - *Étape 2, refactorisation identique au bit près :*
    - Une fonction `applyHit(racer, by, ownerId, emit, spin = ITEMS.spinDuration)` qui garde l'ordre actuel des écritures : tête-à-queue, durée, immunité, événement.
    - Les gardes restent explicites aux trois appels, figées par un test tableau cause par cause.
    - `resetDrift` passe dans `kart-state.ts` et est appelé par `applySpinOut` ; cela supprime aussi l'objet dérapage recréé à chaque coup (`kart-state.ts:49`).
    - Le sifflet reste à part : c'est un arrêt net (`stun`), pas un touché.
- **Gain.** Un bug visible et d'accessibilité corrigé sur trois affichages ; trois copies du touché ramenées à une.
- **Effort** S · **Risque** faible (aucun tirage aléatoire touché) · **Dépend de** R01 (conseillé)
- **Avis des relecteurs.**
  - Les trois ont trouvé l'oubli de `hud.ts:68`, qui concerne l'accessibilité.
  - Écartés : une `savePreviousPose` commune, car les trois copies ne copient pas les mêmes champs (`kart-physics.ts:141-145`, `race-setup.ts:51-53`, `simulation.ts:231-237`) ; `hasControl`, facultatif, avec un seul autre usage à `slipstream.ts:13` ; le gain d'allocation, négligeable.
  - **Question pour l'auteur :** l'écureuil doit-il ignorer l'immunité (`item-system.ts:464`) ? Tout changement de politique est un changement de gameplay, à faire dans un commit séparé.

#### R03 — Trois défauts latents et un piège d'API

- **Problème et proposition, point par point.**
  - **(a) Décor par défaut.**
    - `planDecor` prend par défaut les repères du Grand Jardin (`render/decor-plan.ts:192`), et le rendu importe le catalogue des circuits pour ce seul défaut (`decor-plan.ts:8`).
    - Le bloc `decor` est facultatif (`track/track-definition.ts:45`, absent de `required` dans `circuit.schema.json:6`). Un circuit sans décor recevrait donc niche, arroseur et nains, même en neige ou à la plage.
    - Le risque est latent : les 5 circuits ont un bloc `decor`.
    - Correction : défaut `hints = {}` et suppression de l'import. Tests à adapter : `garden-world.spec.ts:98`, `238` (niche, l.255) et `413` (jet de l'arroseur, l.417). Ajouter le test « circuit sans décor : aucune pièce unique ».
  - **(b) Compte à rebours.**
    - Le HUD arrondit sans tolérance (`hud.ts:54`), la simulation avec `COUNTDOWN_EPSILON` (`simulation.ts:54`, `133`, `139`).
    - Aux pas 60 et 120 (compteur à 2,0000000000000036 puis 1,000000000000007), le HUD affiche 3 puis 2 alors que le bip annonce 2 puis 1.
    - Ce n'est visible que si la publication du HUD tombe sur ce pas, et au pire pendant 0,1 s. C'est surtout une règle d'arrondi écrite deux fois.
    - Correction : une fonction `displayedCountdown()` exportée par `race/`, utilisée aux trois endroits.
  - **(c) Joystick.**
    - `STICK_BASE_HALF = 64` px (`features/race/touch-controls.ts:22`, utilisé l.179-180) suppose une base de 8rem = 128 px (`styles.css:187-188`). Avec une police racine de 20 px, la base est décalée de 16 px.
    - Correction : centrer la base active par un `translate(-50%, -50%)` sur la seule branche active (`touch-controls.ts:54`). Ne pas le mettre sur la classe `.touch-stick-base`, partagée avec le repère au repos (l.63). Mettre à jour le commentaire de `styles.css:183` et `touch-controls.spec.ts:67-68`. Vérifier à l'œil à la livraison (R03 passe avant R41 dans le §5.6), puis figer par le test en vrai navigateur de R41 : police racine à 20 px, centre de la base sous le pouce à 1 px près.
  - **(d) Piège de cache.**
    - La clé `dog:${breed.id}:${part}` (`dogs/dog-model.ts:180`) ignore les prises du volant et la disposition. C'est juste aujourd'hui, puisque le seul appelant (`dogs/racer-model.ts:85-86`) les déduit de la race.
    - Correction : calculer ces valeurs dans `buildDog`. Le `try/catch` qui libère le scope en cas d'erreur est facultatif, car il ne couvre que des erreurs de programmation.
- **Gain.** Trois défauts latents fermés, chacun avec un test ; le rendu ne dépend plus du catalogue des circuits.
- **Effort** S · **Risque** faible · **Dépend de** —
- **Avis des relecteurs.**
  - Le point (e) de la proposition initiale est retiré : ajouter à `aheadGap` la garde de `trackGap` n'est pas un correctif. L'indice est toujours valide, et renvoyer 0 provoquerait une fausse prise d'écureuil (`item-system.ts:460-461`).
  - (d) est requalifié en piège d'API, et non en bug.
  - (b) est jugé mineur, gardé pour la cohérence.

#### R04 — Adopter ESLint, typescript-eslint et angular-eslint, puis protéger les frontières d'import

- **Problème.**
  - Le projet n'a pas de lint :
    - aucune dépendance ESLint dans `package.json:28-40` ;
    - aucune configuration ;
    - aucune cible `lint` dans `angular.json:15-70` ;
    - pas de CI non plus.
  - `strictTemplates` (`tsconfig.json:23`) vérifie les types des 32 gabarits inline, mais ni leur style ni l'ARIA statique.
  - Les règles de CLAUDE.md sont toutes respectées aujourd'hui, mais seulement par relecture. L'essai ci-dessous le confirme règle par règle : le gain est préventif.
  - Frontières :
    - 0 import `@angular` dans `src/game` et 0 import `three` dans la simulation. `no-restricted-imports` le confirme, tests compris.
    - En revanche, le code Angular importe une trentaine de valeurs de modules internes du moteur, contrairement à ce qu'annonce `game-api.ts:2-3`.
- **Essai mesuré (lecture seule, 28/09/2026).**
  - **Montage.**
    - Copie de `src/`, des `tsconfig*.json`, d'`angular.json` et de `package.json` dans le dossier temporaire de la session. Le `node_modules` du dépôt est lié en lecture seule.
    - Outils : ESLint 10.11.0, @eslint/js 10.0.1, typescript-eslint 8.70.1, angular-eslint 22.5.0, TypeScript 6.0.3, Node 24.21.
  - **Configuration de départ.** C'est exactement celle qu'écrit `ng add angular-eslint` 22.5.0 (`@angular-eslint/schematics/dist/utils.js:196`, `248-296`) :
    - préréglages `recommended` + `stylistic` de typescript-eslint, sans typage ;
    - `tsRecommended` ;
    - processeur des gabarits inline ;
    - sélecteurs préfixés `app` ;
    - `templateRecommended` + `templateAccessibility` pour les gabarits.
  - **Fichiers analysés :** 192 (126 `.ts`, 64 `.spec.ts`, 2 `.html`), plus les 32 gabarits inline.

  | Jeu de règles | Erreurs |
  |---|---|
  | `eslint` recommended | 0 |
  | typescript-eslint `recommended` (24 règles, dont `no-explicit-any` et `no-unused-vars`) | 0 |
  | typescript-eslint `stylistic` (17 règles) | 14 (dont 8 dans les tests) |
  | angular-eslint `tsRecommended` (13 règles, dont `prefer-inject`, `prefer-standalone`, `prefer-on-push-component-change-detection`, sélecteurs) | 0 |
  | `templateRecommended` (4 règles, dont `prefer-control-flow`) | 0 |
  | `templateAccessibility` (11 règles) | 2 |
  | **Sous-total, configuration de `ng add` seule** | **16** (1,1 s) |
  | Ajouts R04 non typés : `prefer-signals`, `prefer-signal-model`, `prefer-output-emitter-ref`, `prefer-host-metadata-property`, `prefer-service-decorator`, `prefer-on-push-component-change-detection` avec `allowExplicitOnPush: false`, `template/prefer-ngsrc`, `template/prefer-class-binding`, `template/prefer-style-binding`, `no-restricted-imports` (2 frontières) | 0 |
  | Ajout R04 `consistent-type-imports` | 7 |
  | Ajouts R04 typés : `switch-exhaustiveness-check` / `no-floating-promises` | 6 / 0 |
  | **Total de la phase 1** | **29** (environ 2 s avec le typage) |
  | Pour comparaison : préréglage typé complet (`recommendedTypeChecked` + `stylisticTypeChecked` au lieu de `recommended` + `stylistic`) | 51, dont 42 dans les tests (23 `no-unsafe-*` sur des doublures) |

  **Détail des 29 erreurs et traitement proposé :**

  | Règle | Nb | Emplacements | Traitement |
  |---|---|---|---|
  | `no-empty-function` | 8, tous dans des tests | `features/garage/dog-preview.spec.ts:55-57`, `audio/audio-session.spec.ts:37`, `game.spec.ts:626-628`, `668` (doublures du type `setSize() {}`) | règle coupée pour `**/*.spec.ts` |
  | `consistent-type-imports` | 7 | `app.config.ts:1`, `app.routes.ts:1`, plus `ElementRef` importé comme valeur dans `features/garage/dog-preview.ts:1`, `features/race/pause-dialog.ts:1`, `race-error.ts:1`, `race-page.ts:1`, `race-results.ts:1` | `eslint --fix` (ce sont aussi les 2 erreurs `verbatimModuleSyntax` du §2.5) |
  | `switch-exhaustiveness-check` | 6 avec les options par défaut, 4 avec `considerDefaultExhaustiveForUnions: true` | aiguillages partiels voulus : `audio/audio-engine.ts:186`, `render/effects.ts:266`, `render/race-scene.ts:155` (sur `GameEvent.type`) et `render/beach-world.ts:182` (sur `DecorKind`). Déjà munis d'un `default` : `dogs/dog-model.ts:578` (l. 596), `game.ts:461` (l. 480) | l'option ci-dessous, plus un commentaire `// sans default : …` après le dernier `case` des 4 aiguillages partiels |
  | `array-type` | 5 | `features/garage/breed-picker.ts:7`, `features/garage/dog-preview.ts:56`, `features/garage/garage.ts:9`, `dogs/model-resources.ts:207`, `features/garage/dog-preview.spec.ts:72` | `eslint --fix` |
  | `template/interactive-supports-focus` | 2 | `features/race/pause-dialog.ts:10` (`(keydown)` en l. 16), `features/race/race-results.ts:13` (`(keydown)` en l. 16) | Faux positifs. Le `(keydown)` sert de barrière d'événements (`pause-dialog.ts:57-63`), et le focus est sur les boutons ou sur le titre (`race-results.ts:19`). Ajouter `<!-- eslint-disable-next-line … -->`, précédé d'un commentaire qui le justifie. |
  | `prefer-for-of` | 1 | `audio/audio-engine.ts:307` | La boucle indexée est voulue (« sans allocation », l. 304) : `eslint-disable-next-line`, avec la raison. |

  - `no-floating-promises` ne trouve rien parce que les promesses sont déjà marquées `void` : `features/race/race-page.ts:188`, `202`, `game.ts:334`, `audio/audio-session.ts:66`.
  - **« 0 erreur » est atteignable, et c'est vérifié** sur une seconde copie, avec la configuration ci-dessous :
    - `--fix` corrige 12 erreurs dans 11 fichiers ;
    - le relint ne renvoie plus aucun message, avec 3 suppressions justifiées ;
    - `tsc` (app et tests) et `ngtsc` (`strictTemplates`) renvoient 0 diagnostic après correction.
- **Proposition.**
  - *Phase 1, juste après la CI de R09.*
    - Lancer `ng add angular-eslint@22` en épinglant la version majeure. Sans elle, `ng add` prend la dernière version et échoue si la majeure d'Angular diffère (`ng-add/index.js:149-170`).
    - Ce qu'installe `ng add` :
      - eslint `^10.9.1`, @eslint/js `^10.0.1` et typescript-eslint `8.69.0` (`schematics/package.json:48-52`, `ng-add/index.js:59-77`). La version 8.69.0 accepte la même plage TypeScript `>=4.8.4 <6.1.0` que la 8.70.1 utilisée pour l'essai (npm view). Relancer le décompte à l'installation.
      - le script `lint` (`ng-add/index.js:18`) et la cible `lint` (`ng-add/index.js:139-145`).
    - Ajouts au fichier généré (CommonJS, puisque `package.json` n'a pas `"type": "module"`) :
      ```js
      // Bloc "**/*.ts" généré par ng add : ajouter
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: __dirname } },
      rules: {
        // … sélecteurs générés …
        '@angular-eslint/prefer-on-push-component-change-detection': ['error', { allowExplicitOnPush: false }],
        '@angular-eslint/prefer-host-metadata-property': 'error',
        '@angular-eslint/prefer-signals': 'error',
        '@angular-eslint/prefer-signal-model': 'error',
        '@angular-eslint/prefer-output-emitter-ref': 'error',
        '@angular-eslint/prefer-service-decorator': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-floating-promises': 'error',
        // Un `default` ou un commentaire « sans default » marque un aiguillage partiel voulu ;
        // tout `switch` sur une union sans l'un ni l'autre doit couvrir tous les cas.
        '@typescript-eslint/switch-exhaustiveness-check': ['error',
          { considerDefaultExhaustiveForUnions: true, defaultCaseCommentPattern: '^sans default' }],
      },
      // Bloc "**/*.html" généré : ajouter
      rules: {
        '@angular-eslint/template/prefer-ngsrc': 'error',
        '@angular-eslint/template/prefer-class-binding': 'error',
        '@angular-eslint/template/prefer-style-binding': 'error',
      },
      // Nouveaux blocs
      { files: ['**/*.spec.ts'], rules: { '@typescript-eslint/no-empty-function': 'off' } },
      { files: ['src/game/**/*.ts'],
        rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@angular/*'] }] }] } },
      { files: ['core', 'kart', 'race', 'items', 'ai', 'track', 'input', 'engine'].map((d) => `src/game/${d}/**/*.ts`),
        rules: { 'no-restricted-imports': ['error', { paths: ['three'], patterns: [{ group: ['@angular/*', 'three/*'] }] }] } },
      ```
    - **Correction de la première version de cette fiche : il faut garder `prefer-on-push-component-change-detection`.**
      - En 22.5, elle fait partie de `tsRecommended`.
      - Elle signale un composant qui sort d'`OnPush` et, avec `allowExplicitOnPush: false`, un `OnPush` explicite devenu redondant (`prefer-on-push-component-change-detection.js:9`, `34-36`, `89-96`).
      - C'est exactement la règle de CLAUDE.md, et elle ne trouve rien aujourd'hui.
    - **Règles vérifiées dans la 22.5**, toutes sans erreur aujourd'hui :
      - `@Service` : `prefer-service-decorator` (`prefer-service-decorator.js:13`, `81-98`) ;
      - `model()` : `prefer-signal-model` ;
      - `ngClass` et `ngStyle` : `template/prefer-class-binding` et `template/prefer-style-binding`.
      - En revanche, aucune règle n'interdit un `standalone: true` redondant : `prefer-standalone` ne vise que `standalone: false`.
    - Lint et Prettier cohabitent sans `eslint-config-prettier` : aucune des 132 règles retenues n'est une règle de mise en forme (`meta.type === 'layout'`, vérifié).
    - **Même PR** : `eslint --fix`, les 4 commentaires `// sans default`, les 3 suppressions justifiées, puis l'étape `npm run lint` dans la CI de R09 (1 à 2 s).
  - *Phase 2, après R14 :* restreindre les imports de `src/app` vers le moteur à une liste blanche, avec `allowTypeImports`, d'abord en avertissement.
- **Gain.**
  - À chaque PR, trois choses sont vérifiées : les règles de CLAUDE.md, l'ARIA des gabarits et les couches du moteur.
  - Tout `switch` sur une union sans `default` devient exhaustif sous contrôle. Une sonde avec un 9e objet est signalée à `item-system.ts:127` et `render/item-visuals.ts:248`, ce qui réduit R05.
  - Variables et paramètres inutilisés : `@typescript-eslint/no-unused-vars`, du préréglage `recommended`, est active en erreur et ne trouve rien. Pour les paramètres, elle ne signale que ceux qui suivent le dernier utilisé (`args: 'after-used'`). Aucun script `typecheck` séparé n'est donc nécessaire (R09).
  - 0 octet dans le bundle, aucun effet sur le déterminisme.
- **Effort** S, confirmé par l'essai : 29 erreurs, 0 après corrections dans la copie. · **Risque** faible : les corrections automatiques ne touchent que des imports de type et l'écriture des tableaux ; `tsc` et `ngtsc` restent à 0. · **Dépend de** R09 étape 1 (CI), et de R14 pour la phase 2.
- **Avis des relecteurs.**
  - Il y a 33 composants (32 inline + `App`), pas 31.
  - La règle « app → façade uniquement » ferait environ 33 erreurs dès le premier passage : elle passe donc en phase 2.
  - `no-restricted-imports` ne voit pas les `import()` dynamiques.
  - `templateAccessibility` ne remplace pas AXE (contraste, focus) : voir R10.
  - *Essai de contrôle :*
    - le préréglage typé complet est écarté (51 erreurs, dont 42 dans les doublures de test) ;
    - avec les options par défaut, `switch-exhaustiveness-check` signalerait les 4 abonnés partiels voulus, d'où l'option `considerDefaultExhaustiveForUnions`.

#### R05 — Exhaustivité : ce que le lint ne voit pas (listes et gabarit)

- **Problème.**
  - Une sonde a été faite sur une copie temporaire :
    - un 9e objet, `'frisbee'` (un projectile), ajouté à `ItemKind` (`types.ts:241-249`) ;
    - un 23e décor, `'kennel'`, ajouté à `DecorKind` (`decor-plan.ts:13-35`) ;
    - puis `tsc`, `ngtsc` et le lint de R04 lancés sur cette copie.

  | Emplacement | Qui signale l'oubli |
  |---|---|
  | Tables `Record<ItemKind \| ItemEntityKind, …>` : `item-rules.ts:21`, `item-system.ts:59`, `render/item-visuals.ts:202`, `208`, `shared/format.ts:50`, `66` | `tsc` (TS2741), déjà aujourd'hui |
  | `switch` qui renvoie une valeur : `ai-controller.ts:447`, `468` | `tsc` (TS2366, l. 445 et 467) et le lint |
  | `switch` sans valeur de retour : `useItem` (`item-system.ts:127-198`), `ItemVisuals.update` (`render/item-visuals.ts:248-272`) | **le lint de R04 seul** |
  | Liste `ITEM_KINDS` (`item-rules.ts:9-18`) | **personne** : l'objet n'est jamais tiré (`item-rules.ts:45`, `54-58`) ni montré par la roulette (`features/race/hud/hud-item-slot.ts:8`) |
  | Chaîne de `if` de `moveEntities` (`item-system.ts:321-323`) | **personne** : le projectile reste immobile |
  | `@switch (kind())` (`features/race/hud/item-icon.ts:10-136`) | **personne** : la case d'objet reste vide. `ngtsc` ne renvoie aucun diagnostic sans `@default never;` |
  | `Set` `DECOR_KINDS` (`decor-plan.ts:157-180`) | **personne** : 0 erreur `tsc`, 0 lint. Les repères du nouveau type sont ignorés sans message (`decor-plan.ts:226`), et le rendu répartit les décors par filtres (`render/decor.ts:111-112`, `290`) |

  - Aucun `assertNever` dans `src`.
- **Proposition, réduite à ce que le lint ne couvre pas.**
  ```ts
  // core/types.ts — ordre IDENTIQUE à item-rules.ts:9-18 : il fixe les tranches du tirage
  export const ITEM_KINDS = ['bone', 'mud', 'tennis-ball', 'kibble-turbo',
    'golden-bone', 'whistle', 'super-collar', 'squirrel'] as const;
  export type ItemKind = (typeof ITEM_KINDS)[number];
  ```
  - `item-rules.ts` réexporte `ITEM_KINDS`.
  - Même traitement pour `DECOR_KINDS` : `DecorKind` est dérivé du tableau, et le `Set` est construit depuis ce tableau.
  - `moveEntities` devient un `switch (entity.kind)` **sans `default`**, avec `case 'mud': break;`. Le lint de R04 le couvre alors comme les deux autres aiguillages.
  - Dans le gabarit, poser `@let k = kind();` puis `@switch (k) { … @default never; }` dans `item-icon.ts:10`.
    - Sonde `ngtsc` (Angular 22.1.7) avec un cas retiré : `Type '"squirrel"' is not assignable to type 'never'`. Sans `@default never;`, il n'y a aucun diagnostic.
    - Le `@let` est indispensable. Le contrôle d'Angular génère `const …: never = <expression du @switch>` (`@angular/compiler/fesm2022/compiler.mjs:31463-31470`), et TypeScript ne restreint pas le type d'un appel `kind()`.
  - Facultatif : `SKIN_SLOTS` et `TOUCH_ACTIONS`, avec le même procédé.
  - **Retiré de la fiche :** `core/assert-never.ts` et les `default: assertNever(x)` prévus dans `useItem` et `ItemVisuals.update`.
    - Ils sont redondants avec `switch-exhaustiveness-check`, qui signale l'oubli dans l'éditeur et en CI.
    - Avec `considerDefaultExhaustiveForUnions: true`, un `default` retirerait même ces `switch` du contrôle du lint.
    - Si R04 n'est pas livré, revenir à `assertNever`.
  - **Facultatif, avec R04 : `template/require-switch-default`.**
    - La règle existe dans la 22.5 et accepte `@default never` (`require-switch-default.js:23-26`).
    - Elle signalerait 4 `@switch` : `item-icon.ts:10`, `features/garage/dog-preview.ts:74`, `shared/dog-portrait.ts:65` et `90`.
    - Les trois derniers sont partiels par choix : aucun message quand l'aperçu est prêt, et les oreilles sont dessinées derrière puis devant la tête. Il faudrait donc 3 `@default {}` vides.
    - À activer seulement si d'autres `@switch` sur des unions apparaissent.
- **Gain.**
  - Les 4 oublis que ni `tsc` ni le lint ne voient deviennent des erreurs de compilation.
  - Environ 30 lignes recopiées en moins.
  - Aucun fichier `assert-never.ts` ni `default` ajouté.
  - Aucun coût à l'exécution.
- **Effort** XS · **Risque** : ne pas réordonner `ITEM_KINDS` (tranches testées par `item-rules.spec.ts:143-173`) · **Dépend de** R04, qui couvre les `switch` sans valeur de retour, y compris `moveEntities` une fois converti.
- **Avis des relecteurs.**
  - Retirés :
    - `BREED_IDS`, déjà couvert par `BREEDS: Record<BreedId, …>` et `breeds.spec.ts:16-26` ;
    - l'écriture en positif de `ItemEntityKind` : l'`Exclude` actuel et les `Record` de durée de vie forcent déjà la décision.
  - Le gain annoncé au départ (environ 50 lignes) est ramené à environ 30.
  - *Essai de contrôle :* le `switch` de `moveEntities` passe de R13 C à R05, et `assertNever` est écarté (voir §6).

#### R06 — Rapatrier la mémoire du kart dans `KartState` et écrire les règles d'architecture

- **Problème.**
  - `const memories = new WeakMap<KartState, KartMemory>()` (`kart-physics.ts:109`) est le seul état de simulation au niveau d'un module.
  - Sur ses 7 champs (`kart-physics.ts:86-107`) :
    - 4 sont persistants : `driftHeld`, `driftWheel`, `driftWindow`, `wallIntensity` ;
    - `wallContact` double `kart.wallContact`, écrit en parallèle en 146/455 et 468/469 ;
    - `driftNeutral` et `driftAssisted` sont recalculés et consommés dans le même pas (161-169).
  - Conséquences : `stepKart` dépend de l'identité de l'objet, et une copie du kart perd le dérapage en cours.
  - Le commentaire « `KartState` est figé » (l.85) est caduc : `collarTime` a été ajouté depuis (`types.ts:127-128`).
  - Signatures longues : `stepDrift` prend 7 paramètres (291-299) ; `turnDelta`, 6.
- **Proposition.**
  - Ajouter à `KartState` un sous-objet documenté « interne à la physique », initialisé par `createKartState` avec les valeurs actuelles de `memoryOf` (`kart-physics.ts:114-122`) :
    ```ts
    control: { driftHeld: boolean; driftWheel: number; driftWindow: number; wallIntensity: number };
    ```
  - `driftNeutral` et `driftAssisted` deviennent des variables locales de `stepKart`. Vérifier d'abord que `turnDelta` ne les lit qu'en dérapage (`kart-physics.ts:419-421`).
  - Supprimer le doublon `wallContact` : lire `kart.wallContact` avant sa remise à zéro.
  - Supprimer le `WeakMap`.
  - **Ne pas** remettre `control` à zéro dans `resetDrift` : un faux « nouvel appui » après un tête-à-queue, un second choc de haie ou une fenêtre de saut perdue changeraient les trajectoires (tests `kart-physics.spec.ts:408-416`, `552-556`).
  - Écrire les 7 règles du §2.1.
  - Au passage : `RaceSimulationOptions extends RaceOptions` (`simulation.ts:32-45` contre `race-setup.ts:11-19`) et `Object.assign(tuning, racer.tuning)` dans `tuningFor` (`simulation.ts:209-219`).
- **Gain.** Plus d'état de simulation caché ; signatures raccourcies ; règles écrites pour les prochaines fonctionnalités. Pas de promesse de rejeu : l'IA et `RaceSimulation` gardent leur propre état.
- **Effort** S · **Risque** très faible (valeurs initiales identiques, empreinte R01 inchangée) · **Dépend de** R01
- **Avis des relecteurs.** Les trois rejettent la règle « tout l'état dans `RaceState` », la remise à zéro dans `resetDrift` et la « convention `Vec2` unique ». L'avocat du diable réduit la mémoire à 4 champs persistants. Aucun test ne compare un `KartState` entier : il n'y a pas d'assertion à compléter.

#### R08 — Textes des objets dérivés des réglages

- **Problème.**
  - `shared/format.ts:71` (« Turbo à chaque appui, 7 s ») et `:73` (« Invincible 6 s ») recopient `ITEMS.goldenBoneDuration` (`constants.ts:132`) et `ITEMS.collarDuration` (`constants.ts:142`), que le moteur lit bien (`item-system.ts:112`, `182`).
  - `shared/format.spec.ts:73` et `:77` figent ces chaînes.
  - Après un rééquilibrage, la légende visible (`features/race/hud/hud-item.ts:33`) contredirait le libellé accessible (`hud-item.ts:53`), sans qu'aucun test ne casse.
- **Proposition.**
  - Construire les textes à partir des réglages : `` `Turbo à chaque appui, ${seconds(ITEMS.goldenBoneDuration)}` ``, avec `seconds()` basé sur `toLocaleString('fr')`.
  - Tests en `toContain(`${ITEMS.goldenBoneDuration} s`)`.
  - Supprimer les alias `ROULETTE` et `GOLDEN_DURATION` (`hud-item-slot.ts:8`, `11`) au profit de `ITEM_KINDS` et `ITEMS`.
- **Gain.** Deux réglages recopiés en moins.
- **Effort** XS · **Risque** nul · **Dépend de** —
- **Avis des relecteurs.** Écartés : la fusion des SVG de l'os (icône décorative ; l'os en or a deux étincelles de plus, `item-icon.ts:72-76`) et la jauge générique `itemTimer` (un seul objet concerné, 7 à 9 fichiers touchés).

#### R09 — Outillage minimal : scripts, CI, contrôle de version et de CHANGELOG

- **Problème.**
  - Ni `.github`, ni hook git.
  - Les scripts sont `ng`, `build-info`, `start`, `build`, `watch`, `test` et `release:patch|minor|major` (`package.json:4-14`). `start`, `build` et `watch` lancent d'abord `node scripts/build-info.mjs` (`package.json:7-9`), qui écrit `public/build-info.json`. Aucun script de lint, de format ni de CI.
  - Prettier est configuré (`.prettierrc`) mais jamais appelé. `npx prettier --check .` (27/09/2026) signale 36 fichiers : 27 sous `src/`, 4 fichiers de configuration (`.postcssrc.json`, `angular.json`, `tsconfig.app.json`, `tsconfig.spec.json`) et 5 documents de `docs/`, dont la présente revue.
  - Rien ne vérifie la règle « version montée + entrée de CHANGELOG par PR » (CLAUDE.md, section Versioning).
  - Délais d'expiration de 120 000 ms (`catalog.spec.ts:95`, `keyboard-drift.spec.ts:145`, `simulation.spec.ts:532`) et de 60 000 ms (`game.spec.ts:508`, `722`), alors que ces tests durent entre 0,05 et 0,4 s selon les passes.
- **Proposition.**
  - *Étape 1 : CI (effort S).*
    1. Un script `test:ci` (`ng test --watch=false`).
    2. Une CI GitHub Actions sur chaque PR, qui enchaîne :
       - `npm ci` ;
       - `ng build`, qui vérifie les gabarits et les budgets de `angular.json:33-44` ;
       - `test:ci` ;
       - `scripts/check-release.mjs`. Ce script compare la version à celle de `origin/main` et vérifie que la première entrée du CHANGELOG correspond.

       Fixer la version de Node selon le champ `engines` du CLI Angular. Le script `lint` et son étape de CI arrivent avec R04.
    3. Ramener les délais d'expiration à environ 30 s, pour qu'un blocage échoue vite. Garder 30 s pour `dogs/racer-model.spec.ts:221`, un test qui dure 2 s.
    4. Pas de script `typecheck` séparé : les variables et paramètres inutilisés relèvent de `no-unused-vars`, active dans le lint de R04 (0 erreur à l'essai). Seul `allowUnreachableCode: false` (0 erreur, §2.5) reste à poser dans `tsconfig.json`, si on le veut, car le préréglage typescript-eslint coupe `no-unreachable` pour les fichiers TypeScript (vérifié dans la configuration effective).
  - *Étape 2 : reformatage (effort XS), à faire au point de synchronisation du §5.6.*
    1. Fixer d'abord le périmètre : un `.prettierignore` qui exclut `docs/` évite de réécrire les plans et la présente revue.
    2. Faire un commit `prettier --write` seul, sans aucun autre changement, et le référencer dans `.git-blame-ignore-revs`. Ajouter ensuite un script `format:check` et son étape dans la CI.
- **Gain.** Chaque PR est vérifiée automatiquement : build, tests, format, version et CHANGELOG, puis lint avec R04.
- **Effort** S (étape 1 : S ; étape 2 : XS) · **Risque** nul à l'exécution. Le reformatage entre en conflit avec toute branche ouverte : c'est pourquoi il se fait au point de synchronisation · **Dépend de** — (le lint est branché par R04)
- **Avis des relecteurs.**
  - Retirés : les hooks `prestart`/`prebuild` (gain nul) et le retrait de `vitest/globals` (le builder active lui-même `globals: true`).
  - Un délai d'expiration n'est pas un banc de performance : l'argument « détecte une régression ×100 » est abandonné.

#### R11 — Réglages de conduite : lever les ambiguïtés, supprimer les vrais doublons

- **Problème.**
  - `constants.ts:60-61` décrit `DRIFT_CHARGE_STEER_BONUS`, défini ailleurs (`kart-physics.ts:39`).
  - `SPIN_DECELERATION` est privé (`kart-physics.ts:20`), alors que son jumeau `ITEMS.stunDeceleration` est public (`constants.ts:140`).
  - Échelle 1/5/3 écrite 4 fois (voir §2.2).
  - Deux « skill » de sens différents : vitesse max (`types.ts:301`, `391`, appliquée en `simulation.ts:217`) et vitesse en virage (`personality.ts:12`, lue en `ai-controller.ts:200`).
  - Deux `WRONG_WAY_ALIGNMENT` homonymes (`hud.ts:9`, `ai-controller.ts:108`).
- **Proposition.**
  - `STAT_POINTS = { min: 1, max: 5, average: 3 }`, utilisé aux 4 endroits.
  - Renommer `aiSkill` en `maxSpeedSkill` et `skill` en `cornerSkill` (environ 20 occurrences, suivies par le compilateur).
  - `DRIFT` absorbe `DRIFT_CHARGE_STEER_BONUS`, `DRIFT_STEER_THRESHOLD` et `DRIFT_CANCEL_RATIO`. `SPIN_DECELERATION` rejoint `ITEMS`.
  - Renommer sur place `HUD_WRONG_WAY_ALIGNMENT` et `AI_UTURN_ALIGNMENT`, avec un commentaire croisé qui dit que l'écart est voulu.
  - Écrire en tête de `constants.ts` la règle de centralisation du §2.2.
- **Gain.** Quatre doublons d'échelle supprimés, deux homonymies levées, un commentaire redevenu vrai.
- **Effort** S · **Risque** nul (valeurs identiques, aucun tirage déplacé) · **Dépend de** —
- **Avis des relecteurs.**
  - Le gain annoncé « régler la sensation ne touchera plus qu'un fichier » est faux : le commit `9212df8` toucherait encore 5 fichiers, pour des réglages d'IA et de rendu qui restent locaux.
  - Écartés :
    - déplacer les `WALL_*` et les décalages de lancer ;
    - un objet `AI_DIFFICULTY` dans `core` ;
    - faire importer par les tests les valeurs qu'ils vérifient : ce sont des oracles, par exemple `item-system.spec.ts:30` ;
    - recalculer `TEST_TUNING` par `tuningFromStats`, ce qui rendrait `kart/tuning.spec.ts:41` tautologique.

#### R13 — IA et objets : corriger la fin de course, ranger les délais

- **Problème.**
  - *Bug :* les conditions `waited && racer.rank > 1` (`ai-controller.ts:455`, `459`, `463`) ne tiennent pas compte des pilotes arrivés, alors que les effets les ignorent : sifflet (`item-system.ts:172`), cible de la balle (`208`), cible de l'écureuil (`215-217`). Une IA 2e quand le 1er a fini lance donc :
    - un sifflet qui n'arrête personne ;
    - une balle sans cible ;
    - un écureuil qui vise le 3e, c'est-à-dire un pilote **derrière** elle.
  - *Trou non testé :* l'objet est suivi par type (`ai-controller.ts:421-425`). Deux os d'affilée : aucun nouveau délai n'est tiré, et le second part après `ITEM_RETRY_DELAY` (0,5 s).
  - *Ménage :*
    - délais pour moitié dans `ITEM_DELAY` (`121-125`, clé `ball` au lieu de `tennis-ball`), pour moitié en dur (`436`, `482`, `484`, `486`) ;
    - `ENTITY_LIFE` et `entityRadius` séparés (`item-system.ts:59-67`) ;
    - champ `speed` de l'écureuil écrit (`193`) mais jamais lu (`430`, `439`).
- **Proposition.**
  - **A (correction).** `item-system` exporte des prédicats de cible réelle : un pilote mieux classé, en course et non protégé pour le sifflet et la balle ; `squirrelTarget(…)` dont le rang est meilleur que celui du lanceur pour l'écureuil. Ils remplacent `racer.rank > 1`. Tests « le 1er est arrivé ». Le test `ai-controller.spec.ts:859` (écureuil gardé au 1er rang) reste vrai.
  - **B (à trancher par l'auteur).** Suivre l'objet par exemplaire et non par type, avec un test « deux os ». Cela ajoute un tirage côté IA, donc l'empreinte R01 change.
  - **C (ménage, comportement identique).**
    - Délais regroupés dans `ITEM_DELAY`, avec exactement un `rng.range` par délai, mêmes bornes et même ordre.
    - Aucun tirage pour la croquette et l'os en or. Le tirage de relance de l'os en or reste à l'usage (l.436).
    - Un seul `Record<ItemEntityKind, { life; radius }>` local.
    - L'écureuil lit `entity.speed`.
- **Gain.** Un comportement absurde de fin de course corrigé et testé ; tous les délais de l'IA au même endroit.
- **Effort** S · **Risque** : A change la fin de course (voulu), donc empreinte R01 à mettre à jour et ligne « Correction » au CHANGELOG · **Dépend de** R01 (le `switch` de `moveEntities`, seule raison d'une dépendance à R05, est passé dans R05)
- **Avis des relecteurs.** Le « catalogue des objets » commun aux couches est écarté : il ne ferait gagner qu'un fichier par objet (13 → 12), l'IA a des cas particuliers (agressivité, relance de l'os en or) qui recréeraient le `switch`, et il faudrait renommer 92 références `ITEMS.*` pour les imbriquer. `ENTITY_VISUALS` est également écarté : `item-visuals.ts:163-164` sont déjà des `Record` exhaustifs.

#### R14 — Frontière entre l'application et le moteur : corrections ciblées

- **Problème.**
  - Le commentaire de `game-api.ts:2-3` (« Angular n'importe QUE ce fichier ») est faux : l'application importe des valeurs de 8 modules du moteur.
  - three.js n'est atteint par aucun import statique aujourd'hui (fermeture des imports vérifiée), mais seulement par discipline.
  - `features/circuits/track-preview.ts:4` dépend d'une fonction du HUD (`minimapFrame`, `features/race/hud/minimap.ts:23`).
  - La couleur `#c9b48a` est écrite deux fois (`minimap.ts:62`, `track-preview.ts:28`).
  - `isBreedId` vit dans l'application (`core/settings.store.ts:39-41`), alors que `isTrackId` est dans le moteur (`track/catalog.ts:24`).
  - `DEFAULT_SETTINGS` n'est pas en lecture seule (`settings.store.ts:32`).
- **Proposition.**
  - Corriger le commentaire de `game-api.ts`.
  - Déplacer `isBreedId` dans `dogs/breeds.ts` et typer `Readonly<Settings>`.
  - Déplacer `minimapFrame` dans `app/shared/track-map.ts`, avec une constante `TRACK_ROAD_COLOR`.
  - Protéger l'absence de three.js par un contrôle qui suit les imports de proche en proche : un petit test Vitest qui parcourt les imports statiques de `src/app` et échoue s'il atteint `three`, ou un budget `initial` resserré dans `angular.json:33-38`. Puis ajouter la liste blanche ESLint de R04 (phase 2).
- **Gain.** Documentation juste, doublons supprimés, et l'invariant « three.js hors du bundle initial » vérifié au lieu d'être tenu par discipline.
- **Effort** XS à S · **Risque** faible · **Dépend de** R04 (pour le lint)
- **Avis des relecteurs.** La façade `game-data.ts` est écartée à l'unanimité. Elle ne réduit ni le bundle ni le démarrage (`catalog.ts` s'exécute toujours à l'accueil). Elle risque de tirer dans chaque chunk le code à effet de bord de `catalog.ts:13` et `input/keyboard-input.ts:41-58`. Et la règle « imports directs » ne contrôle pas ce que la façade importe à son tour. Le libellé recopié dans `features/circuits/circuit-select.spec.ts:50` est un oracle de test : on le garde.

#### R16 — Supprimer les allocations restantes à chaque image dans le rendu

- **Problème.**
  - `CameraRig.update` appelle `terrain.groundAt` à chaque image (`render/camera-rig.ts:134-137`). Chaque appel crée 121 clés chaîne `${cx},${cz}`, un `?? []` par cellule, un objet résultat et une projection (`render/terrain.ts:37`, `54-56`, `71-78`).
    - Mesure : environ 18 Ko et 5,2 µs par appel sur la colline, soit environ 1 Mo/s de déchets sur les circuits en relief.
  - `updateTags` crée un `TagSlot` et un comparateur à chaque image (`racer-visuals.ts:181-197`).
  - `game.ts:202-214` crée un état audio à chaque image (appel en l.258).
  - `beach-world.ts:135` crée une fermeture `forEach` à chaque image.
- **Proposition.**
  - Terrain :
    - clé numérique et tableau vide partagé ;
    - `around()` écrit dans des variables au lieu de renvoyer un objet ;
    - d'abord un test d'égalité ancien/nouveau de `groundAt` **et** `heightAt` sur une grille de points de la colline.
  - « Projection sur la piste d'abord » : seulement sur le chemin de la caméra, avec repli, et mesuré.
  - Étiquettes : un `TagSlot` préalloué par pilote et un comparateur défini au niveau du module.
  - Audio : un seul état rempli sur place. Le faux audio de `game.spec.ts:79-80` doit alors copier ce qu'il reçoit. Déplacer le type `PlayerAudioState` dans `audio/player-audio-state.ts`, ce qui supprime le seul cycle d'import, qui ne porte que sur des types.
  - Palmiers : une boucle `for`.
- **Gain.**
  - Mesuré : `around()` environ 2 fois plus rapide (5,2 → 2,5 µs), et 0,33 µs sur piste avec projection préalable.
  - Chargement du relief plus court : `heightAt` est appelé pour chaque sommet du sol.
  - Environ 1 Mo/s de déchets en moins.
  - Aucun gain visible en images par seconde.
- **Effort** S · **Risque** faible (aucun effet sur la simulation ni les tirages) · **Dépend de** — (R15 conseillé juste avant, pour mesurer les parties marquées « à mesurer »)
- **Avis des relecteurs.**
  - Ne pas faire passer la projection en premier dans `heightAt` au chargement : pour un point loin de la piste, `project()` peut parcourir tous les échantillons (`track/track.ts:92-103`).
  - Le tri des événements dans `effects.ts:265` devient facultatif : il s'exécute par événement et non par image, et le cas `wall` recalcule son propre sol (`effects.ts:328`).
  - Le retrait de `updateMatrixWorld(true)` (`racer-visuals.ts:148`) n'est pas une allocation. Les relecteurs sont partagés (tests qui lisent `matrixWorld`) : à mesurer avec R15.

#### R19 — `AiController` : prédicats de dérapage nommés et délais regroupés

- **Problème.**
  - C'est le point chaud n°1 : 587 lignes, 50 constantes, 15 champs mutables.
  - `updateDrift` fait 85 lignes, avec une complexité de 29 (`312-396`) : une condition de départ à 10 termes (`341-357`) et une condition de relâchement à 6 termes (`384-390`).
- **Proposition.**
  1. Extraire deux prédicats purs et nommés, `canStartDrift` et `shouldReleaseDrift`, dans le même fichier. Le tirage `rng.next()` reste à la ligne 325, à la même place. C'est ce découpage, et non un déplacement de fichier, qui fait passer la complexité sous 12.
  2. Exporter, ou déplacer dans `ai/track-scan.ts`, les analyses pures du circuit (`509-549`) pour les tester seules. Ne pas les fusionner avec `track.ts:211-217`, qui a une autre fenêtre.
  3. Délais regroupés, avec R13 C.

  Facultatif, avec la réserve de l'avocat du diable : une classe `DriftPlanner`. Son état est lu par la visée avant sa mise à jour (`244-245`), remis à zéro depuis 3 endroits (`281`, `301`, `499`) et décompté à chaque pas (`172`). Elle demanderait donc une interface soignée.
- **Gain.** Complexité maximale de 29 à moins de 12 ; analyse du circuit testable seule.
- **Effort** S (étapes 1 et 2 ; M avec `DriftPlanner`, facultatif) · **Risque** : même générateur et même ordre (dérapage à la l.205, puis objets à la l.222), empreinte R01 identique · **Dépend de** R01, R13 (partie C) · **Conseillé après** R10 et R12
- **Avis des relecteurs.** Il y a 50 constantes, et non environ 45. La classe fait 369 lignes, et non 590 (ce chiffre est la taille du fichier).

#### R20 — Invariants des mondes étendus aux 5 circuits

- **Problème.**
  - L'emprise hors couloir (`garden-world.spec.ts:400-426`) et la pose sur le relief (`493-508`) ne sont testées que sur le jardin.
  - `themes.spec.ts:12` construit les mondes **sans relief** (`FLAT_TERRAIN`), alors que la production passe `createTerrain(track)` (`race-scene.ts:62-69`) et que la plage est vallonnée (`track/circuits/plage.json:9-21`).
  - `footprints()` ne parcourt que le groupe `garden-decor`, pas les palmiers ni les accessoires de plage.
  - `fir-snow`, `hedge-cap`, le bonhomme de neige et `palm-crowns` ne sont cités par aucun test.
  - Le décalage 0,18 de la couronne des palmiers est recopié de `beach-models.ts:20` dans `beach-world.ts:127-129`. Le vrai sommet du tronc est à environ 0,125 h : la couronne flotte donc à environ 0,9 m du tronc pour un palmier de 17 m.
- **Proposition.**
  - Un `it.each` sur `TRACK_CATALOG`, avec des mondes construits comme en production (`createTerrain(track)`).
  - Emprise stricte sur tous les groupes de décor, avec une seule exclusion nommée et commentée (`palm-crowns`, qui surplombe la piste à plus de 13 m).
  - Base posée à `terrain.groundAt` pour une liste explicite de pièces.
  - Présence des maillages conditionnels.
  - Une constante `PALM_BEND` partagée, sans changement visuel. Recaler la couronne sur le tronc est une décision visuelle à part.
- **Gain.** Filet obligatoire avant R27, R28 et R31 ; environ 2 s de tests en plus.
- **Effort** S · **Risque** nul en production · **Dépend de** —
- **Avis des relecteurs.** Un seuil global « ignorer au-dessus de 4 m » est rejeté : il affaiblirait l'invariant actuel du jardin. Changer le rayon planifié des palmiers est aussi rejeté : c'est un encombrement au sol (`decor-plan.ts:41`), et le changer rebattrait le plan.

#### R21 — Format de circuit : une seule source par règle

- **Problème.**
  - Motif d'identifiant écrit 3 fois (`track/circuit.schema.json:11`, `track/circuit-loader.ts:17`, `track/catalog.spec.ts:56`).
  - Nombre de tours de 1 à 9 écrit 2 fois (`schema:21`, `loader:54`).
  - `y ≤ 25` et `bank ≤ 20` écrits 3 fois (`schema:42-53`, `loader:134-137`, `track-validator.ts:32-35`).
  - Le test de parité ne compare que des noms de clés (`circuit-loader.spec.ts:114-133`).
  - Écarts déjà présents entre schéma et chargeur :
    - un nom fait uniquement d'espaces passe le schéma mais pas le chargeur (`loader:102`) ;
    - « dévers ⇒ rayon » n'existe que dans la description du schéma (`schema:52`).
  - Le nombre de tours par défaut est résolu à 4 endroits, dont un 3 en dur (`game.ts:141`, `features/circuits/circuit-select.ts:75`, `circuit-select.spec.ts:52`, `catalog.spec.ts:18`).
  - `createGardenTrack`, une aide de test, vit dans `track/track.ts:226-229`.
  - Le même stade de test 195×45 est recopié 3 fois (`testing/flat-track.ts:6-11`, `testing/hilly-track.ts:7-12`, `track-validator.spec.ts:22-27`).
- **Proposition.**
  - Une constante de limites partagée par le chargeur et `TRACK_RULES`.
  - Un test de parité étendu : énumération des thèmes égale à `TRACK_THEMES`, motif, bornes, clés de `start` et `decor`.
  - Dans le schéma : `dependentRequired: { bank: ['radius'] }` et `pattern: "\\S"` sur `name` et `description`.
  - `laps ?? RACE_LAPS` résolu dans `parseCircuit`, en gardant `sanitizeLaps` (`race-setup.ts:77-80`).
  - Supprimer `catalog.spec.ts:56-58`, déjà garanti au chargement.
  - `createGardenTrack` et `stadiumCorners()` déplacés dans `src/game/testing`.
  - Supprimer les 4 tests qui redoublent `validateTrack` (`track.spec.ts:229-231`, `233-240`, `242-252`, `284-289`), ainsi que `track-validator.spec.ts:35-37`.
- **Gain.** Trois familles de dérive fermées sans dépendance ; `track.ts` ne dépend plus du catalogue (hygiène, sans effet sur le bundle).
- **Effort** S · **Risque** nul pour le jeu · **Dépend de** —
- **Avis des relecteurs.** Il y a 3 copies du stade, et non 6. Aucun gain de performance n'est à annoncer. Les tests propres au jardin (épingle, chicane) restent.

#### R22 — Identité du joueur et contrats du HUD

- **Problème.**
  - La recherche du joueur est écrite 4 fois, avec deux règles :
    - « le joueur ou rien » : `simulation.ts:184-188`, `game.ts:144` ;
    - « le joueur ou le premier » : `hud.ts:50`, `race-scene.ts:145-151`.
  - La valeur sentinelle `playerId = -1` n'est pas documentée sur le type (`types.ts:334`).
  - Le cast `(player.items.length - 1) as 0 | 1` (`hud.ts:63`) dépend sans contrôle de `maxHeld: 2`.
  - `NEUTRAL_INPUT` est partagé et modifiable (`types.ts:86`).
- **Proposition.**
  - `race/racers.ts` : `playerOf(race)` (accès par indice avec garde) et `focusedRacer(race)`.
  - Documenter l'invariant « id = indice, -1 = pas de joueur ».
  - Un verrou de compilation à côté du cast : `const MAX_HELD: 2 = ITEMS.maxHeld;`.
  - `NEUTRAL_INPUT: Readonly<DriverInput>`.
  - Documenter que `driftAssist` n'est fourni par aucune source et que `combineInputSources` devra le transmettre le jour où ce sera le cas.
- **Gain.** Deux règles explicites au lieu de quatre écritures ; couplage du HUD à `maxHeld` contrôlé.
- **Effort** XS · **Risque** nul · **Dépend de** —
- **Avis des relecteurs.** Écartés :
  - la refonte de `HudSnapshot` en `{ next, reserve }` (7 à 9 fichiers pour retirer un cast) ;
  - le déplacement de `driftAssist` (décision de jeu) ;
  - l'affichage de `speedKmh` sans arrondi (garde contre NaN testée, `race-page.spec.ts:115`) ;
  - le refus de deux joueurs (le plateau en garantit déjà un seul, `roster.spec.ts:15`).

#### R23 — Code mort et doublons stricts

- **Problème.** Voir §2.3. Code mort :
  - `race/index.ts` (0 importeur) ;
  - `vec2`, `cross`, `lengthSq`, `lerp` (`core/vec2.ts:16`, `35`, `37`, `50`) ;
  - `GameSessionService.restart()` (`core/game-session.service.ts:93-96`, appelé seulement par son test) ;
  - `@angular/forms` jamais importé (`package.json:21`) ;
  - `RingPoint.dx/dz` (`render/track-geometry.ts:44-45`, `82-83`) ;
  - le mot-clé `export` de `PAGE_HEADING_SELECTOR` (utilisé seulement dans `core/page-focus.ts:31`) ;
  - le parcours `castShadow` de `dogs/racer-model.ts:104-106`, déjà fait par `mesh()` (`model-resources.ts:155`) et garanti par `racer-model.spec.ts:123` ;
  - un JSDoc orphelin (`game.ts:423-427`).
- **Proposition.**
  - Supprimer le code mort ; faire porter les tests de `restart()` sur `start()`.
  - Un seul `smoothTowards` et une seule interface `Disposable`.
  - `mod(a, n) = ((a % n) + n) % n` **sans garde** dans `vec2.ts`.
  - `stopAndDisconnect` partagé par `synth.ts` et `continuous-sounds.ts`.
  - `yawPitch` exporté.
  - `npx knip@6.38.0` une seule fois pour vérifier. Facultatif : `instanced()` réutilisé par `hedges.ts` et `sky.ts`, en passant explicitement les options d'ombre.
- **Gain.** Environ 60 à 100 lignes et 1 fichier en moins ; une seule définition par outil.
- **Effort** S · **Risque** : `mod` ne doit pas avoir de garde (sinon `aheadGap` change dans un cas limite, donc le sens de l'écureuil) ; ne pas toucher `progress.ts:28-30` · **Dépend de** —
- **Avis des relecteurs.** Écartés :
  - un nouveau `core/math.ts` avec réexports ;
  - `forwardDot` ;
  - `matrixOf` remplacé par `transform` avec des zéros (moins lisible) ;
  - `instanced()` sur les palmiers (couronnes animées) ;
  - retirer les drapeaux `destroyed` de `race-page.ts` sans faire de même dans `features/garage/dog-preview.ts` (incohérence pour environ 5 lignes).

#### R24 — Petits gains dans les tests

- **Problème.**
  - `fixedRng` recopié à l'identique (`items/item-rules.spec.ts:10-17`, `item-system.spec.ts:41-48`).
  - `SETTINGS_STORAGE` fourni à la main dans 7 fichiers de tests. Si on l'oublie, la fabrique retombe sur le vrai `localStorage` de jsdom (`core/settings.store.ts:13-22`), partagé entre fichiers puisque les tests ne sont pas isolés par défaut.
  - Une assertion sur une classe Tailwind (`race-page.spec.ts:320`) redouble celle de la ligne 319.
- **Proposition.**
  - `fixedRng` dans `src/game/testing`.
  - Fournir `SETTINGS_STORAGE` à tous les tests via l'option `providersFile` du builder, en `useFactory` pour obtenir une `MemoryStorage` neuve à chaque fois. `settings.store.spec.ts` garde ses surcharges.
  - Supprimer l'assertion l.320.
  - Facultatif : `createTestRace` appelle `placeOnGround`.
- **Gain.** Un risque de tests instables fermé ; un doublon en moins.
- **Effort** XS · **Risque** nul · **Dépend de** —
- **Avis des relecteurs.** L'avocat du diable réfute la version initiale, et le coût-bénéfice la réduit. Écartés (§6) :
  - une aide commune pour placer un kart (les invariants diffèrent volontairement) ;
  - `entry()` commun (valeurs par défaut différentes) ;
  - grille des faux circuits à 12 m ;
  - `createTestRace` reconstruit sur `createRaceState` ;
  - test des modèles réduit de 240 à 40 constructions (le test exhaustif détecte les interactions entre accessoires, et il en existe déjà une : `racer-model.ts:84-88`) ;
  - `aria-current` sur la ligne du joueur (mauvais usage d'ARIA).

#### R25 — `GameSessionService` rattaché à la page de course

- **Problème.**
  - Le service est un singleton racine (`game-session.service.ts:35`). Son `DestroyRef` (`59-61`) ne se déclenche donc qu'au démontage de l'application.
  - Il possède pourtant la partie et son contexte WebGL, et n'a qu'un utilisateur (`features/race/race-page.ts:126`), qui doit penser à appeler `stop()` (`race-page.ts:176`).
- **Proposition.**
  - `@Service({ autoProvided: false })`, surcharge publique d'Angular 22.1.7.
  - `providers: [GameSessionService]` sur `RacePage`.
  - Supprimer `race-page.ts:176`, garder l'appel à `stop()` de `restart()` (`182`).
  - Ajouter le fournisseur dans `game-session.service.spec.ts:17`.
- **Gain.** La partie ne peut plus survivre à la page, par construction.
- **Effort** XS · **Risque** faible (`race-page.spec.ts:384-402` sert de garde) · **Dépend de** —
- **Avis des relecteurs.** Le passage à un état unique avec des `computed` est écarté : le bilan est d'environ +5 lignes, et non -11, pour autant de retouches par champ. Les champs sont des flux indépendants à des rythmes différents.

#### R26 — Audio : supprimer l'exception morte, rendre les sources de turbo exhaustives

- **Problème.**
  - `game.ts:222` laisse passer les arrivées après celle du joueur. Mais `AudioEngine` ignore tout événement qui ne concerne pas le joueur (`audio-engine.ts:210`) : l'exception ne s'entend jamais.
  - Le test `game.spec.ts:488-492` ne la verrouille pas : `every()` est vrai sur une liste vide.
  - L'union des sources de turbo est recopiée (`audio/sound-effects.ts:60` contre `types.ts:352-353`), et les ternaires qui en dépendent ne sont pas exhaustifs (`sound-effects.ts:63-64`, `effects.ts:281-286`).
- **Proposition.**
  ```ts
  // game.ts:222, avant : if (!playerDone || event.type === 'finish') audioEvents.push(event);
  //              après : if (!playerDone) audioEvents.push(event);   // silence après l'arrivée du joueur
  ```
  - Test : `expect(afterFinish).toEqual([])`.
  - `export type BoostSource` dans `types.ts`, avec un `switch` exhaustif ou une table à la place des ternaires.
  - Facultatif :
    - `ITEM_USE_SOUND: Record<ItemKind, …>` comme liste de contrôle (le « whoosh » par défaut est voulu, `sound-effects.ts:143`) ;
    - une brique `arpeggio()` (environ 15 à 25 lignes en moins), après avoir figé les automatisations ;
    - `MAX_VOICES` déplacé dans `audio-engine.ts`.
- **Gain.** Une règle morte en moins ; une nouvelle source de turbo oubliée devient une erreur de compilation.
- **Effort** S · **Risque** nul (aucun son ne change) · **Dépend de** —
- **Avis des relecteurs.** Écartés :
  - le module `audio-cues.ts` à visiteur (un seul utilisateur, et la règle resterait coupée par l'anti-rafale) ;
  - la table `SMOOTHING` (3 valeurs, une par nature de paramètre) ;
  - `onError` systématique : les `catch` silencieux sont voulus (`audio-engine.ts:5-7`). À relier au journal `?debug=1` seulement si un besoin apparaît.

#### R27 — Contrat de thème : paramètres obligatoires et champ mort supprimé

- **Problème.**
  - Au moins 11 paramètres par défaut ne servent à aucun appel. Un relief ou un style oublié rendrait le monde faux sans erreur :
    - style jardin : `decor.ts:133`, `sky.ts:63`, `sky.ts:97`, `track-surface.ts:325`, `lighting.ts:34` (deux paramètres) ;
    - relief plat : `decor.ts:134`, `beach-world.ts:97`, `154`, `beach-animals.ts:43`, `117`.
  - `SceneTheme.clouds` (`scene-theme.ts:48`) est affecté 3 fois et jamais lu.
  - `SUN_DIRECTION` (`sky.ts:29`) ne sert que de valeur par défaut.
- **Proposition.**
  - Rendre ces paramètres obligatoires.
  - Supprimer le champ mort et `SUN_DIRECTION`.
  - Garder les défauts utilisés par les tests : `buildGardenWorld`, dont le défaut `createTerrain(track)` est correct ; `buildHedges` ; `planDecor`.
- **Gain.** Un relief ou un style oublié devient une erreur de compilation.
- **Effort** S · **Risque** très faible (aucune graine ni aucun test touché) · **Dépend de** R20
- **Avis des relecteurs.** La réorganisation complète (fichier `garden-theme.ts`, `SceneTheme` réduit à `OutdoorStyle`, renommage en `outdoor-world.ts`, palette scindée, `DecorColors` facultatives) est reportée à l'arrivée d'un 4e thème, pour trois raisons :
  - elle déplace une dizaine de fichiers sans corriger de bug ;
  - elle crée un risque de cycle d'imports via les défauts de `textures.ts:138-139` ;
  - des `DecorColors` facultatives effaceraient sans erreur un sapin demandé par le JSON d'un circuit de plage.

  Rejeté : un brouillard égal à l'horizon par défaut, faux pour la plage (`beach-world.ts:338` contre `343`).

#### R28 — Repères de décor validés au chargement

- **Problème.**
  - `LandmarkHint.kind` est un simple `string` (`track-definition.ts:19`). Le chargeur ne vérifie que son type (`circuit-loader.ts:174`), et le schéma se contente de `"type": "string"` (`circuit.schema.json:68`).
  - Une faute de frappe (`dog-house`) fait donc disparaître la pièce sans message (`decor-plan.ts:226`).
  - Un repère d'un autre thème réserve sa place sans être dessiné.
  - Un repère `tree` devient un arbre d'environ 1 m (`size: 1`, `decor-plan.ts:234`).
- **Proposition.**
  - `track/landmarks.ts`, en données pures : `LANDMARK_KINDS` en `as const` (niche, gamelle, arrosoir, arroseur, os géant, nain, bonhomme de neige, château de sable, poste de maître-nageur, cabines).
  - `parseCircuit` refuse un type inconnu (« Décor 3 : type inconnu « dog-house » »).
  - `enum` dans le schéma, avec un test d'égalité.
  - Un `satisfies` qui vérifie que chaque repère est un `DecorKind`.
  - Facultatif :
    - un rayon par défaut par type (les 28 copies dans les JSON sont identiques type par type) ;
    - une table locale à `beach-world.ts` à la place du ternaire `204-209`, en gardant ces pièces dans le groupe `beach-props`, contrôlé par `themes.spec.ts:70-71`.
- **Gain.** Une faute dans un circuit fait échouer le chargement et les tests au lieu d'effacer la pièce.
- **Effort** S · **Risque** nul (les 5 circuits sont valides) · **Dépend de** R05, R20
- **Avis des relecteurs.**
  - Il y a 28 repères, et non 29. Les rayons n'ont pas « divergé » entre fichiers.
  - Seul le rayon du poste de maître-nageur (3,8 contre environ 4,3 m mesurés) est sous-estimé : **question pour l'auteur**.
  - Écartés : `OutdoorStyle.landmarks` ; le découpage de `buildDecor` en 7 fonctions (code linéaire et commenté ; l'ordre des tirages resterait implicite ; risque sur la boucle des fleurs, qui n'alloue rien).

#### R29 — Accessoires typés et petits réglages des modèles de pilote

- **Problème.**
  - `buildSkin` est un `switch` sur une chaîne dont le cas par défaut renvoie `null` (`dogs/skin-models.ts:79-102`) ; l'appelant l'ignore (`racer-model.ts:96`). Un accessoire du catalogue sans constructeur disparaît donc, et les tests ne le voient pas : ils ne vérifient que des dimensions (`racer-model.spec.ts:113-137`).
  - Le plafond de vitesse 1,3 est écrit 3 fois (`racer-model.ts:130`, `skin-models.ts:420-421`).
  - L'état au repos est recopié (`dog-preview.ts:45`, `render/racer-visuals.ts:108`).
  - Le cas `default` du `switch` de la queue couvre deux styles (`dog-model.ts:596-604`).
  - Le seuil « museau écrasé » est écrit deux fois (`dog-model.ts:234`, `shared/dog-portrait.ts:31`).
- **Proposition.**
  - Dans `dogs/skins-catalog.ts` : `SKINS = [...] as const satisfies readonly SkinInfo[]` et `type SkinId`, en gardant l'ordre de `SKINS`, qui est tiré par `race/roster.ts:87`.
  - `SKIN_BUILDERS satisfies Record<SkinId, …>` et `isSkinInSlot(...): id is SkinId`.
  - Ne **pas** resserrer `SkinSelection` jusqu'au store : les chaînes restent validées aux frontières, et le test « sombrero » (`racer-model.spec.ts:225`) reste valable.
  - `MAX_SPEED_FACTOR` exporté.
  - Une fabrique `createIdleVisualState()`, car `racer-visuals.ts` a besoin d'un objet neuf et modifiable.
  - `case` explicites pour la queue.
  - `muzzleShape(look)` dans `breeds.ts`, partagé avec le portrait.
- **Gain.** Un accessoire sans modèle devient une erreur de compilation.
- **Effort** S · **Risque** faible · **Dépend de** R05
- **Avis des relecteurs.** Déclarer `SkinId` dans `core/types.ts` est écarté (les avis divergeaient ; on retient la solution qui ne touche pas au contrat central). Écartés aussi :
  - le découpage de `buildDog` sous 80 lignes (code linéaire, variables locales partagées, aucun bug évité) ;
  - le regroupement des 18 littéraux d'animation ;
  - `TAIL_STYLES` et `EarPose.shape` ;
  - `hidesChest` pour un seul accessoire.

#### R30 — Nettoyages de gabarits Angular

- **Problème.**
  - `app.ts:8-9` utilise un gabarit et une feuille de style externes pour une ligne et 4 lignes de CSS.
  - 6 ajouts et 6 retraits d'écouteurs à garder synchronisés (`shared/block-browser-gestures.ts:38-52` ; corrects aujourd'hui).
  - Classes de carte radio recopiées 3 fois (§2.3).
  - Couleurs écrites en dur dans `shared/dog-portrait.ts:62`, `84`, alors qu'elles égalent `sun-400` et `leaf-900`.
  - `'[WoufKart]'` écrit 5 fois, alors qu'une constante existe déjà, non exportée, dans `game.ts:49`.
- **Proposition.**
  - `app.ts` en gabarit inline, avec `host: { class: 'block min-h-full' }`.
  - Un `AbortController` pour les écouteurs.
  - Une classe `.choice-card` pour l'état coché, dans `styles.css`.
  - Les classes de thème dans le portrait.
  - `LOG_PREFIX` dans un petit module **sans dépendance** : l'importer depuis `game.ts` ferait entrer three.js dans le bundle initial.
  - Facultatif, avec des réserves :
    - variante `compact` par attribut `data-compact` plutôt que 3 entrées et 14 liaisons (`hud-drift.ts:32-54`, `hud-slipstream.ts:11-12`, `hud-speed.ts:11-15`). Il faudra réécrire `race-page.spec.ts:488`, `509`. L'avocat du diable préfère garder l'entrée typée ;
    - table des 3 boutons tactiles, en gardant les icônes dans un `@switch` ;
    - idiome `@for (k of [x]; track k)` pour recréer un élément (`features/race/countdown.ts:17-33`, `race-page.ts:58-64`).
- **Gain.** Une trentaine de lignes, un seul point de retrait des écouteurs, couleurs du thème.
- **Effort** S · **Risque** : régressions visuelles à vérifier au clavier et au toucher, en portrait et en paysage ; les écrans sans canevas se comparent par capture si l'essai de R41 est concluant · **Dépend de** —
- **Avis des relecteurs.** Écartés :
  - variables `--spacing-hud-*` (valeurs toutes différentes) ;
  - erreur nommée `WebGLUnavailableError` : l'expression régulière de `describeGameError` (`core/game-session.service.ts:25`) traduit déjà tout message qui cite WebGL, dont celui de `race-renderer.ts:30-33`. En revanche, elle ne couvre pas une vraie perte de contexte : `race-page.spec.ts:361` n'injecte qu'un message `new Error('WebGL context lost')` par `callbacks.onError`, aucun code de `src` n'écoute `webglcontextlost`, et three.js intercepte l'événement sans lever d'erreur (`node_modules/three/src/renderers/WebGLRenderer.js:1113-1121`). Ce manque est traité par R42 ;
  - `KeyBinding` structuré (textes d'interface dans un type du moteur ; l'analyseur actuel est testé).

#### R31 — Réglages du rendu : couches au sol et arroseur

- **Problème.** Voir §2.2 pour les couches au sol. En plus :
  - la hauteur du bras de l'arroseur, 1,95 (`decor.ts:343`), dépend de la géométrie de son pied (`decor-models.ts:382-392`) ;
  - la texture de pelouse est générée deux fois sur les circuits en relief (`garden-world.ts:80`, `135`), soit environ 4 ms chaque fois ;
  - les tailles 256 et 512 sont écrites en littéraux (`textures.ts:141-212`).
- **Proposition.**
  - `GROUND_LAYERS { y, offset }` et un test sur l'ordre des hauteurs seulement. Rendre les décalages cohérents (traces à -2, sous les marquages à -4) est une décision à part, vérifiée par les captures de R41.
  - `SPRINKLER_ARM_Y` exporté, et une constante locale pour la buse.
  - `texture.clone()` pour le maillage du relief : la source est partagée, donc une génération et un envoi GPU en moins.
  - `canvas.size` à la place des littéraux.
  - Facultatif : `sanitizeFrameDt` et `MAX_FRAME_DT` uniques, dans un module sans three.js.
- **Gain.** Dix réglages dans un objet testé ; environ 4 ms de chargement en moins sur les circuits en relief.
- **Effort** S · **Risque** nul à valeurs identiques · **Dépend de** R20
- **Avis des relecteurs.** Écartés :
  - l'alpha dans `PixelCanvas` pour le flocon (le rendu changerait) ;
  - un booléen de fleurs à la place du test `variant === 2` (le nombre de tirages du décor changerait ; une constante nommée suffit) ;
  - `OuterRule.radius` (un champ que personne ne fait varier).

  Le déplacement de la secousse de caméra dans `CameraRig` divise les relecteurs (la caméra dépendrait des événements de jeu) : facultatif.

#### R32 — Aperçu du garage : partager le plafond de pixels et la libération WebGL

- **Problème.**
  - Le plafond de densité de pixels (`dog-preview.ts:135`) recopie `MAX_PIXEL_RATIO` (`race-renderer.ts:9`).
  - La libération avec `forceContextLoss` (`dog-preview.ts:244-246`) recopie `releaseRenderer` (`race-renderer.ts:84-87`).
  - La couleur du kart du joueur est écrite en dur (`dog-preview.ts:40` contre `roster.ts:12`).
  - Le test trie les rappels par `callback.name === 'animate'` (`dog-preview.spec.ts:86`) : un renommage rendrait vide de sens l'assertion `toHaveLength(0)` de la ligne 239.
- **Proposition.**
  - `render/renderer-utils.ts`, avec **seulement** un `import type` de three, pour garder le chargement à la demande.
  - `PREVIEW_KART_COLOR = PLAYER_KART_COLOR`.
  - Un repérage fiable des images dans le test.
- **Gain.** Une seule source pour trois règles.
- **Effort** XS · **Risque** nul · **Dépend de** —
- **Avis des relecteurs.** La classe `TurntablePreview` est écartée (§6) : un seul utilisateur, environ 130 lignes déplacées sans en retirer, et les tests du composant garderaient leurs remplacements de variables globales.

#### R33a — Particules : ne renvoyer les teintes au GPU qu'à l'émission

- **Problème.** `particles.ts:199` marque les 4 attributs à renvoyer au GPU à chaque image, alors que les teintes ne s'écrivent qu'à l'émission (`particles.ts:154-156`).
- **Proposition.** Marquer `tint.needsUpdate` dans `emit()` et le retirer d'`update()`.
- **Gain.** Jusqu'à environ 34 Ko envoyés en moins à chaque image, sans allocation ni changement visuel.
- **Effort** XS · **Risque** nul · **Dépend de** —
- **Avis des relecteurs.** Les trois relecteurs sont d'accord.

#### R42 — Perte du contexte WebGL en course : mettre en pause, puis reprendre ou prévenir

- **Problème.**
  - Le code n'écoute ni `webglcontextlost` ni `webglcontextrestored` : aucune occurrence dans `src`. Seul three.js écoute ces deux événements (`node_modules/three/src/renderers/WebGLRenderer.js:403-405`). Quand le contexte est perdu, three.js appelle `preventDefault`, écrit « Context Lost » dans la console et lève un drapeau (`1113-1121`). À partir de là, `render()` ne dessine plus rien (`1646`).
  - `FixedStepLoop` n'est pas prévenue. Les pas de simulation continuent (`fixed-step-loop.ts:107-118`), tout comme `RaceScene.update`, le HUD à 10 Hz et le son (`game.ts:255-266`). Le joueur entend la course et voit bouger le HUD, mais ne voit ni la piste ni son kart.
  - Seul `visibilitychange` déclenche une pause automatique (`game.ts:325-329`). Une perte de contexte sans changement de visibilité n'arrête donc rien. C'est le cas d'une réinitialisation du GPU, d'une mémoire saturée ou d'un trop grand nombre de contextes (ce dernier cas est déjà cité à `race-renderer.ts:80-82`).
  - Le navigateur peut ne jamais rendre le contexte. C'est un cas connu sur iOS et iPadOS 17 après un passage en arrière-plan (WebKit, bug 261331). La course se poursuit alors sans image jusqu'aux résultats. Et après une pause due à `visibilitychange`, le bouton « Reprendre » relance aussi la course sans image.
  - L'interface sait déjà afficher ce cas. `describeGameError` reconnaît le mot « webgl » (`core/game-session.service.ts:25-26`). Le test le vérifie avec `new Error('WebGL context lost')` (`features/race/race-page.spec.ts:359-369`), et une erreur arrivée pendant la pause ferme le menu et place le focus sur le message (`371-382`). Mais le moteur n'émet jamais cette erreur.
- **Ce qui fonctionne déjà : three.js reconstruit tout lui-même quand le contexte revient.**
  - `onContextRestore` rappelle `initGLContext` (`WebGLRenderer.js:1123-1143`). Cette fonction recrée `WebGLProperties`, les textures, les attributs et les programmes (`464-475`), et remet les réglages d'ombre (`1129-1141`).
  - Les textures repartent donc vers le GPU au prochain dessin. Comme `properties` est neuf, `__version` est indéfini. `setTexture2D` relance alors `uploadTexture` pour toute texture de `version > 0` dont l'image existe (`WebGLTextures.js:559-573`, `914`).
  - Les `CanvasTexture` de `render/textures.ts:260-265` sont dans ce cas : `needsUpdate = true` dans leur constructeur (`CanvasTexture.js:39`), et la texture garde une référence à son canvas 2D. Les `DataTexture` aussi (`textures.ts:123-134`, `snow-park.ts:108-109`), car leurs tableaux restent en mémoire. Rien dans `src` ne vide `image` ni ne libère ces tableaux après l'envoi (`onUpload` : aucune occurrence).
  - Il n'y a donc aucune reconstruction de scène à écrire. Il suffit d'arrêter la course tant que le contexte est perdu.
- **Proposition.** Tout se fait dans `game.ts`, la couche testable. `RaceRenderer` est volontairement mince et ne se teste pas sous Node (`race-renderer.ts:1-4`).
  1. Ajouter un drapeau `contextLost` à côté de `paused` et `disposed` (`game.ts:166-167`).
  2. Poser les écouteurs sur le canvas **après** `createRenderer`. `runCleanups` libère dans l'ordre inverse de création (`game.ts:440-448`) : les écouteurs sont donc retirés avant que `releaseRenderer` n'appelle `forceContextLoss` (`race-renderer.ts:84-87`). En plus, `pause` ne fait rien après la libération (`game.ts:284`, drapeau levé ligne 372).
  3. À la perte : appeler `requestPause()`, qui ouvre le menu de pause habituel. Rien ne se passe sur l'écran des résultats (`game.ts:306-308`). « Rejouer » crée de toute façon un canvas neuf (`features/race/race-page.ts:58-64`).
  4. À la restauration : baisser le drapeau, sans reprise automatique. C'est cohérent avec la règle « la reprise passe par le menu » (`game.ts:169`).
  5. Si le joueur appelle `resume()` alors que le contexte est encore perdu : appeler `callbacks.onError(new Error('WebGL context lost'))`. L'écran d'erreur existant s'affiche, annoncé aux lecteurs d'écran (`role="alert"`) avec le focus sur son titre (`features/race/race-error.ts:14`, `27`).
  ```ts
  // game.ts, à côté de `paused` et `disposed` (l. 166-167)
  let contextLost = false;

  // dans resume(), juste après le garde de la l. 295
  if (contextLost) {
    // Le navigateur n'a pas rendu le contexte : reprendre ferait rouler sans image.
    callbacks.onError(new Error('WebGL context lost'));
    return;
  }

  // section « Écouteurs », après visibilitychange (l. 329)
  // three.js appelle déjà preventDefault : le navigateur peut rendre le contexte, et three.js renvoie
  // alors textures, tampons et shaders au GPU tout seul. En attendant, la course s'arrête.
  const onContextLost = (): void => {
    contextLost = true;
    log('Contexte WebGL perdu');
    requestPause();
  };
  const onContextRestored = (): void => {
    contextLost = false;
    log('Contexte WebGL rendu');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  cleanups.push(() => {
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
  });
  ```
  - **Tests.** Ils vont dans `game.spec.ts`, après « met en pause quand la page est masquée » (`571-585`). Ils envoient un faux événement sur le canvas du banc d'essai (`game.spec.ts:215`) ; le faux renderer n'y attache aucun écouteur (`219`).
  ```ts
  it('met en pause à la perte du contexte WebGL et reprend une fois le contexte rendu', () => {
    const h = harness();
    const game = start(h);
    h.frames.frames(3);
    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(game.paused).toBe(true);
    expect(h.rec.pauses).toEqual([true]);
    expect(h.frames.pending).toBe(0);

    h.canvas.dispatchEvent(new Event('webglcontextrestored'));
    game.resume();
    expect(game.paused).toBe(false);
    expect(h.rec.errors).toEqual([]);
  });

  it('reprendre sans contexte WebGL signale l’erreur au lieu de rouler sans image', () => {
    const h = harness();
    const game = start(h);
    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    game.resume();
    expect(game.paused).toBe(true);
    expect(h.rec.errors).toHaveLength(1);
    expect(String(h.rec.errors[0])).toMatch(/webgl/i);
  });

  it('ignore la perte du contexte provoquée par la libération', () => {
    const h = harness();
    const game = start(h);
    game.dispose();
    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(h.rec.pauses).toEqual([]);
  });
  ```
  Côté Angular, aucun test n'est à ajouter : `race-page.spec.ts:359-382` couvre déjà l'affichage.
  - **Vérification manuelle.** Dans la console du navigateur, pendant une course : `document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`, puis `restoreContext()`. On obtient le même contexte, et cette extension sert justement à simuler la perte. three.js l'expose aussi via `forceContextLoss` et `forceContextRestore` (`WebGLRenderer.js:607-622`).
  - **Aperçu du garage (facultatif, à grouper avec R32).** `features/garage/dog-preview.ts` a son propre contexte.
    - En mode animé, la boucle `animate` redessine seule dès que le contexte revient (`dog-preview.ts:201-210`), car three.js ignore seulement les dessins pendant la perte (`WebGLRenderer.js:1646`).
    - Avec « réduire les animations », l'aperçu ne se redessine qu'au changement de modèle ou de taille (`dog-preview.ts:170`, `198`, `226`). Il reste donc vide après la restauration.
    - Correction : un écouteur `webglcontextrestored` qui appelle `render(stage)`, retiré au début de `teardown`, avant `forceContextLoss` (`246`). Aucune pause n'est nécessaire : il n'y a pas de simulation derrière l'aperçu.
- **Gain.**
  - Sur mobile, là où servent les commandes tactiles, une perte de contexte ne fait plus rouler le joueur sans image. Soit la course s'arrête puis reprend quand l'image revient, soit un message s'affiche si elle ne revient pas.
  - La chaîne d'erreur déjà écrite et testée côté interface reçoit enfin cette erreur.
  - Pas d'allocation par image : on ajoute seulement deux écouteurs.
  - Aucun tirage aléatoire n'est touché. Une boucle arrêtée ne fait aucun pas, et `start()` repart d'un accumulateur vide (`fixed-step-loop.ts:71-77`).
- **Effort** S (une vingtaine de lignes dans `game.ts` et 3 tests ; XS de plus pour l'aperçu) · **Risque** faible · **Dépend de** —. C'est un correctif : `npm run release:patch` et une ligne « Correction » dans le CHANGELOG.
- **Contre-vérification.**
  - *Problème réel ?* Oui. Le comportement se lit directement dans le code de three.js et de la boucle. La fréquence de ces pertes n'a pas été mesurée : il faudrait des appareils réels. La perte sans retour du contexte est documentée chez WebKit.
  - *Plus simple ?* Faire seulement les étapes 1 à 4 couvre une perte brève. Mais « Reprendre » relancerait alors la course sans image si le contexte ne revient pas. L'étape 5 ne coûte que 4 lignes.
  - *Écartés (voir §6) :*
    - une reprise automatique à la restauration : elle surprendrait le joueur en plein virage, et elle contredit `game.ts:169` ;
    - une minuterie « contexte non rendu après N s » : le joueur est déjà en pause, et signaler l'erreur au moment où il veut reprendre suffit, sans horloge en plus ;
    - redessiner une image à la restauration pendant la pause : cela appellerait `RaceScene.update` hors de la boucle, avec `frameDt = 0`, un chemin non testé. Le fond reste vide sous le menu jusqu'à la reprise ;
    - des écouteurs dans `RaceRenderer` avec un rappel vers `game.ts` : cette couche ne se teste pas sous Node (`race-renderer.ts:3`), et il faudrait élargir `RendererLike` sans raison ;
    - un message distinct de « WebGL indisponible » : facultatif. Le message actuel conseille d'activer l'accélération matérielle, ce qui parle peu lors d'une perte passagère. Pour le faire : une branche `/context lost/i` placée avant `/webgl/i` dans `describeGameError`, et `race-page.spec.ts:364` à adapter.
- **Sources.**
  - [MDN : événement `webglcontextlost`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)
  - [MDN : événement `webglcontextrestored`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event) : « les textures et tampons créés avant la perte ne sont plus valides »
  - [Khronos : spécification de `WEBGL_lose_context`](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/) : sans `preventDefault` sur `webglcontextlost`, le contexte n'est pas marqué restaurable
  - [MDN : `WEBGL_lose_context`](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_lose_context)
  - [WebKit, bug 261331 : « WebGL: context lost » après passage en arrière-plan sur iPadOS 17](https://bugs.webkit.org/show_bug.cgi?id=261331)
  - Code source de three.js 0.186.0 dans `node_modules/three` (version lue dans son `package.json`)

### 5.3 Refactorisations moyennes

#### R10 — Mesurer la couverture et automatiser AXE

- **Problème.**
  - CLAUDE.md exige AXE ; `axe-core` est absent, et l'audit décrit par le README (l.164) est manuel et non versionné.
  - Aucune mesure de couverture, alors que 9 gros fichiers de rendu n'ont pas de test propre : `decor.ts`, environ 620 lignes ; `dog-model.ts`, environ 610 ; `decor-models.ts`, environ 500 ; `skin-models.ts`, `beach-models.ts`, `decor-plan.ts` (testé indirectement), `beach-world.ts`, `track-surface.ts`, `item-visuals.ts`.
  - Le focus du titre après navigation n'est testé que pour `/garage` (`app.spec.ts:42-46`). Or il suppose un `tabindex="-1"` sur chaque `h1` (`features/home/home.ts:18`, `garage.ts:23`, `circuit-select.ts:24`, `race-page.ts:56`) : un oubli passerait inaperçu.
- **Proposition.**
  - `@vitest/coverage-v8` et `vitest` alignés sur la même version exacte (~4.1.11), mis à jour ensemble. Script `test:coverage` = `ng test --watch=false --coverage` (option native du builder), sans seuil.
  - `axe-core` 4.13.0 et une aide `expectNoAxeViolations(element)`, avec la règle de contraste désactivée (non fiable sous JSDOM). À appeler sur l'accueil, le garage, les circuits, puis la pause, les résultats et l'erreur de course (dans `race-page.spec.ts`).
  - Une boucle sur les routes dans `app.spec.ts` : naviguer d'abord ailleurs, parce que la première navigation est ignorée (`page-focus.ts:26-28`), et fournir un faux jeu pour `/course`.
  - Le contraste, lui, se vérifie dans un vrai navigateur (R41).
- **Gain.** L'exigence AXE (hors contraste) vérifiée à chaque exécution de la suite ; une carte de couverture avant R12, R18 et R19.
- **Effort** S à M (des violations réelles peuvent apparaître) · **Risque** faible, 0 octet dans le bundle · **Dépend de** R09 (pour la CI) · **Conseillé avant** R12, R18, R19
- **Avis des relecteurs.** Ne pas adopter `vitest-axe` (0.1.0). Ne pas factoriser l'attribut `tabindex` : le test suffit. Le double focus de `race-page.ts:204-207` est à vérifier (utile seulement au redémarrage ?).

#### R41 — Filet en vrai navigateur : Vitest en mode navigateur (Playwright, SwiftShader) pour les appels de dessin, le contraste et les captures

- **Problème.**
  - Trois contrôles restent manuels, alors que cinq fiches retenues touchent au rendu (R16, R18, R27, R31, R33b-c) :
    - le contraste AXE, désactivé sous JSDOM et renvoyé « à un vrai navigateur » (R10) ;
    - le nombre d'appels de dessin (R15, point 4 : protocole manuel) ;
    - l'aspect visuel : « vérifier à l'œil » (R03c), « régressions visuelles à vérifier » (R30), « vérification visuelle » (R31), risque « moyen : différences visuelles » (R33b-c).
  - `RaceRenderer` se dit « non testable en Node » (`race-renderer.ts:3`) : aucun test n'exécute le `WebGLRenderer`. JSDOM n'a ni WebGL ni mise en page ; la position du joystick en `rem` (R03c) ne s'y teste donc pas non plus.
  - Le README annonce des « vérifications réelles » dans Chrome sans affichage, avec captures et axe-core (`README.md:164`). Rien de cela n'est versionné ni rejouable.
  - L'outil est déjà à portée :
    - le builder de tests d'Angular expose `browsers`, `browserViewport` et `headless` (`node_modules/@angular/build/src/builders/unit-test/schema.json:27-39`, `63-66`) ;
    - il cherche d'abord `@vitest/browser-playwright` (`…/unit-test/runners/vitest/browser-provider.js:51-57`) ;
    - Vitest 4.1.11, déjà installé, fournit `toMatchScreenshot` (`node_modules/vitest/dist/chunks/reporters.d.DtoKVV2s.d.ts:1729-1738`).
- **Vérifications faites pour cette fiche.**
  - Une sonde jetable, restée hors dépôt, assemble avec l'esbuild du projet la vraie `createGameWithDeps` et le vrai `RaceRenderer`.
  - Elle joue la course dans Chrome 153 sans affichage : graine 7, pilote automatique, `reducedMotion`, canevas de 800×450, images pilotées à la main, 5 circuits.
  - Poste : Apple M5 Max. Résultats :

  | Question | Résultat |
  |---|---|
  | WebGL sans GPU | **Avec `--disable-gpu` seul, il n'y a pas de contexte WebGL 2** : la course lève le message de `race-renderer.ts:30-33`. Chrome ne se replie plus tout seul sur SwiftShader : il faut le drapeau `--enable-unsafe-swiftshader` (doc Chromium). **Playwright 1.63.0 l'ajoute à chaque lancement de Chromium** (`chromium.ts`, `_innerDefaultArgs`). En 1.55.0, il ne l'ajoutait que sous macOS : ne pas descendre sous la version essayée. Avec ce drapeau, WebGL 2 passe par « ANGLE … SwiftShader driver », et les 5 circuits sont rendus. |
  | Stabilité | Deux processus Chrome séparés, SwiftShader, 84 images de 250 ms : **empreinte des pixels identique au bit près** (`grand-jardin` 6f1e3bd9 ; `plage` e9028b6a, mer animée comprise). Même résultat sur le GPU entre deux passes. Aucun `Math.random` ni aucune lecture d'horloge dans `src/game/render` ; les graines sont fixes (`effects.ts:133`, `decor.ts:138`, `sky.ts:99`, `snow-park.ts:48`, `beach-world.ts:159`, `hedges.ts:47`). L'horloge et les images sont injectables (`game.ts:86-91`, déjà utilisé par `ManualFrames`, `game.spec.ts:115-147`). La graine et le pilote automatique se règlent dans `RaceSetup` (`game-api.ts:15-18`, `game.ts:136`, `179`). |
  | Ce qui varie | **Le moteur de rendu** : entre GPU et SwiftShader, 25,4 % des pixels diffèrent d'au moins un niveau, et 0,21 % dépassent le seuil 0,1 de pixelmatch. **Les polices** des textures de canevas dépendent du système (`textures.ts:305`, `329`). **La densité de pixels** aussi (`race-renderer.ts:43-44`). Il faut donc une référence par plateforme : Vitest nomme les fichiers `…-chromium-linux.png`. |
  | Appels de dessin | **Identiques sur GPU et sous SwiftShader.** Sur la grille de départ : 786 à 828 appels et 0,60 à 1,03 million de triangles par image. À t = 7 s (4 s après le départ) : 784 à 811 appels. La passe d'ombre est comprise, car `info.reset()` précède `shadowMap.render` (`node_modules/three/src/renderers/WebGLRenderer.js:1731-1737`). Ce sont les premiers chiffres de R15 et R33 mesurés dans un navigateur. |
  | Coût | Sous SwiftShader : 0,2 à 0,27 s par image en moyenne sur 84 images (17 à 23 s), et 1,9 à 2,6 s pour les 4 premières images d'un circuit (compilation des shaders). Le GPU rend ces 84 images en 0,2 s. Diviser la résolution par 4 ne fait gagner que 21 % : le coût vient de la géométrie. **Il faut donc limiter le nombre d'images rendues, pas leur taille.** Une capture de 800×450 pèse 580 à 620 Ko. |

- **Proposition.**
  1. **Dépendances de développement, en versions exactes :** `@vitest/browser-playwright@4.1.11` et `playwright@1.63.0`.
     - Épingler aussi `vitest` à `4.1.11` (`package.json:39` indique `^4.0.8`), car cette dépendance paire est stricte (`npm view` : `vitest: '4.1.11'`).
     - **Ne pas prendre** `@vitest/browser-playwright` 5.0.2, la dernière version : il exige vitest 5.0.2, alors que `@angular/build` 22.1.8 attend `vitest ^4.0.8` (`node_modules/@angular/build/package.json:73`).
  2. **Une cible de test séparée.** L'option `browsers` fait passer toute une cible au navigateur (`executor.js:245`, `plugins.js:201-203`), alors que les quelque 900 tests restent sous JSDOM.
     ```jsonc
     // angular.json, dans "architect"
     "test": { "builder": "@angular/build:unit-test",
               "options": { "exclude": ["src/**/*.browser.spec.ts"] } },
     "test-browser": { "builder": "@angular/build:unit-test",
                       "options": { "include": ["src/**/*.browser.spec.ts"],
                                    "browsers": ["chromiumHeadless"], "browserViewport": "800x450" } }
     ```
     - Ajouter un script `test:browser` : `ng run test-opus-5-5:test-browser --watch=false`.
     - Pas de `runnerConfig` : les options de comparaison se passent à chaque appel.
  3. **Un fichier `render/race-renderer.browser.spec.ts`, sur le câblage de production.**
     - `createGameWithDeps` avec la graine 7, `autopilot: true`, `reducedMotion: true`, et des images de 250 ms comme `FAST_FRAME_MS` (`game.spec.ts:264-265`).
     - `ManualFrames` passe dans `src/game/testing` pour être partagé.
     - Pour chaque circuit (`it.each` sur `TRACK_CATALOG`), la grille de départ en 4 images.
     - Plafond d'appels de dessin et de triangles, lu par le `stats()` de R15 (point 1), rangé dans une table littérale. Ces valeurs ne dépendent pas de la plateforme : le test tourne partout.
     - Puis une capture. Recopier le canevas WebGL dans un canevas 2D **dans la même tâche** que le dernier rendu, car le renderer est créé sans `preserveDrawingBuffer` (`race-renderer.ts:24-28`). Ensuite `await expect.element(page.elementLocator(copie)).toMatchScreenshot(id, { comparatorName: 'pixelmatch', comparatorOptions: { allowedMismatchedPixels: 0 } })`, seulement si `server.platform === 'linux'`.
     - Un seul scénario « en course », sur la plage (mer, particules, étiquettes), avec une cinquantaine d'images.
  4. **Dans la même cible, après R10 :**
     - `expectNoAxeViolations` **avec** la règle de contraste, sur l'accueil, le garage (avec `reducedMotion`), les circuits et les dialogues de course ;
     - le test de R03c : police racine à 20 px, pointeur posé, centre de la base sous le pouce à 1 px près.
     - Le texte du HUD posé sur la 3D reste l'affaire des captures : axe calcule le contraste à partir des styles CSS, pas des pixels du canevas.
  5. **CI (après R09) :** un job séparé, en parallèle du job principal.
     - Étapes : `npm ci`, `npx playwright install --with-deps --only-shell chromium`, `npm run test:browser`.
     - En cas d'échec, téléverser `.vitest-attachments` (image obtenue et image des écarts).
     - Pas de cache pour le navigateur : Playwright le déconseille.
  6. **Références.**
     - Ne versionner que les fichiers `*-linux.png` ; mettre `**/__screenshots__/**/*-darwin.png` dans `.gitignore`.
     - Le builder n'a pas d'option de mise à jour (voir R01). Pour un changement visuel voulu : supprimer la référence et relancer. La première passe la recrée et échoue ; la seconde passe. En CI, un workflow manuel (`workflow_dispatch`) peut le faire ; la doc Vitest en donne un modèle, à adapter.
     - En local, sous macOS, les références `darwin` non versionnées servent de photo avant/après : une passe sur `main`, une sur la branche.
     - Chaque montée de Playwright peut changer le rendu de SwiftShader : régénérer les références dans la même PR.
- **Gain.**
  - Trois contrôles manuels deviennent automatiques : le plafond d'appels de dessin par circuit, le contraste AXE des écrans, l'aspect des 5 circuits.
  - R16, R18 (étape 2), R27 et R31 se vérifient au pixel près. « Même image » vaut preuve de non-changement pour le rendu, comme l'empreinte de R01 pour la simulation.
  - R33b-c garde son risque visuel, mais on le voit : image des écarts et appels économisés chiffrés à chaque étape.
  - R03c et R30 se testent au lieu d'être « vérifiés à l'œil ».
  - 0 octet dans le bundle. Aucune ligne de production, hormis le `stats()` de R15. Aucun tirage touché : le test ne fait que lire l'état.
- **Coût en CI (estimation).**
  - Mesuré en local : environ 20 s pour les 5 grilles de départ, 12 à 20 s pour le scénario en course, quelques secondes pour AXE.
  - Non mesuré sur un runner GitHub. SwiftShader dépend du nombre de cœurs : compter un facteur 3 à 10, soit 2 à 7 min de rendu. Il faut ajouter environ une minute pour installer le navigateur (estimation non mesurée), plus la compilation des tests.
  - Au total, un job de 4 à 9 min, en parallèle du job principal. Prévoir un délai de 60 s par test.
  - Minutes : gratuites sur un dépôt public. Sinon, 0,006 $ la minute pour un runner Linux à 2 cœurs, soit 3 à 6 centimes par passage.
  - Taille des dépendances installées, en développement seulement : environ 20 Mo décompressés (`playwright-core` 13,5 Mo, `playwright` 5,1 Mo, `@vitest/browser` 1,8 Mo, `@vitest/browser-playwright` 49 Ko), plus le navigateur téléchargé.
  - Maintenance : `playwright` 1.63.0 publié le 27/09/2026 ; `@vitest/browser-playwright` mis à jour le 25/09/2026.
  - Poids dans le dépôt : 6 références de 800×450 font environ 3,6 Mo, et chaque régénération en ajoute autant à l'historique. Un canevas de 640×360 réduit ce poids sans presque rien changer au temps de rendu.
- **Effort** S à M · **Risque** : faible pour le jeu ; moyen pour la CI (lenteur de SwiftShader, références à entretenir) · **Dépend de** R09 étape 1 (CI), R15 point 1 (`stats()`), R10 (aide AXE, pour le point 4)
- **Verdict : À ESSAYER maintenant, puis ADOPTER si l'essai tient.**
  - L'essai tient en une PR : la cible, les plafonds d'appels des 5 circuits et 2 captures (jardin, plage), dans un job non bloquant.
  - Il devient bloquant, puis s'étend, si trois conditions sont remplies : job de moins de 10 min, 10 passages sans faux échec, références de moins de 3 Mo.
  - Sinon, garder seulement les plafonds d'appels et AXE, qui ne dépendent pas de la plateforme, et abandonner les captures.
- **Contre-vérification.**
  - *Le problème est-il réel ?* Oui. Cinq fiches retenues modifient le rendu, et le seul contrôle actuel est l'œil. Le contraste exigé par CLAUDE.md ne se vérifie que dans un navigateur.
  - *Plus simple ?*
    - Une empreinte littérale des pixels, à la manière de R01, éviterait les PNG. Mais elle ne donne pas d'image des écarts, et il faut une constante par plateforme et par version de Chrome : ce n'est qu'un repli, si le poids des références gêne.
    - `gl` (headless-gl 8.1.6) dans Node : son WebGL 2 n'est qu'expérimental, alors que three exige WebGL 2 depuis r163 (`node_modules/three/src/renderers/WebGLRenderer.js:61`, `102`).
    - `@playwright/test` ajouterait un second exécuteur et un second format de tests, alors que le builder d'Angular pilote déjà Vitest dans le navigateur.
  - *Écartés (voir §6) :*
    - passer toute la suite dans le navigateur : les tests sont écrits pour JSDOM et le stockage injecté, et SwiftShader est lent ;
    - forcer SwiftShader en local pour partager les références : le builder crée lui-même le fournisseur Playwright, sans arguments de lancement (`browser-provider.js:144-169`, `plugins.js:202-203`), et l'équipe Angular ne prend pas en charge le contenu d'un `runnerConfig` (`schema.json:24`) ;
    - `@vitest/browser-preview` : il ne fonctionne qu'avec un affichage (`browser-provider.js:86-94`) ;
    - mesurer des durées d'image en CI : sous SwiftShader, 84 images prennent 22 s contre 0,2 s sur GPU. Le protocole manuel sur téléphone de R15 reste nécessaire.
- **Sources.**
  - Vitest 4.1, lue via context7 (`/vitest-dev/vitest/v4.1.6`) : [Visual Regression Testing](https://vitest.dev/guide/browser/visual-regression-testing) (création d'une référence, le premier passage échoue ; noms par navigateur et plateforme ; modèle de workflow `workflow_dispatch`) ; [toMatchScreenshot](https://vitest.dev/api/browser/assertions#tomatchscreenshot) (captures répétées jusqu'à deux identiques, `allowedMismatchedPixelRatio`) ; [browser.expect](https://vitest.dev/config/browser/expect) (chemin par défaut `…-${browserName}-${platform}`) ; [contexte `server`](https://vitest.dev/api/browser/context).
  - Angular : [Testing, option `browsers`, `chromiumHeadless`](https://angular.dev/guide/testing), et le code du builder cité plus haut.
  - Chromium : [Using Chromium with SwiftShader](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md). Le repli automatique est abandonné ; il faut l'option `--enable-unsafe-swiftshader`.
  - Playwright : [chromium.ts v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/chromium/chromium.ts) (drapeau ajouté à chaque lancement) ; [chromium.ts v1.55.0](https://github.com/microsoft/playwright/blob/v1.55.0/packages/playwright-core/src/server/chromium/chromium.ts) (drapeau ajouté sous macOS seulement) ; [CI](https://playwright.dev/docs/ci) (cache des navigateurs déconseillé) ; [Browsers](https://playwright.dev/docs/browsers) (option `--only-shell`).
  - GitHub : [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) (0,006 $ la minute, Linux 2 cœurs) ; [2026 pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) (dépôts publics gratuits).
  - headless-gl : [stackgl/headless-gl](https://github.com/stackgl/headless-gl) et [issue #141](https://github.com/stackgl/headless-gl/issues/141) (WebGL 2).
  - `npm view`, lancé les 27 et 28/09/2026 : `@vitest/browser-playwright` 5.0.2 (paire `vitest: 5.0.2`) et 4.1.11 (paire `vitest: 4.1.11`, 49 Ko) ; `@vitest/browser@4.1.11` 1,85 Mo ; `playwright` 1.63.0, 5,1 Mo ; `playwright-core@1.63.0` 13,5 Mo, Node >= 20 ; `gl` 8.1.6.
  - Fichiers de la sonde, hors dépôt, dans le dossier temporaire de la session : `webgl-probe.ts` (la sonde), `run-probe.mjs` (premier passage, images de 1/60 s), `run-probe2.mjs` (passages mesurés, images de 250 ms), `compare-png.mjs` (comparaison GPU contre SwiftShader), et les captures `capture2-grand-jardin-swiftshader-1.png`, `capture2-grand-jardin-gpu-1.png`, `capture2-plage-swiftshader-1.png`.

#### R12 — Tests de l'IA sur la vraie physique du kart

- **Problème.**
  - `TestKartPhysics` (`ai/ai-controller.spec.ts:156-265`, 110 lignes) annonce « sans importer `src/game/kart` » (l.157), alors que la ligne 40 l'importe.
  - Elle diverge du moteur sur des points qui règlent l'IA :
    - accélération linéaire (l.234) contre quadratique (`kart-physics.ts:388`) ;
    - surrégime à 8 contre 12 m/s² ;
    - dérapage lancé à l'atterrissage (l.206-213) contre pendant le saut (`kart-physics.ts:336-352`) ;
    - pas de bonus de charge (`kart-physics.ts:318`), pas de volant de dérapage lissé ;
    - choc de haie simplifié, sans réalignement du cap (`kart-physics.ts:481-505`) ;
    - seuils recopiés de constantes privées (l.194, 209).
  - Sont concernés 30 des 59 cas du fichier, ceux qui passent par `simulate()` (l.329-350) : dérapage, épingle, peloton, dégagement.
- **Proposition.**
  - Dans `simulate()`, reproduire l'ordre de `simulation.ts:157-167` : pour chaque pilote, décision puis `stepKart(...)` ; ajouter `resolveKartCollisions` pour le test du peloton si c'est utile.
  - Supprimer `TestKartPhysics` et le commentaire trompeur.
  - Pour chaque test qui casse, établir d'abord s'il s'agit d'un défaut de l'IA ou d'un seuil de test. Un défaut de l'IA se corrige dans une PR séparée, en revérifiant `catalog.spec.ts`.
  - Le scénario « se dégage en reculant » (`896-916`) est à réécrire : la vraie haie réaligne le cap.
- **Gain.** Environ 90 à 110 lignes de fausse physique en moins ; les réglages de l'IA validés contre le vrai kart.
- **Effort** S pour le code, M avec le recalibrage · **Risque** : plusieurs tests échoueront, c'est voulu ; aucun changement de production · **Dépend de** R01
- **Avis des relecteurs.** `createSegmentTrack` reste local (un seul utilisateur ; le `stadium` de `track-validator.spec.ts:8` construit un vrai circuit). Pas de module `testing/kart-sim.ts`. La dépendance à R06 et R11 est retirée.

#### R15 — Mesurer le rendu dans le navigateur avant toute optimisation lourde

- **Problème.** Toutes les estimations de rendu viennent de Node :
  - 442 à 539 maillages ;
  - environ 360 appels de dessin pour les pilotes dans la passe principale, jusqu'à environ 720 avec la passe d'ombre (maximum, sans élimination hors champ) ;
  - jusqu'à environ 240 Ko renvoyés au GPU par image quand les effets sont pleins.

  Rien dans `src` ne lit `renderer.info`. Le résumé `?debug=1` (`game.ts:245-252`) ne donne que le temps, le rang et le tour. Seule mesure faite dans un navigateur, sur un poste de bureau : 784 à 828 appels de dessin par image pour toute la scène, passe d'ombre comprise (sonde de R41).
- **Proposition.**
  1. Une méthode facultative `stats?()` sur `RendererLike` (`game.ts:55-59`), implémentée par `RaceRenderer`, qui ne tourne qu'en débogage. Elle recopie `renderer.info.render.calls` et `triangles` (passe d'ombre comprise dans three 0.186) dans un objet préalloué. Ce point, de quelques lignes, se fait tôt : R41 en a besoin pour ses plafonds d'appels (§5.6, étape 3).
  2. En `?debug=1` uniquement : les durées d'image dans un tampon circulaire préalloué (`Float32Array`) dans `render()` ; p50/p95 et nombre d'images longues calculés au moment du résumé seulement. Les pauses du ramasse-miettes ne se lisent pas depuis la page, il faut une trace DevTools.
  3. Un test Vitest déterministe qui borne, pour chaque circuit, le nombre de maillages et de maillages projetant une ombre.
  4. Le plafond d'appels de dessin par circuit devient un test en vrai navigateur (R41). Seul reste manuel, écrit dans `docs/` : un téléphone moyen via `chrome://inspect` (`/course?autopilot=1&debug=1`, les 5 circuits ; durées d'image, pauses du ramasse-miettes).
- **Gain.** Un classement chiffré des optimisations de R33, pour éviter les chantiers sans gain.
- **Effort** M (l'instrumentation des points 1 à 3 est S ; le gain n'existe qu'après la campagne du point 4) · **Risque** faible (débogage seulement, aucune allocation par image) · **Dépend de** — · **À placer** : point 1 avant R41 (§5.6, étape 3) ; le reste juste avant R16 et R33 (étape 7)
- **Avis des relecteurs.** AXE est sorti de cette fiche (voir R10). Les « pauses GC » ne se comptent pas depuis la page. Il faut adapter les doublures de test de `RendererLike`.

#### R17 — Déverrouillage audio d'iOS regroupé dans un module

- **Problème.**
  - `startRace` est une fermeture de 274 lignes (`game.ts:129-402`).
  - Le déverrouillage audio d'iOS y est réparti en 3 endroits (`154-161`, `331-350`, `397-399`) et lit les variables globales `navigator` et `Audio` (l.155, 159). Les tests doivent donc les remplacer (`game.spec.ts:630-634`).
- **Proposition.**
  - `audio/audio-unlock.ts` : `createAudioUnlock(doc, audio, { nav = navigator, createElement = () => new Audio() })`, qui renvoie `{ tryNow(), dispose() }` et regroupe session de lecture, boucle muette et écouteurs de gestes.
  - Garder l'ordre de libération : écouteurs retirés avant le moteur audio.
  - Facultatif : un « rapporteur de course » (phase, résultats une seule fois, HUD, résumé de débogage) testable sans course complète. Deux relecteurs le soutiennent ; l'avocat du diable le juge inutile, parce que la course d'intégration `game.spec.ts:452` reste nécessaire.
- **Gain.** Déverrouillage testé seul ; 2 remplacements de variables globales en moins ; `startRace` passe à environ 240 lignes (environ 170 avec le rapporteur).
- **Effort** M · **Risque** faible, avec un essai manuel sur iPhone en mode silencieux · **Dépend de** — (aucun tirage déplacé)
- **Avis des relecteurs.** Ne pas injecter `TouchInput`, qui est pur et déjà testé tel quel (`game.spec.ts:374-414`).

#### R18 — `Effects` : tests manquants puis dédoublonnage dans le fichier

- **Problème.**
  - `render/effects.ts` fait 715 lignes et sa classe 597 ; `update` a une complexité de 31 (`344-482`). Chaque nouvel objet l'a allongée de 35 à 50 lignes.
  - Quatre créations d'`InstancedMesh` identiques (`168-220`).
  - `burst` prend 11 paramètres positionnels (`679-691`), et sa croissance dépend de l'identité de la réserve (`696`).
  - Le palier de dérapage est typé `number`, avec des replis (`492`, `497`, `532`, `535`), alors que `DriftTier` existe (`types.ts:95`).
  - Aucun test des notes du sifflet, du halo du collier, des étoiles ni des flammes de turbo (`424-477`, `389-402`).
- **Proposition.**
  1. D'abord les tests manquants.
  2. Puis, dans le même fichier et sans changer l'API :
     - une fonction locale `dynamicInstances(...)` ;
     - une table de module `BURSTS` de gerbes nommées, avec la croissance comme champ explicite, le même ordre de tirages et aucune allocation par image ;
     - `DriftTier` et `Record<DriftTier, Color>`.
  3. Facultatif, seulement si la classe dépasse encore environ 400 lignes : extraire les marqueurs d'état (étoiles, notes, halo), la seule partie qui grossit à chaque objet.
- **Gain.** 60 à 80 lignes en moins, plus de paramètres positionnels, trois comportements récents couverts par des tests.
- **Effort** S à M · **Risque** : garder un seul flux de tirages `0xeffec7`, sans fermeture ni objet créé à chaque image · **Dépend de** R02 (étape 1)
- **Avis des relecteurs.** Les `InstancedMesh` non libérés ne sont pas une fuite : le contexte WebGL est rendu à chaque course (`race-renderer.ts:70-87`). Écartés : le découpage en 4 modules derrière une façade (un seul utilisateur, contexte partagé lourd, risque sur l'ordre des tirages), `pump()` et `emitWheelPuff()`. Un relecteur signale, **à vérifier**, que les gerbes n'ont pas de plancher relatif au sol.

### 5.4 Chantier lourd, conditionné à la mesure

#### R33b-c — Optimisations de rendu, seulement si R15 montre un dépassement

- **Problème (estimations à confirmer).**
  - Environ 45 maillages par pilote, tous projetant une ombre (`dogs/model-resources.ts:155`).
  - Mer de 6 771 sommets recalculés sur le processeur à chaque image (`beach-world.ts:221-287`, environ 81 Ko envoyés).
  - 2 600 flocons (`snow-park.ts:47-94`, environ 31 Ko).
  - Alpha des traces de pneus renvoyé à chaque image (`skid-marks.ts:141-144`, environ 38 Ko).
- **Proposition, une étape par PR, chacune validée par la mesure.**
  1. Une option `castShadow = false` pour les petites pièces de tête. Adapter `racer-model.spec.ts:123`, qui exige aujourd'hui que toutes les pièces projettent une ombre.
  2. Fusionner par groupe rigide les pièces statiques de **même matériau** (fourrure du corps, carrosserie) : environ 45 → 30 maillages. Garder à part les pivots animés et les noms cherchés par les tests. Baisser ensuite `MAX_MESHES` par paliers.
  3. Traces de pneus : un attribut « instant de naissance » et le fondu calculé dans le shader, pour ne plus rien envoyer à chaque image.
  4. Seulement si le coût est mesuré : vagues et neige dans le vertex shader (via `onBeforeCompile` pour la mer) ; unification des matériaux par couleurs de sommets pour descendre vers environ 15 maillages.
- **Gain.** De 100 à 250 appels de dessin et jusqu'à environ 150 Ko d'envoi par image en moins, selon le thème ; sensible surtout sur mobile.
- **Effort** L au total (M par étape) · **Risque** moyen : différences visuelles (visibles dans les captures de R41), tests par nom · **Dépend de** R15 · **Conseillé après** R41
- **Avis des relecteurs.** Il y a 8 pilotes, et non 16. 720 appels de dessin n'est un maximum qu'avec la passe d'ombre. Écartés :
  - `addUpdateRange` comme méthode générale : il alloue un objet par appel, et le tampon circulaire imposerait deux plages ;
  - les normales analytiques de la cape (81 sommets) ;
  - la réutilisation de l'échantillon de projection dans `collideWithTrack` : c'est un changement de simulation, à rouvrir seulement si R15 montre des pauses du ramasse-miettes.

### 5.5 À ne pas faire

Ces fiches répondent à des propositions qui reviennent souvent. Le statu quo l'emporte sur chacune, avec des preuves. Elles sont à réexaminer seulement si les conditions indiquées changent.

| ID | Ne pas faire | Pourquoi (preuves) | À réexaminer si… |
|---|---|---|---|
| R34 | ECS (bitecs, koota, miniplex, ecsy) ; simulation en tableaux par champ ; cœur immuable ; état de course en classes ; objets « à la Unity » ; ordonnanceur générique de systèmes | Voir §2.1. Correction des relecteurs : koota n'est pas « pensé pour React » (React y est une dépendance facultative), mais reste en 0.x. Le retrait de bitECS est déterministe mais ne garde pas l'ordre de création (`item-system.ts:297-308`, `495-500`). Les 10-13 µs par pas sont une mesure de la revue sur un poste de bureau, pas un banc du dépôt. | … au moins une centaine d'entités, ou un besoin de rejeu à état complet |
| R35 | `enum` et `const enum` ; hiérarchies `Item`/`Bone` ou classes de thème ; statut unique du kart ; union discriminée pour `RaceState`/`DriftState` ; classe `ItemQueue` ; types marqués partout ; `noUncheckedIndexedAccess` ; `erasableSyntaxOnly` maintenant | Voir §2.5. Chiffres corrigés : environ 14 unions, une vingtaine de `Record`, 310 erreurs (1 091 avec les tests), environ 74 lectures de `drift.*` et `.phase` hors tests. | … un outil exécute directement les `.ts` sans compilation |
| R36 | NgRx SignalStore, `@ngrx-toolkit/core`, `resource()` pour la session, Redux DevTools, `@angular/cdk` | 2 stores seulement, déjà en signaux et conformes à CLAUDE.md. `watchState` écrit l'état initial ; `withStorageSync` perd le stockage injecté (6 fichiers de tests) et exige `@ngrx/store` ; la session se termine sur `onReady` et libère avec `dispose` ; le HUD publie à 10 Hz. | … au moins 3 stores partagés contenant des collections |
| R37 | Remplacer les briques maison (rendu, physique, audio, entrées) par des bibliothèques | Voir le tableau du §2.4. Corrections des relecteurs : seedrandom et mainloop.js ont des types via `@types` ; les 12 et 9 Mo de Rapier et planck sont des tailles décompressées ; `DogLook` a 35 champs, dont le portrait lit 12 ; environ 1 700 lignes de tests reposent sur l'injection ; Tone.js accepte un contexte fourni, mais reste un singleton mal adapté. | … un vrai besoin nouveau (physique rigide, fichiers audio) |
| R38 | Bibliothèque de validation de schéma pour les circuits et les réglages | Circuits internes validés à l'import. Les contrôles géométriques (`circuit-loader.ts:62-77`) et croisés (`138-139`) resteraient écrits à la main. 9 assertions « Coin n » dans 4 tests. `parseSettings` (17 lignes) se replie champ par champ. | … import de circuits par l'utilisateur (alors valibot, ou zod/mini) |
| R39 | `config.ts` unique ; réglages en JSON ; panneau livré ; registre d'objets commun ; bus d'événements ; fusionner `DisposalBag`/`ResourceScope`, `paintedGeometry`/`mergeParts`, les 4 fonctions de matrice ; composant HUD ou `RadioCard` générique ; unifier les seuils ou couleurs qui divergent ; éclater `core/types.ts` (395 lignes, contrat voulu) ; baisser la complexité des `switch` plats ; regrouper `DogLook` | Voir §2.2 et §2.3. **Exception** : les vrais doublons `smoothTowards` et `Disposable` sont bien fusionnés (R23). Ajouter un commentaire croisé sur les seuils de contre-sens. | — |
| R40 | Vecteurs mutables ou pooling dans la simulation ; grille spatiale (28 paires) ; `stepRace` en deux phases ; couper les ombres sans mesure ; supprimer l'allocation de l'instantané du HUD (10 Hz, nécessaire aux signaux) ; jscpd ; knip bloquant ; vitest-axe ; fast-check ; dependency-cruiser | Les positions sont remplacées exprès, parce qu'elles sont partagées (`collisions.ts:88`, `99-100`). Deux phases changeraient les trajectoires (`simulation.ts:157-162`). `no-restricted-imports` ne suffira qu'**une fois ESLint installé** (R04). | … R15 montre des pauses du ramasse-miettes sur mobile |

### 5.6 Ordre conseillé d'exécution

Chaque fiche, ou chaque étape de fiche, est une petite PR, livrable seule, avec des tests verts. Selon CLAUDE.md, chaque PR monte la version une fois : `npm run release:patch` pour une correction ou une refactorisation, `release:minor` si un comportement visible est ajouté. Elle ajoute aussi une ligne au CHANGELOG, en français (« Correction » ou « Modification »).

L'ordre suit deux règles, dans cet ordre :
1. Une fiche passe après ses prérequis, et seulement après eux (voir le graphe ci-dessous).
2. Quand les prérequis sont remplis, c'est la gravité du §5.1 qui décide : d'abord ce que voit le joueur, puis les risques latents, puis la dette. L'effort (de XS à L) ne décide pas de l'ordre.

**Graphe des dépendances.** Il est reconstruit à partir des champs « Dépend de » des fiches, puis corrigé. Les fiches absentes du tableau n'ont aucun prérequis.

| Prérequis | Débloque | Nature |
|---|---|---|
| R01 | R02 (étapes 1 et 2), R06, R12, R13 (A et C), R19 | Obligatoire, sauf pour R02 où il est seulement conseillé |
| R02 étape 1 | R18 | Obligatoire |
| R09 étape 1 (CI) | R04 phase 1, R10, R41 | Obligatoire pour la CI |
| R04 phase 1 | R05 ; R14, qui débloque ensuite R04 phase 2 | Obligatoire (sans R04, R05 revient à `assertNever`) |
| R05 | R28, R29 | Obligatoire |
| R13 C | R19 | Obligatoire |
| R20 | R27, R28, R31 | Obligatoire (voir correction 3) |
| R15 point 1 (`stats()`) | R41 | Obligatoire |
| R15 | R33b-c | Obligatoire |
| R15 | R16 (les parties « à mesurer ») | Conseillé : R15 fournit la mesure « avant » |
| R10 | R12, R18, R19 | Conseillé : R10 fournit la carte de couverture |
| R10 | R41, point 4 (AXE avec contraste) | Obligatoire pour ce point |
| R41 | R16, R18, R27, R31, R33b-c | Conseillé : R41 fournit les captures « avant » |

**Corrections apportées aux champs « Dépend de »**
1. **Cycle R04 ↔ R09.** R04 dépendait de R09, et R09 de R04 pour la partie lint. Mais c'est R04 qui branche son propre lint dans la CI. R09 ne dépend donc de rien : sa CI démarre sans lint, et R04 l'ajoute ensuite.
2. **R13 ne dépend plus de R05.** La partie A change les conditions `waited && racer.rank > 1` (`ai-controller.ts:455`, `459`, `463`), qui sont dans un `switch` qui renvoie une valeur (`ai-controller.ts:447-464`), déjà vérifié par `noImplicitReturns` (§2.5). La seule raison de la dépendance, la conversion en `switch` de la chaîne de `if` de `moveEntities` (`item-system.ts:321-323`), est passée de R13 C à R05.
3. **R28 dépend aussi de R20.** La fiche R20 se présente comme le filet obligatoire avant R27, R28 et R31.
4. **R15 n'est le prérequis que de R33b-c, et son point 1 celui de R41.** Rien ne justifie de faire passer la campagne de mesure avant des corrections.

**Ordre**

1. **Filet déterministe : R01** (effort S). C'est le seul prérequis des corrections.

2. **À corriger (§5.1, n° 1 à 4) : R02 étape 1 et R13 A en parallèle, puis R03 et R42 en parallèle.**
   - R02 étape 1 touche `race-scene.ts`, `racer-visuals.ts`, `hud.ts`, `effects.ts`, `game.ts` et `kart-physics.ts`. R13 A touche `item-system.ts` et `ai-controller.ts`. Ces fichiers sont disjoints, donc les deux fiches peuvent avancer en même temps.
   - R03 passe après R02 étape 1, car les deux modifient `hud.ts` : R02 à la ligne 68 (`boosting`), R03 à la ligne 54 (arrondi du compte à rebours).
   - R42 n'a aucun prérequis, pas même R01, car il ne change pas la simulation. Il passe après R02 étape 1 parce que les deux modifient `game.ts` (l.210 pour R02 ; l.166-167, 295 et 329 pour R42).
   - R13 A change la fin de course. On met donc à jour l'empreinte de R01 dans la même PR, avec la raison dans le message de commit. R02 étape 1, R03 et R42 ne la changent pas.

3. **Risque latent, outillage (§5.1, n° 11) : R09 étape 1 (CI) → R09 étape 2 (reformatage) → R04 phase 1 (lint dans la CI) → R10 (AXE et couverture) ∥ R15 point 1 (`stats()`) → R41 (essai non bloquant, puis bloquant si les critères sont tenus).**
   - On place l'outillage avant les autres risques latents pour deux raisons. Il protège toutes les PR qui suivent. Et il fixe le seul **point de synchronisation** de la feuille de route.
   - **Le point de synchronisation.** Au moment du reformatage, aucune autre branche ne doit être ouverte. Toutes les branches suivantes partent du `main` reformaté.
   - **Pourquoi c'est le bon moment.** `prettier --check` signale 27 fichiers sous `src/`.
     - Les étapes 1 et 2 n'en touchent qu'un seul : `styles.css`, et seulement un commentaire (R03). `game.ts` et `game.spec.ts`, modifiés par R01, R02 et R42, sont déjà conformes.
     - Les étapes suivantes en modifient au moins 14 : `ai/personality.ts` et `features/garage/stat-bar.ts` (R11) ; `core/settings.store.ts` et `features/race/hud/minimap.ts` (R14) ; `audio/synth.ts` (R23) ; `audio/continuous-sounds.ts` (R23, R16) ; `core/page-focus.ts` (R23) ; `core/game-session.service.spec.ts` (R23, R25) ; `features/race/race-page.ts` (R25) ; `features/garage/breed-picker.ts` et `styles.css` (R30) ; `features/garage/dog-preview.ts` (R29, R32, partie facultative de R42) ; `features/garage/dog-preview.spec.ts` (R32) ; `app.spec.ts` (R10).
     - `ng add angular-eslint` (R04) ajoute de plus la cible `lint` dans `angular.json`, qui fait aussi partie des fichiers à reformater.
   - **R10 n'a qu'une place, celle-ci.** Elle vient après la CI dont R10 dépend, et avant R12, R18 et R19, à qui sa carte de couverture sert. Chaque violation AXE réelle qu'il révèle devient une PR « Correction », traitée aussitôt, au même rang que les corrections de l'étape 2.
   - **R41 ferme l'étape**, avant les fiches qui modifient le rendu (R27, R31, R18, R16, R33b-c), pour que leurs captures « avant » existent. Il peut avancer en parallèle de R10 ; seul son point 4 (AXE avec contraste) attend l'aide de R10.

4. **Risque latent : contrats, types et tests. Ordre : R05 → R20 → R28 → R29 → R08 → R06 → R12 → R27 → R21 → R22 → R26.**
   - Cet ordre suit les rangs du §5.1 : n° 6, puis 8, 9, 10, 12 et 13. R20 passe juste avant R28 et R27, qu'il protège.
   - R05 suppose R04 livré ; sinon, garder `assertNever`.
   - R08 et R26 ne sont pas des corrections visibles. Les textes de R08 sont justes aujourd'hui, et R26 ne change aucun son.

5. **Dette, hygiène : R23 → R11 → R31 → R14 → R04 phase 2 → R24 → R25 → R30 → R32 (avec la partie facultative de R42) → R02 étape 2 → R13 C.**
   - R13 B se fait seulement après la décision de l'auteur (§5.7), et après R13 C.

6. **Dette, points chauds : R19 → R18 → R17.**

7. **Dette, performance du rendu : R15 (points 2 à 4) → R16 → R33a → R33b-c.**
   - Une étape par PR, avec les captures de R41. R33b-c ne se fait que si R15 montre un dépassement.
   - R15 donne la mesure « avant » de R16 et de R33a, et décide si R33b-c est utile.

Après le reformatage, deux fiches d'une même étape qui ne modifient pas les mêmes fichiers peuvent avancer en parallèle. Avant, ce n'est possible que pour R02 étape 1 et R13 A, puis pour R03 et R42.

**En résumé :** R01 → (R02 ét. 1 ∥ R13 A) → (R03 ∥ R42) → R09 ét. 1 → R09 ét. 2 → R04 ph. 1 → (R10 ∥ R15 pt 1 → R41) → R05 → … → R13 C → R19 → R18 → R17 → R15 → R16 → R33a → R33b-c.

**Ce qui a changé depuis la première version de cet ordre**
- Les corrections visibles attendaient cinq fiches (R01, R09 avec son reformatage, R04, R20 et R15), dont deux d'effort « S à M ». Elles n'attendent plus que R01, leur seul prérequis ; R42 n'attend rien.
- R15 est coupé : son point 1 sert R41 à l'étape 3, et sa campagne de mesure passe en dernier, juste avant R16 et R33, à son rang du §5.1 (n° 18, dette).
- R20 rejoint les contrats, juste avant les fiches qu'il protège. R12 remonte parmi les risques latents, à son rang (n° 10).
- R10 n'apparaît plus qu'une fois. R08 et R26 quittent les « corrections visibles ». R16 et R33a quittent l'hygiène pour la performance.
- Les étapes portent un nom de rôle et non plus un nom de catégorie d'effort, pour ne pas confondre l'ordre et le coût.

### 5.7 Questions pour l'auteur (décisions de gameplay)

Le code ne permet pas de trancher ces points. Chaque recommandation garde le comportement actuel par défaut et le fige par un test.

- L'écureuil doit-il ignorer l'immunité après un coup (`item-system.ts:464`) ? (R02)
- Deux objets identiques d'affilée : l'IA doit-elle attendre un nouveau délai pour le second (`ai-controller.ts:421-425`) ? (R13)
- Faut-il recoller la couronne des palmiers sur le tronc, et revoir leur encombrement (`beach-world.ts:44`, `127-129`) ? (R20)
- Le rayon du poste de maître-nageur (3,8 dans `plage.json:26`, environ 4,3 m mesurés) est-il à corriger ? Le changer déplace le décor semé ensuite. (R28)
- Traces de pneus au-dessus des marquages en hauteur, mais en dessous en décalage de profondeur : faut-il aligner les décalages (vérification visuelle) ? (R31)

---

## 6. Recommandations écartées à la contre-vérification

**Recommandation entière écartée**

| Proposition | Raison |
|---|---|
| **R07** — Un flux aléatoire par consommateur (`deriveSeed`) et une fabrique `createAiDriver` | L'avocat du diable réfute ; les deux autres relecteurs ne voient qu'un gain modeste. Les tirages en course dépendent de l'état (rang et moment où l'on touche une boîte, `item-system.ts:308`, `item-rules.ts:40-55` ; entrée en virage, `ai-controller.ts:323-325`). Séparer les flux ne rend donc pas l'IA et les objets indépendants : toute retouche de l'IA change quand même les objets obtenus. Les 4 tirages du contrôleur de repli ont lieu après que les résultats sont figés (`simulation.ts:170-179`, puis `196-199`). Le mode pilote automatique qui change les objets n'est qu'un mode de débogage. `createAiDriver` n'aurait que deux appels d'une ligne. **À rouvrir** si un rejeu de course ou un « fantôme » est un jour prévu. |

**Parties écartées de recommandations retenues**

| Proposition | Reco. | Raison |
|---|---|---|
| Extraire `createRaceRun` ; hacher les positions dans l'empreinte | R01 | Les câblages de test divergent volontairement ; le hachage est redondant dans une simulation chaotique |
| Une `savePreviousPose` commune | R02 | Les trois copies ne copient pas les mêmes champs, et c'est voulu |
| Ajouter à `aheadGap` la garde de `trackGap` | R03 | Ce n'est pas un bug, et la « correction » causerait une fausse prise d'écureuil |
| Règle « application → façade seule » dès maintenant | R04 | Environ 33 erreurs dès le premier passage : elle passe en phase 2 après R14 |
| Préréglage typé complet (`recommendedTypeChecked` + `stylisticTypeChecked`) | R04 | 51 erreurs, dont 42 dans les tests (23 `no-unsafe-*` sur des doublures), pour 9 remarques de style dans le code. Les 2 règles typées ciblées suffisent |
| « Ne pas activer `prefer-on-push-component-change-detection` » | R04 | Faux en 22.5 : la règle signale un composant qui sort d'`OnPush` et, avec `allowExplicitOnPush: false`, un `OnPush` explicite, ce qui est exactement la règle de CLAUDE.md |
| `BREED_IDS` ; `ItemEntityKind` écrit en positif | R05 | Une troisième énumération ; l'`Exclude` actuel est déjà sûr |
| `core/assert-never.ts` et `default: assertNever` dans `useItem` et `ItemVisuals.update` | R05 | Redondant avec `switch-exhaustiveness-check`, qui signale le 9e objet à `item-system.ts:127` et `render/item-visuals.ts:248` (sonde). À reprendre seulement si R04 n'est pas livré |
| `template/require-switch-default` obligatoire | R05 | 3 `@switch` partiels voulus recevraient un `@default {}` vide |
| « Tout l'état dans `RaceState` » ; remise à zéro de la mémoire dans `resetDrift` ; convention `Vec2` unique | R06 | Faux (l'IA garde son état) ; changerait les trajectoires ; deux usages de `Vec2` différents et légitimes |
| Fusion des SVG de l'os ; jauge générique `itemTimer` | R08 | Gain nul ; un seul objet concerné |
| Hooks `pre*` ; retrait de `vitest/globals` | R09 | Gain nul ; le builder impose déjà les variables globales |
| `WALL_*` et décalages de lancer déplacés ; `AI_DIFFICULTY` dans `core` ; tests qui importent leurs oracles ; `TEST_TUNING` recalculé | R11 | Réglages internes à un seul module ; tests rendus tautologiques |
| `testing/kart-sim.ts` ; `createSegmentTrack` déplacé | R12 | Un seul utilisateur |
| Catalogue d'objets commun ; `ITEMS` imbriqué ; `ENTITY_VISUALS` ; politique IA en fermetures | R13 | Environ 1 fichier gagné par objet, 92 références à renommer, `switch` recréé |
| Façade `game-data.ts` ; libellés de thèmes déplacés dans le moteur | R14 | Pas de gain de bundle, risque de code à effet de bord dans chaque chunk ; ce sont des textes d'interface |
| Playwright et AXE dans le banc de performance | R15 | Un banc de performance sous Playwright ne mesurerait rien d'utile en CI (SwiftShader, sans GPU : 84 images en 22 s contre 0,2 s). Playwright entre plutôt comme fournisseur de Vitest pour les appels de dessin, le contraste et les captures (R41). AXE relève de R10 |
| « Projection d'abord » dans `heightAt` ; tri des événements des effets | R16 | Ralentirait le chargement ; code exécuté par événement et non par image |
| Injection de `TouchInput` | R17 | Classe pure, déjà testée telle quelle |
| `Effects` découpé en 4 modules ; `pump()` ; `emitWheelPuff()` | R18 | Un seul utilisateur, contexte partagé lourd, risque sur l'ordre des tirages, pas de gain en lignes |
| Rayon des palmiers relevé ; seuil global de hauteur | R20 | Rebat le plan ; affaiblit l'invariant existant |
| Refonte de `HudSnapshot` ; déplacement de `driftAssist` ; `speedKmh` brut | R22 | 7 à 9 fichiers pour un cast ; décision de jeu ; garde contre NaN testée |
| `core/math.ts` avec réexports ; `forwardDot` ; `matrixOf` → `transform` ; drapeaux `destroyed` retirés d'un seul composant | R23 | Beaucoup d'imports déplacés sans doublon retiré ; lisibilité ; incohérence |
| Placement de kart commun ; `entry()` commun ; grille des faux circuits à 12 m ; `createTestRace` sur `createRaceState` ; test des modèles à 40 constructions ; `aria-current` | R24 | Invariants volontairement différents ; oracle perdu ; détection des interactions perdue ; mauvais usage d'ARIA |
| Un seul signal d'état pour `GameSessionService` | R25 | Environ +5 lignes, autant de retouches par champ, flux indépendants |
| Module `audio-cues.ts` ; table `SMOOTHING` | R26 | Un seul utilisateur ; nomme seulement 3 valeurs |
| `garden-theme.ts`, `SceneTheme` réduit à `OutdoorStyle`, renommages, brouillard égal à l'horizon par défaut, `DecorColors` facultatives, palette scindée | R27 | Reporté au 4e thème ; brouillard faux pour la plage ; sapin effacé sans erreur |
| `OutdoorStyle.landmarks` ; découpage de `buildDecor` | R28 | Test de rivage perdu ; code linéaire, ordre des tirages toujours implicite |
| `SkinId` dans `core/types.ts` et `SkinSelection` resserré ; `buildDog` sous 80 lignes ; `TAIL_STYLES` ; regroupement des littéraux d'animation | R29 | Modifications inutiles ; variables locales partagées ; aucun bug évité |
| `--spacing-hud-*` ; `WebGLUnavailableError` ; `KeyBinding` structuré | R30 | Valeurs toutes différentes ; l'expression régulière traduit déjà tout message qui cite WebGL (la vraie perte de contexte, elle, n'est pas signalée : R42) ; parseur testé |
| Alpha dans `PixelCanvas` ; booléen de fleurs ; `OuterRule.radius` | R31 | Rendu changé ; tirages changés ; champ que personne ne fait varier |
| Classe `TurntablePreview` | R32 | Un seul utilisateur ; environ 130 lignes déplacées ; les remplacements de variables globales restent |
| `addUpdateRange` comme méthode générale ; normales de la cape ; réutilisation de l'échantillon de projection | R33 | Alloue un objet par appel ; coût négligeable ; touche la simulation sans gain mesuré |
| Toute la suite dans le navigateur ; SwiftShader forcé en local ; `@vitest/browser-preview` ; durées d'image en CI ; `gl` (headless-gl) ; `@playwright/test` | R41 | Tests écrits pour JSDOM et SwiftShader lent ; le builder ne transmet pas d'arguments de lancement ; mode avec affichage seulement ; 84 images en 22 s sous SwiftShader ; WebGL 2 expérimental alors que three l'exige ; second exécuteur de tests |
| Reprise automatique à la restauration ; minuterie « contexte non rendu » ; redessin pendant la pause ; écouteurs dans `RaceRenderer` | R42 | Contredit `game.ts:169` ; l'erreur au moment de reprendre suffit ; chemin `frameDt = 0` non testé ; couche non testable sous Node |

---

## 7. Méthode

- **Tranches.** Douze tranches lues en entier :
  - colonne vertébrale du moteur ;
  - simulation et physique ;
  - objets et IA ;
  - circuits ;
  - audio et entrées ;
  - chiens et modèles 3D ;
  - rendu de course ;
  - rendu des mondes ;
  - plage, terrain et textures ;
  - Angular racine et core ;
  - Angular écrans et HUD ;
  - tests et outillage.
- **Angles transverses.** Huit angles appliqués à tout le code : paradigme, gestion d'état Angular, modélisation des types, réglages éparpillés, généralisation et doublons, bibliothèques, performance, métriques.
- **Mesures.** Scripts Node en lecture seule : analyse de l'AST avec le TypeScript du projet, détecteur de copier-coller, `tsc` 6.0.3 avec des tsconfig de sonde, bancs de performance assemblés avec l'esbuild du projet et lancés sous Node 24 (poste de bureau), `git log`. Versions et dépendances des bibliothèques vérifiées par `npm view` les 27 et 28/09/2026, et dans la documentation actuelle (context7, angular.dev, documentations des projets). S'y ajoutent, à la révision du 28/09 :
  - un essai ESLint en lecture seule (10.11.0, typescript-eslint 8.70.1, angular-eslint 22.5.0) sur une copie de `src/` hors dépôt, et des sondes de mutation (9e objet, 23e décor, cas de gabarit retiré) vérifiées par `tsc`, `ngtsc` et le lint (R04, R05) ;
  - une sonde WebGL jouée dans Chrome 153 sans affichage, sur GPU et sous SwiftShader, assemblée avec l'esbuild du projet (R41) ;
  - une lecture du code de three.js 0.186 sur la perte et la restauration du contexte WebGL (R42).
- **Contre-vérification.** Les 40 recommandations consolidées ont chacune été relues par trois relecteurs indépendants :
  - *preuve* : chaque emplacement relu, chaque chiffre recompté ;
  - *coût-bénéfice* : effets sur le déterminisme, les tests, le rendu à chaque image et le bundle ;
  - *avocat du diable* : existe-t-il plus simple, ou faut-il ne rien faire ?

  Leurs corrections de faits sont intégrées au texte. Une recommandation est écartée entière (R07), et de nombreuses parties sont retirées (§6). R41 et R42, ajoutées à la révision, portent leur propre contre-vérification.
- **Arbitrages entre tranches.**
  - `TestKartPhysics` est remplacée plutôt que conservée (R12).
  - Les empreintes de R01 passent avant toute modification de la simulation.
  - ESLint plutôt qu'un test « d'architecture » (celui-ci ne sert que de repli pour la dépendance transitive vers three.js).
  - knip en lancement ponctuel.
  - Les règles d'état du kart vont dans `core/kart-state.ts`.
  - `constants.ts` reste un seul fichier.
  - L'état unique de `GameSessionService`, d'abord retenu, est écarté par les relecteurs.
- **Limites.**
  - Les chiffres de performance viennent de Node sur un poste de bureau, pas d'un navigateur mobile : c'est l'objet de R15. Seuls les appels de dessin et les triangles ont été relevés dans un navigateur de bureau (R41).
  - Quelques chiffres cités par une tranche n'ont pas été reproduits par les relecteurs. Ils sont signalés comme tels ou remplacés par la valeur recomptée (poids de zod, nombre de lignes, décomptes d'unions et de `Record`).
- **Manques connus, de gravité basse, non traités par cette revue.**
  - *Maintenance des dépendances.* R09 ne prévoit ni `npm audit`, ni Renovate ou Dependabot, ni règle de mise à jour groupée. Or :
    - `vitest` est déclaré en `^4.0.8` (`package.json:39`), alors que `@vitest/coverage-v8` 4.1.11 (R10) exige exactement vitest 4.1.11 (`npm view` : `vitest: '4.1.11'`) ; seul R41 propose d'épingler vitest, sans règle pour les montées suivantes ;
    - typescript-eslint 8.70.1 (R04) limite TypeScript à `<6.1.0`, avec `typescript ~6.0.2` (`package.json:38`) ;
    - le script `build-info` n'est pas revu (`package.json:6-9`, `scripts/build-info.mjs:11-14` ; il écrit `public/build-info.json`, ignoré par `.gitignore:51`), alors que la CI de R09 lance `ng build` directement.
  - *Primitives de three.js non évaluées pour le rendu.*
    - R33b-c (fusion des pièces, de 45 à 30 puis 15 maillages par pilote) n'étudie pas `BatchedMesh`, présent dans three 0.186 (`node_modules/three/src/objects/BatchedMesh.js`). Il dessine plusieurs géométries d'un même matériau en un seul appel, avec une matrice par instance, ce qui permettrait de garder les pivots animés.
    - `InstancedMesh` n'est pas envisagé pour les pièces communes aux 8 karts.
    - R23 fusionne `smoothTowards` (`render/resources.ts:95-97`) sans citer `THREE.MathUtils.damp`, qui applique la même formule côté rendu (`node_modules/three/src/math/MathUtils.js:134-136`). Le résultat n'est pas identique au bit près, car `damp` passe par `lerp` : à signaler pour les tests.
  - *Portée du déterminisme.* La revue qualifie la simulation de « déterministe à graine » (§1, §3) et ne rouvre R07 qu'en cas de futur « rejeu ou fantôme », sans préciser que la norme ECMAScript laisse chaque moteur JavaScript approximer `Math.sin`, `cos`, `atan`, `exp` et `hypot`. La simulation s'en sert, par exemple `kart/kart-physics.ts:81-82` et `175-176`, et `items/item-system.ts:520-521`. Les empreintes de R01 ne valent donc que pour un moteur donné (Node/V8 en CI).
