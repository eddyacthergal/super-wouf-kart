/**
 * Sons continus du kart du joueur : moteur, crissement de dérapage, roulement hors piste.
 * Les nœuds sont créés une seule fois ; seuls leurs paramètres évoluent à chaque image.
 */
import { clamp } from '../core/vec2';
import type { PlayerAudioState } from './audio-engine';
import { createFilter, NOISE_SECONDS, SmoothedParam } from './synth';

const ENGINE = {
  /** Fréquence au ralenti (Hz). */
  baseFreq: 70,
  /** Fréquence ajoutée à pleine vitesse (Hz). */
  freqRange: 160,
  /** Multiplicateur de fréquence pendant un boost. */
  boostPitch: 1.15,
  /** Désaccord de l'oscillateur carré (cents). */
  detune: 12,
  /** Volume relatif de l'oscillateur carré. */
  squareMix: 0.5,
  vibratoRate: 7,
  /** Amplitude du vibrato (Hz). */
  vibratoDepth: 2.5,
  cutoffBase: 350,
  cutoffRange: 1400,
  cutoffBoost: 600,
  idleGain: 0.07,
  speedGain: 0.07,
} as const;

const DRIFT_SOUND = {
  baseFreq: 1600,
  /** Fréquence ajoutée par palier de mini-turbo (Hz). */
  freqPerTier: 450,
  q: 3,
  baseGain: 0.05,
  gainPerTier: 0.015,
} as const;

const OFFROAD_SOUND = {
  /** Vitesse normalisée en dessous de laquelle on n'entend pas le gravier. */
  minSpeed01: 0.1,
  cutoffBase: 350,
  cutoffRange: 450,
  baseGain: 0.06,
  speedGain: 0.14,
  /** Modulation d'amplitude qui donne le grain « gravier ». */
  crunchRate: 13,
  crunchDepth: 0.3,
} as const;

/** Constantes de temps des transitions (s). */
const PITCH_SMOOTHING = 0.06;
const GAIN_SMOOTHING = 0.04;

export class ContinuousSounds {
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly engineFreqs: SmoothedParam[];
  private readonly engineCutoff: SmoothedParam;
  private readonly engineGain: SmoothedParam;
  private readonly driftFreq: SmoothedParam;
  private readonly driftGain: SmoothedParam;
  private readonly offroadCutoff: SmoothedParam;
  private readonly offroadGain: SmoothedParam;

