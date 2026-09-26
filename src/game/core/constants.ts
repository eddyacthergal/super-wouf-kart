/**
 * Réglages partagés du jeu. Unités : mètres, secondes, radians.
 * Les modules lisent ces valeurs plutôt que de dupliquer des nombres magiques,
 * ce qui permet de régler les sensations de conduite à un seul endroit.
 */

/** Pas de simulation fixe (60 Hz). */
export const FIXED_DT = 1 / 60;

export const RACE_LAPS = 3;
export const RACER_COUNT = 8;
export const COUNTDOWN_SECONDS = 3;

/** Rayon de collision d'un kart (cercle sur le plan du sol). */
export const KART_RADIUS = 1.0;

/** Demi-largeur de la route (au-delà : bas-côté, qui ralentit). */
export const ROAD_HALF_WIDTH = 7;
/** Distance entre la ligne médiane et la bordure infranchissable (haie). */
export const WALL_HALF_WIDTH = 10.5;

/** Physique arcade. Une stat de race vaut de 1 à 5 points. */
export const PHYSICS = {
  maxSpeedBase: 24,
  maxSpeedPerPoint: 1.5,
  accelerationBase: 7,
  accelerationPerPoint: 2,
  turnRateBase: 1.6,
  turnRatePerPoint: 0.2,
  massBase: 0.8,
  massPerPoint: 0.1,
  offroadFactorBase: 0.5,
  offroadFactorPerPoint: 0.03,
  /** Décélération au freinage (m/s²). */
  brakeDeceleration: 25,
  /** Vitesse maximale en marche arrière (m/s, valeur positive). */
  reverseMaxSpeed: 8,
  /** Décélération sans gaz (m/s²). */
  coastDeceleration: 4,
  /** Vitesse de convergence du volant vers la consigne (1/s). */
  steerResponse: 8,
  /** Vitesse en dessous de laquelle la capacité à tourner diminue linéairement jusqu'à 0. */
  minTurnSpeed: 6,
  /** Fraction de vitesse conservée lors d'un choc contre une haie. */
  wallSpeedRetention: 0.6,
} as const;

/** Dérapage et mini-turbo. */
export const DRIFT = {
  minSpeed: 12,
  /**
   * Durée de dérapage (s) pour atteindre les paliers 1 (bleu), 2 (orange), 3 (violet), sans braquer ;
   * un tiers plus vite en braquant dans le sens du dérapage.
   */
  tierThresholds: [0.6, 1.2, 2.0],
  /** Durée du boost (s) selon le palier atteint (index = palier). */
  boostDurations: [0, 0.6, 1.1, 1.7],
  /** Multiplicateur de vitesse max pendant un boost de dérapage. */
  boostStrength: 1.28,
  /**
   * Angle de glisse visuel du kart pendant le dérapage (rad) : le nez pointe vers l'intérieur du
   * virage, l'arrière part vers l'extérieur, comme dans Mario Kart.
   */
  visualYaw: 0.7,
  /** Variation de cet angle selon le braquage : +/- en braquant dans le sens du dérapage / en contre-braquant. */
  visualYawSteer: 0.2,
  hopDuration: 0.25,
  /**
   * Taux de virage en dérapage, en fraction du turnRate, selon le volant de dérapage (-1 = contre-
   * braquage, 0 = neutre, +1 = braquage vers l'intérieur). À pleine vitesse (stats moyennes), rayon
   * ≈ 105 m en contre-braquant (presque droit), 37 m au neutre (la plupart des virages sans rien
   * toucher), 13 m en braquant (épingles) : on dose la glisse sur toute la plage.
   */
  turnWide: 0.12,
  turnNeutral: 0.35,
  turnTight: 1.0,
  /**
   * Vitesse (1/s) à laquelle le volant de dérapage suit la consigne : un appui bref ajuste un peu,
   * un appui maintenu resserre progressivement. Au clavier, on dose ainsi comme avec un joystick.
   */
  steerResponse: 7,
  /** Un choc violent contre une haie (intensité 0 à 1) casse le dérapage, sans turbo ; les frottements, non. */
  wallCancelIntensity: 0.6,
  /**
   * Assistance au dérapage (DriverInput.driftAssist) : au neutre, le kart suit le virage quel que
   * soit son rayon (au lieu de turnNeutral fixe). Il vise un point à assistLookahead s devant (au
   * moins assistMinLookahead m), sur sa trajectoire actuelle, gardée à assistEdgeMargin m du bord
   * de la route.
   */
  assistLookahead: 0.6,
  assistMinLookahead: 12,
  assistEdgeMargin: 2,
} as const;

export const ITEMS = {
  boxPickupRadius: 1.8,
  boxRespawn: 3,
  rouletteDuration: 1.2,
  boneSpeed: 45,
  boneLife: 5,
  boneMaxBounces: 3,
  ballSpeed: 40,
  ballLife: 8,
  mudRadius: 1.6,
  mudLife: 30,
  projectileRadius: 0.6,
  spinDuration: 1.0,
  /** Fraction de vitesse conservée quand on est touché. */
  spinSpeedFactor: 0.3,
  hitImmunity: 1.5,
  turboDuration: 1.6,
  turboStrength: 1.35,
  /** Délai (s) avant qu'un objet lancé puisse toucher son propre lanceur. */
  armTime: 0.35,
} as const;
