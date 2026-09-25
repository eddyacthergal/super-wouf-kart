/**
 * Son sur iPhone et iPad. Le bouton « silencieux » de l'appareil coupe Web Audio (catégorie
 * « ambiante »), alors qu'il laisse passer vidéos et musique (catégorie « lecture »). On demande
 * donc la catégorie « lecture » : par l'API AudioSession (iOS 16.4 et plus) et, en secours,
 * en jouant en boucle un son muet dans un élément audio classique, qui fait basculer la page.
 */

interface NavigatorWithAudioSession {
  readonly userAgent: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
  audioSession?: { type: string };
}

/** iPhone, iPod ou iPad (y compris iPadOS, qui se présente comme un Mac tactile). */
export function isAppleTouchDevice(nav: NavigatorWithAudioSession | undefined): boolean {
  if (!nav) return false;
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

/** Demande la catégorie « lecture » (ignorée si l'API AudioSession est absente). */
export function requestPlaybackSession(nav: NavigatorWithAudioSession | undefined): void {
  const session = nav?.audioSession;
  if (!session) return;
  try {
    session.type = 'playback';
  } catch {
    // Valeur refusée : le son reste soumis au bouton silencieux.
  }
}

/** Élément audio minimal dont on a besoin (HTMLAudioElement en pratique). */
export interface LoopingAudio {
  src: string;
  loop: boolean;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  removeAttribute(name: string): void;
  load(): void;
  setAttribute(name: string, value: string): void;
}

/**
 * Son muet joué en boucle : tant qu'il joue, iOS classe la page en « lecture » et Web Audio
 * sonne même en mode silencieux. `play()` doit être appelé pendant un geste de l'utilisateur.
 */
export class SilentLoop {
  private element: LoopingAudio | null;

  constructor(createAudio: () => LoopingAudio) {
    const element = createAudio();
    element.src = silentWavDataUri();
    element.loop = true;
    // Pas de proposition de diffusion AirPlay pour un son muet.
    element.setAttribute('x-webkit-airplay', 'deny');
    this.element = element;
  }

  /** Lance la boucle si elle ne joue pas encore ; ne lève jamais. */
  play(): void {
    const element = this.element;
    if (!element || !element.paused) return;
    try {
      void Promise.resolve(element.play()).catch(() => undefined);
    } catch {
      // Lecture refusée : un prochain geste réessaiera.
    }
  }

  dispose(): void {
    const element = this.element;
    if (!element) return;
    this.element = null;
    try {
      element.pause();
      element.removeAttribute('src');
      element.load();
    } catch {
      // Élément déjà libéré.
    }
  }
}

/** Fichier WAV muet (0,1 s, 8 bits, 8 kHz) en data URI. */
export function silentWavDataUri(): string {
  const sampleRate = 8000;
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // Taille du bloc « fmt ».
  view.setUint16(20, 1, true); // PCM.
  view.setUint16(22, 1, true); // Mono.
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // Octets par seconde.
  view.setUint16(32, 1, true); // Octets par échantillon.
  view.setUint16(34, 8, true); // Bits par échantillon.
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // Silence en 8 bits non signés.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}
