/**
 * Recettes des bruitages ponctuels. Chaque fonction planifie ses sources sur une voix
 * déjà créée (le moteur audio gère le plafond de voix et le filtrage des événements).
 */
import { clamp } from '../core/vec2';
import type { DriftTier } from '../core/types';
import type { Voice } from './synth';

/** Fréquences des notes utilisées (Hz). */
const NOTE = {
  A4: 440,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  A5: 880,
  C6: 1046.5,
  E6: 1318.5,
  G6: 1568,
  C7: 2093,
} as const;

/** Hauteur du « ting » de dérapage selon le palier (index = palier). */
const DRIFT_TING = [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7] as const;

/** Force du souffle de boost selon le palier de dérapage (index = palier). */
const DRIFT_BOOST_STRENGTH = [0.6, 0.7, 0.85, 1] as const;

export function countdownBeep(voice: Voice): void {
  voice.tone({ type: 'square', freq: NOTE.A4, duration: 0.14, peak: 0.2, filter: { type: 'lowpass', freq: 2500 } });
}

export function goBeep(voice: Voice): void {
  voice.tone({ type: 'square', freq: NOTE.A5, duration: 0.55, peak: 0.22, attack: 0.01, filter: { type: 'lowpass', freq: 3500 } });
  voice.tone({ type: 'sine', freq: NOTE.A5 * 2, duration: 0.4, peak: 0.05 });
}

/** Petit « ting » cristallin, plus aigu à chaque palier. */
export function driftTing(voice: Voice, tier: DriftTier): void {
  const freq = DRIFT_TING[tier];
  voice.tone({ type: 'sine', freq, duration: 0.3, peak: 0.16, attack: 0.003 });
  voice.tone({ type: 'sine', freq: freq * 2.76, duration: 0.14, peak: 0.04, attack: 0.003 });
}

/** Souffle qui monte + oscillateur qui glisse vers l'aigu. */
export function boostRush(voice: Voice, source: 'drift' | 'item', tier: DriftTier): void {
  const strength = source === 'item' ? 1 : DRIFT_BOOST_STRENGTH[tier];
  voice.noise({
    duration: 0.5,
    peak: 0.2 * strength,
    attack: 0.08,
    filter: { type: 'bandpass', freq: 500, freqEnd: 3500, q: 1.2 },
  });
  voice.tone({
    type: 'sawtooth',
    freq: 180,
    freqEnd: 900,
    duration: 0.4,
    peak: 0.07 * strength,
    attack: 0.03,
    filter: { type: 'lowpass', freq: 2200 },
  });
}

/** Arpège montant rapide au ramassage d'une boîte. */
export function itemBoxArpeggio(voice: Voice): void {
  const notes = [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7];
  for (let i = 0; i < notes.length; i++) {
    voice.tone({ type: 'triangle', freq: notes[i], delay: i * 0.055, duration: 0.12, peak: 0.14, attack: 0.003 });
  }
}

/** « Pop » : fin de la roulette, l'objet est prêt. */
export function itemPop(voice: Voice): void {
  voice.tone({ type: 'sine', freq: 350, freqEnd: 1000, duration: 0.09, peak: 0.25, attack: 0.002 });
  voice.noise({ duration: 0.03, peak: 0.05, attack: 0.001, filter: { type: 'highpass', freq: 3000 } });
}

/** « Whoosh » : objet lancé ou utilisé. */
export function itemWhoosh(voice: Voice): void {
  voice.noise({ duration: 0.32, peak: 0.22, attack: 0.06, filter: { type: 'bandpass', freq: 3000, freqEnd: 500, q: 1.8 } });
}

/** Le joueur est touché : glissando descendant + jappement plaintif. */
export function hurtYelp(voice: Voice): void {
  voice.tone({
    type: 'square',
    freq: 900,
    freqEnd: 140,
    duration: 0.65,
    peak: 0.1,
    attack: 0.01,
    filter: { type: 'lowpass', freq: 1800 },
  });
  bark(voice, 0.08, 1150, 650, 0.3, 0.4);
}

