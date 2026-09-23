/**
 * Races de chiens : statistiques (spec §4) et silhouette utilisée par le modèle 3D.
 * Aucune dépendance à three.js : ce fichier est aussi lu par l'interface (garage).
 * Les dimensions sont en mètres, dans le repère du kart (Y vers le haut, +Z vers l'avant).
 */
import type { BreedId, BreedInfo } from '../core/types';

/** Dressées (chihuahua), repliées (carlin), tombantes (teckel), mi-tombantes (jack russell). */
export type EarStyle = 'erect' | 'folded' | 'floppy' | 'semi-floppy';

/** Fine et relevée, en tire-bouchon, longue dans l'axe du corps, courte et dressée. */
export type TailStyle = 'thin' | 'corkscrew' | 'long' | 'short';

export interface DogLook {
  /** Couleurs CSS hexadécimales (#rrggbb). */
  furColor: string;
  /** Poitrail et coussinets. */
  bellyColor: string;
  muzzleColor: string;
  earColor: string;
  /** Intérieur des oreilles dressées. */
  innerEarColor: string;
  /** Masque sombre autour des yeux (carlin) ; null = aucun. */
  eyeMaskColor: string | null;
  /** Taches sur la tête et le dos (jack russell) ; null = aucune. */
  patchColor: string | null;

  /** Bassin : hauteur du centre au-dessus du siège et position en z par rapport au centre du siège. */
  hipLift: number;
  hipZ: number;
  hipRadius: number;
  torsoRadius: number;
  /** Distance entre le centre du bassin et celui du poitrail. */
  torsoLength: number;
  /** Inclinaison du torse au-dessus de l'horizontale (rad) : ~1,2 assis droit, ~0,25 allongé. */
  torsoPitch: number;
  /** Position du centre de la tête par rapport au poitrail. */
  neckLift: number;
  neckForward: number;

  headRadius: number;
  /** Étirement de la tête (1 = sphère) : largeur, hauteur, profondeur. */
  headScale: Readonly<{ x: number; y: number; z: number }>;
  /** Longueur de la partie cylindrique du museau (0 = museau écrasé). */
  muzzleLength: number;
  muzzleRadius: number;
  noseRadius: number;
  eyeRadius: number;
  /** Écartement des yeux : angle depuis l'axe avant (rad). */
  eyeSpread: number;
  /** Hauteur des yeux : élévation au-dessus de l'équateur de la tête (rad). */
  eyeElevation: number;
  tongue: boolean;
  /** Bourrelets sur le front (carlin). */
  wrinkles: boolean;

  earStyle: EarStyle;
  earLength: number;
  earWidth: number;

  legRadius: number;
  /** Distance cuisse → pied des pattes arrière. */
  hindLegLength: number;
  /** Angle des pattes arrière depuis la verticale (rad) : > 0 = assis, pieds sur le siège ; < 0 = pendantes vers l'arrière. */
  hindLegAngle: number;
  /** Distance poitrail → volant souhaitée (le volant est ajusté à la taille du pilote). */
  armReach: number;
  /** Dossier du siège (retiré quand le corps dépasse vers l'arrière). */
  seatBack: boolean;

  tailStyle: TailStyle;
  tailLength: number;
}

export interface BreedDefinition extends BreedInfo {
  look: DogLook;
}

const CHIHUAHUA: BreedDefinition = {
  id: 'chihuahua',
  name: 'Chihuahua',
  description: 'Minuscule, nerveux et très maniable.',
  stats: { speed: 3, acceleration: 5, weight: 1, handling: 5 },
  look: {
    furColor: '#dba468',
    bellyColor: '#f6ddb8',
    muzzleColor: '#f1cf9f',
    earColor: '#dba468',
    innerEarColor: '#f5a9ad',
    eyeMaskColor: null,
    patchColor: null,
    hipLift: 0.16,
    hipZ: 0.02,
    hipRadius: 0.18,
    torsoRadius: 0.15,
    torsoLength: 0.28,
    torsoPitch: 1.2,
    neckLift: 0.3,
    neckForward: 0.07,
    headRadius: 0.25,
    headScale: { x: 1.06, y: 1, z: 0.95 },
    muzzleLength: 0.03,
    muzzleRadius: 0.075,
    noseRadius: 0.035,
    eyeRadius: 0.078,
    eyeSpread: 0.5,
    eyeElevation: 0.14,
    tongue: true,
    wrinkles: false,
    earStyle: 'erect',
    earLength: 0.34,
    earWidth: 0.15,
    legRadius: 0.042,
    hindLegLength: 0.17,
    hindLegAngle: 1.25,
    armReach: 0.36,
    seatBack: true,
    tailStyle: 'thin',
    tailLength: 0.3,
  },
};

