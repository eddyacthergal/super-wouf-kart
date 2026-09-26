# Journal des versions

Toutes les évolutions notables de Wouf Kart, de la plus récente à la plus ancienne. La version
suit le [versionnage sémantique](https://semver.org/lang/fr/) : **majeure** pour un changement
incompatible, **mineure** pour une nouvelle fonctionnalité, **correctif** pour une correction.
La version en cours est affichée en bas de la page d'accueil.

Chaque pull request ajoute sa version en haut de ce fichier (voir « Versioning » dans
[`AGENTS.md`](AGENTS.md)). Les dates sont celles de la fusion dans `main`.

## [0.4.1] – 27/09/2026

### Ajouts

- Journal des versions (ce fichier), tenu à jour à chaque pull request.

## [0.4.0] – 27/09/2026 · [MR #7](https://github.com/eddyacthergal/super-wouf-kart/pull/7)

Le dérapage refait pour qu'il se contrôle vraiment, comme dans Mario Kart.

### Ajouts

- **Assistance au dérapage**, active par défaut : en gardant Saut dans un virage sans toucher à la
  direction, le kart suit le virage tout seul, quel que soit son rayon, et reste sur la route.
  Braquer vers l'intérieur resserre, vers l'extérieur élargit, en douceur (même au clavier).
- Un choc violent contre une haie casse le dérapage, sans turbo ; un simple frottement, non.

### Modifications

- Le **sens du dérapage se choisit au saut** : on appuie sur Saut en tournant, ou on tourne pendant
  le saut. Un saut tout droit reste un simple saut, et garder la touche ne déclenche plus rien
  ensuite. Après un dérapage cassé, il faut relâcher puis rappuyer.
- Le dérapage démarre sur une courbe normale au lieu de la plus serrée.
- Plage de glisse élargie : de presque droit (contre-braquage) à l'épingle (braquage).
- L'IA utilise la même assistance.

### Corrections

- Environ 40 % des dérapages partaient dans le mauvais sens : en gardant la touche avant un virage,
  la moindre correction de trajectoire lançait le dérapage dans ce sens.
- Le kart plongeait vers l'intérieur au début de chaque dérapage et finissait souvent dans la haie.
- Mesure avec un joueur simulé sur les 4 circuits, en gardant Saut sans toucher à la direction :
  de 10 chocs par minute et 20 % du temps hors piste à 0,2 choc par minute et 1 % hors piste.

## [0.3.0] – 26/09/2026 · [MR #6](https://github.com/eddyacthergal/super-wouf-kart/pull/6)

Plusieurs circuits, dans trois univers.

### Ajouts

- **Écran « Circuits »** après « Jouer » (et depuis le garage) : une carte par circuit avec
  l'aperçu du tracé, l'univers et le nombre de tours. Le choix est mémorisé.
- **Potager** (763 m, jardin) : court et sinueux, un S au fond du jardin et l'épingle des salades.
- **Parc enneigé** (649 m, neige) : sol et haies sous la neige, sapins, bonhommes de neige,
  flocons qui tombent, ciel d'hiver.
- **Plage au couchant** (768 m, plage) : sable, mer animée (vagues, écume), palmiers qui se
  balancent, parasols, château de sable, poste de maître-nageur, cabines de plage, et des animaux
  animés : mouettes, crabes, dauphins.
- Le nom du circuit s'affiche pendant le chargement.
- Pour les développeurs : un circuit est une fiche de données (`TrackDefinition`) rangée dans un
  catalogue, vérifiée par des règles communes et par une course de 8 IA en test ; les univers sont
  des thèmes de rendu configurables. Voir [`docs/circuits.md`](docs/circuits.md).

### Corrections

- Deux tests qui échouaient déjà : pincement sur Safari, délai du test des combinaisons
  d'accessoires.

## [0.2.2] – 26/09/2026 · [MR #4](https://github.com/eddyacthergal/super-wouf-kart/pull/4)

### Ajouts

- Accueil : portrait de la race choisie au garage (couleurs, oreilles, museau, masque, tache,
  langue), dans l'en-tête et dans la carte « Ton pilote ».

## [0.2.1] – 26/09/2026 · [MR #3](https://github.com/eddyacthergal/super-wouf-kart/pull/3)

### Modifications

- Aide des commandes de l'accueil : clavier et écran tactile réunis dans un seul tableau, textes
  raccourcis (« Auto », « Joystick gauche », « Saut (maintenir) »…).

## [0.2.0] – 25/09/2026 · [MR #2](https://github.com/eddyacthergal/super-wouf-kart/pull/2)

Le jeu devient jouable sur téléphone et tablette.

### Ajouts

- **Commandes tactiles** : joystick flottant sous le pouce gauche, boutons Saut (maintenir pour
  déraper), Objet et Frein à droite, accélération automatique.
- Affichage adapté au mobile : mini-carte, jauge de dérapage et compteur replacés, caméra élargie
  en portrait avec un conseil pour passer à l'horizontale, dialogue de pause compact.
- HUD : nom et effet de l'objet tenu sous sa case.
- Règle de versionnage : chaque pull request fait évoluer la version.

### Corrections

- Zoom involontaire (et impossible à annuler) en touchant les commandes sur Safari.
- Pas de son sur écran tactile, et aucun son sur iPhone et iPad en mode silencieux.

## [0.1.0] – 25/09/2026 · [MR #1](https://github.com/eddyacthergal/super-wouf-kart/pull/1)

### Ajouts

- Version et date de build affichées en bas de l'accueil (« build dd/MM/yyyy HH:mm:ss »).
- Dérapage bien visible : kart en travers, roues avant qui contre-braquent, étincelles et halo aux
  couleurs du palier, traces de pneus au sol, jauge « Dérapage ! » dans le HUD dès le début.

### Modifications

- Mini-turbo plus facile à charger : paliers à 0,6 / 1,2 / 2,0 s au lieu de 0,8 / 1,6 / 2,6 s ;
  dérapage plus large en contre-braquant.

### Corrections

- La compilation ne dépend plus d'un fichier généré (erreur quand il manquait).
- Erreur de compilation TS7053 dans la jauge de dérapage.

## [0.0.0] – 23/09/2026

Première version jouable.

- Circuit « Grand Jardin » (911 m), course de 3 tours à 8 pilotes contre l'ordinateur.
- 4 races de chiens avec leurs statistiques, accessoires au garage avec aperçu 3D.
- Dérapage et mini-turbo à 3 paliers, 4 objets canins (os, balle de tennis, flaque de boue,
  croquette turbo).
- Bruitages générés en temps réel, bouton pour couper le son, interface accessible (clavier,
  lecteurs d'écran, « réduire les animations »).

[0.4.1]: https://github.com/eddyacthergal/super-wouf-kart/compare/83bb3b8...main
[0.4.0]: https://github.com/eddyacthergal/super-wouf-kart/pull/7
[0.3.0]: https://github.com/eddyacthergal/super-wouf-kart/pull/6
[0.2.2]: https://github.com/eddyacthergal/super-wouf-kart/pull/4
[0.2.1]: https://github.com/eddyacthergal/super-wouf-kart/pull/3
[0.2.0]: https://github.com/eddyacthergal/super-wouf-kart/pull/2
[0.1.0]: https://github.com/eddyacthergal/super-wouf-kart/pull/1