  constructor(ctx: BaseAudioContext, destination: AudioNode, noise: AudioBuffer) {
    try {
      const now = ctx.currentTime;

      // Moteur : dent de scie + carré désaccordé → passe-bas, vibrato léger sur les deux.
      const saw = this.oscillator(ctx, 'sawtooth', ENGINE.baseFreq, now);
      const square = this.oscillator(ctx, 'square', ENGINE.baseFreq, now);
      square.detune.value = ENGINE.detune;
      const squareMix = this.gain(ctx, ENGINE.squareMix);
      const engineFilter = this.node(createFilter(ctx, { type: 'lowpass', freq: ENGINE.cutoffBase, q: 2 }));
      const engineGain = this.gain(ctx, 0);
      saw.connect(engineFilter);
      square.connect(squareMix);
      squareMix.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(destination);

      const vibrato = this.oscillator(ctx, 'sine', ENGINE.vibratoRate, now);
      const vibratoDepth = this.gain(ctx, ENGINE.vibratoDepth);
      vibrato.connect(vibratoDepth);
      vibratoDepth.connect(saw.frequency);
      vibratoDepth.connect(square.frequency);

      // Dérapage : bruit blanc en boucle → passe-bande.
      const driftNoise = this.noiseLoop(ctx, noise, now, 0);
      const driftFilter = this.node(createFilter(ctx, { type: 'bandpass', freq: DRIFT_SOUND.baseFreq, q: DRIFT_SOUND.q }));
      const driftGain = this.gain(ctx, 0);
      driftNoise.connect(driftFilter);
      driftFilter.connect(driftGain);
      driftGain.connect(destination);

      // Hors piste : bruit grave, grain modulé en amplitude. La boucle part à mi-tampon
      // pour ne pas être corrélée à celle du dérapage.
      const offroadNoise = this.noiseLoop(ctx, noise, now, NOISE_SECONDS / 2);
      const offroadFilter = this.node(createFilter(ctx, { type: 'lowpass', freq: OFFROAD_SOUND.cutoffBase, q: 0.7 }));
      const crunch = this.gain(ctx, 1 - OFFROAD_SOUND.crunchDepth);
      const offroadGain = this.gain(ctx, 0);
      offroadNoise.connect(offroadFilter);
      offroadFilter.connect(crunch);
      crunch.connect(offroadGain);
      offroadGain.connect(destination);

      const crunchLfo = this.oscillator(ctx, 'square', OFFROAD_SOUND.crunchRate, now);
      const crunchDepth = this.gain(ctx, OFFROAD_SOUND.crunchDepth);
      crunchLfo.connect(crunchDepth);
      crunchDepth.connect(crunch.gain);

      this.engineFreqs = [
        new SmoothedParam(saw.frequency, PITCH_SMOOTHING, 0.5),
        new SmoothedParam(square.frequency, PITCH_SMOOTHING, 0.5),
      ];
      this.engineCutoff = new SmoothedParam(engineFilter.frequency, PITCH_SMOOTHING, 5);
      this.engineGain = new SmoothedParam(engineGain.gain, GAIN_SMOOTHING, 0.002);
      this.driftFreq = new SmoothedParam(driftFilter.frequency, PITCH_SMOOTHING, 5);
      this.driftGain = new SmoothedParam(driftGain.gain, GAIN_SMOOTHING, 0.002);
      this.offroadCutoff = new SmoothedParam(offroadFilter.frequency, PITCH_SMOOTHING, 5);
      this.offroadGain = new SmoothedParam(offroadGain.gain, GAIN_SMOOTHING, 0.002);
    } catch (error) {
      // Construction interrompue : les sources déjà démarrées ne doivent pas rester actives.
      this.dispose();
      throw error;
    }
  }

  update(state: PlayerAudioState, now: number): void {
    const speed = Number.isFinite(state.speed01) ? clamp(state.speed01, 0, 1) : 0;
    const active = state.active;

    const pitch = (ENGINE.baseFreq + ENGINE.freqRange * speed) * (state.boosting ? ENGINE.boostPitch : 1);
    for (const freq of this.engineFreqs) freq.set(pitch, now);
    this.engineCutoff.set(ENGINE.cutoffBase + ENGINE.cutoffRange * speed + (state.boosting ? ENGINE.cutoffBoost : 0), now);
    this.engineGain.set(active ? ENGINE.idleGain + ENGINE.speedGain * speed : 0, now);

    const drifting = active && state.drifting;
    this.driftFreq.set(DRIFT_SOUND.baseFreq + DRIFT_SOUND.freqPerTier * state.driftTier, now);
    this.driftGain.set(drifting ? DRIFT_SOUND.baseGain + DRIFT_SOUND.gainPerTier * state.driftTier : 0, now);

    const rough = active && state.offroad && speed > OFFROAD_SOUND.minSpeed01;
    this.offroadCutoff.set(OFFROAD_SOUND.cutoffBase + OFFROAD_SOUND.cutoffRange * speed, now);
    this.offroadGain.set(rough ? OFFROAD_SOUND.baseGain + OFFROAD_SOUND.speedGain * speed : 0, now);
  }

  dispose(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Source déjà arrêtée.
      }
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = 0;
    this.nodes.length = 0;
  }

  private oscillator(ctx: BaseAudioContext, type: OscillatorType, freq: number, now: number): OscillatorNode {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.start(now);
    this.sources.push(osc);
    return this.node(osc);
  }

  private noiseLoop(ctx: BaseAudioContext, noise: AudioBuffer, now: number, offset: number): AudioBufferSourceNode {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.start(now, offset);
    this.sources.push(source);
    return this.node(source);
  }

  private gain(ctx: BaseAudioContext, value: number): GainNode {
    const gain = ctx.createGain();
    gain.gain.value = value;
    return this.node(gain);
  }

  private node<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}