const CARLIN: BreedDefinition = {
  id: 'carlin',
  name: 'Carlin',
  description: 'Trapu et costaud : il bouscule tout le monde mais démarre lentement.',
  stats: { speed: 4, acceleration: 2, weight: 5, handling: 3 },
  look: {
    furColor: '#e2c596',
    bellyColor: '#eed8b0',
    muzzleColor: '#2b2320',
    earColor: '#2b2320',
    innerEarColor: '#2b2320',
    eyeMaskColor: '#3a2f2a',
    patchColor: null,
    hipLift: 0.22,
    hipZ: 0,
    hipRadius: 0.27,
    torsoRadius: 0.24,
    torsoLength: 0.28,
    torsoPitch: 1.05,
    neckLift: 0.36,
    neckForward: 0.06,
    headRadius: 0.27,
    headScale: { x: 1.1, y: 0.98, z: 0.9 },
    muzzleLength: 0,
    muzzleRadius: 0.13,
    noseRadius: 0.04,
    eyeRadius: 0.072,
    eyeSpread: 0.58,
    eyeElevation: 0.12,
    tongue: true,
    wrinkles: true,
    earStyle: 'folded',
    earLength: 0.13,
    earWidth: 0.12,
    legRadius: 0.065,
    hindLegLength: 0.2,
    hindLegAngle: 1.3,
    armReach: 0.36,
    seatBack: true,
    tailStyle: 'corkscrew',
    tailLength: 0.14,
  },
};

const TECKEL: BreedDefinition = {
  id: 'teckel',
  name: 'Teckel',
  description: 'Long comme un train : le plus rapide en ligne droite, moins agile en virage.',
  stats: { speed: 5, acceleration: 3, weight: 4, handling: 2 },
  look: {
    furColor: '#a4532b',
    bellyColor: '#c77a45',
    muzzleColor: '#8f4524',
    earColor: '#6f3219',
    innerEarColor: '#6f3219',
    eyeMaskColor: null,
    patchColor: null,
    hipLift: 0.2,
    hipZ: -0.45,
    hipRadius: 0.19,
    torsoRadius: 0.17,
    torsoLength: 0.86,
    torsoPitch: 0.36,
    neckLift: 0.38,
    neckForward: 0.18,
    headRadius: 0.2,
    headScale: { x: 0.95, y: 0.95, z: 1.15 },
    muzzleLength: 0.22,
    muzzleRadius: 0.075,
    noseRadius: 0.038,
    eyeRadius: 0.05,
    eyeSpread: 0.52,
    eyeElevation: 0.2,
    tongue: false,
    wrinkles: false,
    earStyle: 'floppy',
    earLength: 0.3,
    earWidth: 0.13,
    legRadius: 0.05,
    hindLegLength: 0.14,
    hindLegAngle: -0.45,
    armReach: 0.3,
    seatBack: false,
    tailStyle: 'long',
    tailLength: 0.42,
  },
};

const JACK_RUSSELL: BreedDefinition = {
  id: 'jack-russell',
  name: 'Jack Russell',
  description: 'Vif et polyvalent : un pilote équilibré, à l’aise partout.',
  stats: { speed: 4, acceleration: 4, weight: 3, handling: 3 },
  look: {
    furColor: '#f8f4ea',
    bellyColor: '#f8f4ea',
    muzzleColor: '#f8f4ea',
    earColor: '#8a5428',
    innerEarColor: '#8a5428',
    eyeMaskColor: null,
    patchColor: '#8a5428',
    hipLift: 0.19,
    hipZ: 0,
    hipRadius: 0.21,
    torsoRadius: 0.185,
    torsoLength: 0.36,
    torsoPitch: 1.08,
    neckLift: 0.36,
    neckForward: 0.08,
    headRadius: 0.23,
    headScale: { x: 1, y: 0.97, z: 1.02 },
    muzzleLength: 0.1,
    muzzleRadius: 0.08,
    noseRadius: 0.038,
    eyeRadius: 0.058,
    eyeSpread: 0.5,
    eyeElevation: 0.16,
    tongue: true,
    wrinkles: false,
    earStyle: 'semi-floppy',
    earLength: 0.17,
    earWidth: 0.12,
    legRadius: 0.052,
    hindLegLength: 0.2,
    hindLegAngle: 1.25,
    armReach: 0.34,
    seatBack: true,
    tailStyle: 'short',
    tailLength: 0.2,
  },
};

export const BREEDS: Readonly<Record<BreedId, BreedDefinition>> = {
  chihuahua: CHIHUAHUA,
  carlin: CARLIN,
  teckel: TECKEL,
  'jack-russell': JACK_RUSSELL,
};

/** Ordre d'affichage au garage. */
export const BREED_LIST: readonly BreedDefinition[] = [CHIHUAHUA, CARLIN, TECKEL, JACK_RUSSELL];
