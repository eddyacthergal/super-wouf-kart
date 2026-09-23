/**
 * Briques de synthèse Web Audio : bruit blanc, paramètres lissés et « voix » ponctuelles
 * (oscillateurs ou bruit, filtrés, avec une enveloppe attaque/déclin).
 */
import type { Rng } from '../core/rng';

/** Niveau « silencieux » : les rampes exponentielles n'acceptent pas 0. */
export const SILENT = 0.0001;

/** Durée du tampon de bruit blanc partagé (s). */
export const NOISE_SECONDS = 1;

/** Nombre maximal de sons ponctuels simultanés ; au-delà, le plus ancien est coupé. */
export const MAX_VOICES = 12;

/** Attaque par défaut d'une enveloppe (s). */
const DEFAULT_ATTACK = 0.005;
/** Marge entre la fin d'une enveloppe et l'arrêt de la source (s). */
const STOP_MARGIN = 0.02;
/** Fondu de sortie d'une voix coupée pour faire de la place (s). */
const RELEASE_TIME = 0.03;

/** Tampon mono de bruit blanc, déterministe pour une graine donnée. */
export function createNoiseBuffer(ctx: BaseAudioContext, rng: Rng): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * NOISE_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = rng.range(-1, 1);
  return buffer;
}

/**
 * Paramètre audio modulé à chaque image : n'ajoute une automatisation que si la cible
 * change vraiment, pour ne pas empiler 60 événements par seconde.
 */
export class SmoothedParam {
  private target = Number.NaN;

  constructor(
    private readonly param: AudioParam,
    private readonly timeConstant: number,
    private readonly epsilon: number,
  ) {}

  set(target: number, now: number): void {
    if (Math.abs(target - this.target) < this.epsilon) return;
    this.target = target;
    this.param.setTargetAtTime(target, now, this.timeConstant);
  }
}

export interface FilterOptions {
  type: BiquadFilterType;
  /** Fréquence de coupure ou centrale au début du son (Hz). */
  freq: number;
  /** Fréquence atteinte à la fin du son (rampe exponentielle). */
  freqEnd?: number;
  q?: number;
}

export interface EnvelopeOptions {
  /** Décalage du début par rapport au départ de la voix (s). */
  delay?: number;
  /** Durée totale attaque + déclin (s). */
  duration: number;
  /** Gain au sommet de l'enveloppe. */
  peak: number;
  /** Durée de l'attaque (s) ; le déclin occupe le reste. */
  attack?: number;
}

export interface ToneOptions extends EnvelopeOptions {
  type: OscillatorType;
  freq: number;
  /** Fréquence atteinte à la fin du son (glissando exponentiel). */
  freqEnd?: number;
  filter?: FilterOptions;
}

export interface NoiseOptions extends EnvelopeOptions {
  filter: FilterOptions;
}

/**
 * Un son ponctuel : plusieurs sources planifiées à partir de `startTime`, mixées dans une
 * sortie commune (qui permet de couper la voix proprement si le plafond est atteint).
 */
export class Voice {
  /** Instant (temps du contexte) où toutes les sources de la voix sont arrêtées. */
  endTime: number;
  private readonly output: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    private readonly noiseBuffer: AudioBuffer,
    private readonly rng: Rng,
    readonly startTime: number,
  ) {
    this.output = ctx.createGain();
    this.output.connect(destination);
    this.nodes.push(this.output);
    this.endTime = startTime;
  }

  /** Oscillateur avec glissando optionnel. */
  tone(options: ToneOptions): void {
    const start = this.startTime + (options.delay ?? 0);
    const end = start + options.duration;
    const osc = this.ctx.createOscillator();
    osc.type = options.type;
    rampParam(osc.frequency, options.freq, options.freqEnd, start, end);
    this.route(osc, options, start, end);
    osc.start(start);
    this.schedule(osc, end);
  }

  /** Bruit blanc filtré (départ aléatoire dans le tampon pour varier le grain). */
  noise(options: NoiseOptions): void {
    const start = this.startTime + (options.delay ?? 0);
    const end = start + options.duration;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    this.route(source, options, start, end);
    source.start(start, this.rng.range(0, NOISE_SECONDS));
    this.schedule(source, end);
  }

  /** Coupe la voix avec un fondu très court (vol de voix). */
  release(now: number): void {
    const stopAt = now + RELEASE_TIME;
    this.output.gain.setTargetAtTime(0, now, RELEASE_TIME / 4);
    for (const source of this.sources) {
      try {
        source.stop(stopAt);
      } catch {
        // Source déjà terminée.
      }
    }
    this.endTime = stopAt + STOP_MARGIN;
  }

  /** Arrête immédiatement les sources et déconnecte tous les nœuds. */
  dispose(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Source déjà terminée.
      }
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = 0;
    this.nodes.length = 0;
  }

  /** source → [filtre] → enveloppe → sortie de la voix. */
  private route(source: AudioNode, options: EnvelopeOptions & { filter?: FilterOptions }, start: number, end: number): void {
    let last = source;
    if (options.filter) {
      const filter = createFilter(this.ctx, options.filter);
      rampParam(filter.frequency, options.filter.freq, options.filter.freqEnd, start, end);
      last.connect(filter);
      this.nodes.push(filter);
      last = filter;
    }
    const envelope = this.ctx.createGain();
    const peak = Math.max(options.peak, SILENT);
    const attack = Math.min(options.attack ?? DEFAULT_ATTACK, options.duration / 2);
    envelope.gain.setValueAtTime(SILENT, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(SILENT, end);
    last.connect(envelope);
    envelope.connect(this.output);
    this.nodes.push(source, envelope);
  }

  private schedule(source: AudioScheduledSourceNode, end: number): void {
    source.stop(end + STOP_MARGIN);
    this.sources.push(source);
    this.endTime = Math.max(this.endTime, end + STOP_MARGIN);
  }
}

export function createFilter(ctx: BaseAudioContext, options: FilterOptions): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = options.type;
  filter.frequency.value = options.freq;
  if (options.q !== undefined) filter.Q.value = options.q;
  return filter;
}

/** Valeur fixe, ou rampe exponentielle de `from` vers `to` entre `start` et `end`. */
function rampParam(param: AudioParam, from: number, to: number | undefined, start: number, end: number): void {
  param.setValueAtTime(from, start);
  if (to !== undefined && to !== from) param.exponentialRampToValueAtTime(to, end);
}