/** Le joueur a touché quelqu'un : deux jappements joyeux. */
export function happyBarks(voice: Voice, delay = 0): void {
  bark(voice, delay, 600, 350, 0.11, 0.45);
  bark(voice, delay + 0.15, 650, 380, 0.1, 0.4);
}

/** Intensité d'un choc ramenée dans [0, 1] (une valeur non finie compte pour 0). */
export function impactLevel(intensity: number): number {
  return Number.isFinite(intensity) ? clamp(intensity, 0, 1) : 0;
}

/** Choc sourd contre une haie ; volume proportionnel à l'intensité (attendue dans [0, 1]). */
export function wallThud(voice: Voice, intensity: number): void {
  const k = impactLevel(intensity);
  voice.noise({ duration: 0.2, peak: 0.6 * k, attack: 0.002, filter: { type: 'lowpass', freq: 220, freqEnd: 90, q: 0.8 } });
  voice.tone({ type: 'sine', freq: 110, freqEnd: 45, duration: 0.18, peak: 0.4 * k, attack: 0.002 });
}

/** Choc plus léger entre deux karts ; volume proportionnel à l'intensité. */
export function bumpThud(voice: Voice, intensity: number): void {
  const k = impactLevel(intensity);
  voice.noise({ duration: 0.1, peak: 0.3 * k, attack: 0.002, filter: { type: 'lowpass', freq: 500, freqEnd: 200 } });
  voice.tone({ type: 'sine', freq: 180, freqEnd: 90, duration: 0.08, peak: 0.15 * k, attack: 0.002 });
}

/** Carillon deux notes : nouveau tour. */
export function lapChime(voice: Voice): void {
  bell(voice, NOTE.G5, 0, 0.45, 0.18);
  bell(voice, NOTE.C6, 0.16, 0.7, 0.18);
}

/** Trois notes montantes : dernier tour. */
export function finalLapFanfare(voice: Voice): void {
  const notes = [NOTE.G5, NOTE.C6, NOTE.E6];
  for (let i = 0; i < notes.length; i++) {
    const last = i === notes.length - 1;
    voice.tone({
      type: 'square',
      freq: notes[i],
      delay: i * 0.14,
      duration: last ? 0.5 : 0.16,
      peak: 0.12,
      attack: 0.006,
      filter: { type: 'lowpass', freq: 2600 },
    });
  }
}

/** Petite fanfare (arpège majeur) suivie d'un aboiement : arrivée du joueur. */
export function finishFanfare(voice: Voice): void {
  const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
  for (let i = 0; i < notes.length; i++) {
    const last = i === notes.length - 1;
    const delay = i * 0.12;
    const duration = last ? 0.8 : 0.16;
    voice.tone({ type: 'square', freq: notes[i], delay, duration, peak: 0.1, attack: 0.008, filter: { type: 'lowpass', freq: 3000 } });
    voice.tone({ type: 'triangle', freq: notes[i] * 2, delay, duration, peak: 0.06, attack: 0.008 });
  }
  happyBarks(voice, 1.0);
}

/**
 * Jappement synthétique : oscillateur en glissando descendant passé dans un formant,
 * plus une bouffée de bruit passe-bande pour l'attaque. Enveloppe très courte.
 */
function bark(voice: Voice, delay: number, from: number, to: number, duration: number, peak: number): void {
  voice.tone({
    type: 'sawtooth',
    freq: from,
    freqEnd: to,
    delay,
    duration,
    peak,
    attack: 0.004,
    filter: { type: 'bandpass', freq: 1100, q: 1.2 },
  });
  voice.noise({
    delay,
    duration: duration * 0.6,
    peak: peak * 0.4,
    attack: 0.002,
    filter: { type: 'bandpass', freq: 1500, freqEnd: 900, q: 4 },
  });
}

/** Cloche simple : fondamentale + partiel à l'octave. */
function bell(voice: Voice, freq: number, delay: number, duration: number, peak: number): void {
  voice.tone({ type: 'sine', freq, delay, duration, peak, attack: 0.004 });
  voice.tone({ type: 'sine', freq: freq * 2, delay, duration: duration * 0.5, peak: peak * 0.3, attack: 0.004 });
}
