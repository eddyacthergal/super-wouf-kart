/**
 * Bruitages procéduraux Web Audio (aucun fichier son).
 *
 * Graphe : sons continus + sons ponctuels → gain maître → compresseur léger → sortie.
 * Rien ne sonne avant `resume()` (à appeler après une interaction utilisateur).
 * Sans Web Audio, ou si le contexte ne peut pas être créé, toutes les méthodes sont des
 * no-op silencieux : jamais d'exception ni de promesse rejetée, le jeu reste jouable.
 */
import { createRng, type Rng } from '../core/rng';
import type { DriftTier, GameEvent } from '../core/types';
import { ContinuousSounds } from './continuous-sounds';
import * as sfx from './sound-effects';
import { createNoiseBuffer, MAX_VOICES, Voice } from './synth';

/** État du kart du joueur, transmis à chaque image pour moduler les sons continus. */
export interface PlayerAudioState {
  /** Vitesse normalisée 0..1 (|vitesse| / vitesse max). */
  speed01: number;
  drifting: boolean;
  driftTier: DriftTier;
  boosting: boolean;
  offroad: boolean;
  /** Faux (pause, course non visible…) : les sons continus se taisent. */
  active: boolean;
}

/** Volume général quand le son n'est pas coupé. */
const MASTER_VOLUME = 0.6;
/** Constante de temps du passage muet / audible (s). */
const MUTE_SMOOTHING = 0.05;
/** Avance de planification des sons ponctuels, pour ne pas rogner l'attaque (s). */
const SCHEDULE_LEAD = 0.01;
/** Intervalle minimal entre deux chocs d'un même type (glissade le long d'une haie, contacts répétés). */
const IMPACT_COOLDOWN = { wall: 0.2, bump: 0.15 } as const;
/** Intensité (dans [0, 1]) sous laquelle un choc serait inaudible : il est ignoré. */
const MIN_IMPACT_LEVEL = 0.05;
/** Compresseur léger : évite la saturation quand plusieurs sons se superposent. */
const COMPRESSOR = { threshold: -18, knee: 12, ratio: 4, attack: 0.005, release: 0.2 } as const;
const NOISE_SEED = 0x5eed;

type ImpactKind = keyof typeof IMPACT_COOLDOWN;

interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  compressor: DynamicsCompressorNode;
  /** Tampon de bruit blanc partagé par tous les sons. */
  noise: AudioBuffer;
}

const defaultCreateContext = (): AudioContext | null =>
  typeof AudioContext !== 'undefined' ? new AudioContext() : null;

export class AudioEngine {
  private graph: AudioGraph | null;
  private continuous: ContinuousSounds | null = null;
  /** Sons ponctuels en cours, du plus ancien au plus récent. */
  private readonly voices: Voice[] = [];
  /** Voix coupées pour respecter le plafond, en attente de déconnexion. */
  private readonly releasing: Voice[] = [];
  private readonly impactReadyAt: Record<ImpactKind, number> = { wall: 0, bump: 0 };
  private readonly rng = createRng(NOISE_SEED);
  private started = false;
  private isMuted = false;

  constructor(options: { createContext?: () => AudioContext | null } = {}) {
    this.graph = createGraph(options.createContext ?? defaultCreateContext, this.rng);
  }

  /** Vrai si Web Audio est utilisable (faux après `dispose()`). */
  get available(): boolean {
    return this.graph !== null;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Autorise le son ; à appeler après une interaction utilisateur. Ne rejette jamais. */
  async resume(): Promise<void> {
    const graph = this.graph;
    if (!graph) return;
    try {
      if (graph.ctx.state !== 'running') await graph.ctx.resume();
    } catch {
      // Reprise refusée par le navigateur : les sons restent silencieux jusqu'au prochain appel.
    }
    // Le moteur a pu être libéré pendant l'attente.
    if (this.graph !== graph) return;
    this.started = true;
    if (this.continuous) return;
    try {
      this.continuous = new ContinuousSounds(graph.ctx, graph.master, graph.noise);
    } catch {
      // Sons continus indisponibles : les bruitages ponctuels restent possibles.
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    const graph = this.graph;
    if (!graph) return;
    try {
      graph.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, graph.ctx.currentTime, MUTE_SMOOTHING);
    } catch {
      // Paramètre inutilisable (contexte fermé) : rien à faire.
    }
  }

  /** Joue les bruitages des événements du joueur `playerId` et des événements globaux. */
  handleEvents(events: readonly GameEvent[], playerId: number): void {
    const graph = this.graph;
    if (events.length === 0 || !graph || !this.canPlay(graph)) return;
    try {
      this.releaseFinishedVoices(graph.ctx.currentTime);
      // Un tour qui s'achève sur le dernier tour ou l'arrivée : seul le son le plus marquant est joué.
      let lapSuperseded = false;
      for (const event of events) {
        if ((event.type === 'final-lap' || event.type === 'finish') && event.racerId === playerId) lapSuperseded = true;
      }
      for (const event of events) this.playEvent(graph, event, playerId, lapSuperseded);
    } catch {
      // Un bruitage raté ne doit jamais interrompre la course.
    }
  }

  /** Module les sons continus (moteur, dérapage, hors-piste) ; à appeler à chaque image. */
  updatePlayer(state: PlayerAudioState): void {
    const graph = this.graph;
    if (!graph || !this.continuous) return;
    try {
      const now = graph.ctx.currentTime;
      this.continuous.update(state, now);
      this.releaseFinishedVoices(now);
    } catch {
      // Voir handleEvents.
    }
  }

  /** Arrête toutes les sources, déconnecte les nœuds et ferme le contexte. */
  dispose(): void {
    const graph = this.graph;
    if (!graph) return;
    this.graph = null;
    this.started = false;
    try {
      for (const voice of this.voices) voice.dispose();
      for (const voice of this.releasing) voice.dispose();
      this.continuous?.dispose();
      graph.master.disconnect();
      graph.compressor.disconnect();
    } catch {
      // La fermeture du contexte ci-dessous libère de toute façon les ressources.
    }
    this.voices.length = 0;
    this.releasing.length = 0;
    this.continuous = null;
    closeQuietly(graph.ctx);
  }

  private canPlay(graph: AudioGraph): boolean {
    return this.started && !this.isMuted && graph.ctx.state === 'running';
  }

  private playEvent(graph: AudioGraph, event: GameEvent, playerId: number, lapSuperseded: boolean): void {
    // Événements globaux, ou qui concernent le joueur autrement que par racerId.
    switch (event.type) {
      case 'countdown':
        sfx.countdownBeep(this.startVoice(graph));
        return;
      case 'go':
        sfx.goBeep(this.startVoice(graph));
        return;
      case 'hit':
        if (event.racerId === playerId) sfx.hurtYelp(this.startVoice(graph));
        else if (event.ownerId === playerId) sfx.happyBarks(this.startVoice(graph));
        return;
      case 'bump':
        if ((event.racerId === playerId || event.otherId === playerId) && this.impactReady(graph, 'bump', event.intensity)) {
          sfx.bumpThud(this.startVoice(graph), event.intensity);
        }
        return;
    }

    if (event.racerId !== playerId) return;
    switch (event.type) {
      case 'drift-start':
        // Le crissement continu (updatePlayer) suffit.
        return;
      case 'drift-tier':
        if (event.tier > 0) sfx.driftTing(this.startVoice(graph), event.tier);
        return;
      case 'boost':
        sfx.boostRush(this.startVoice(graph), event.source, event.tier);
        return;
      case 'wall':
        if (this.impactReady(graph, 'wall', event.intensity)) sfx.wallThud(this.startVoice(graph), event.intensity);
        return;
      case 'item-box':
        sfx.itemBoxArpeggio(this.startVoice(graph));
        return;
      case 'item-ready':
        sfx.itemPop(this.startVoice(graph));
        return;
      case 'item-use':
        sfx.itemWhoosh(this.startVoice(graph));
        return;
      case 'lap':
        if (!lapSuperseded) sfx.lapChime(this.startVoice(graph));
        return;
      case 'final-lap':
        sfx.finalLapFanfare(this.startVoice(graph));
        return;
      case 'finish':
        sfx.finishFanfare(this.startVoice(graph));
        return;
    }
  }

  /** Nouvelle voix ; au-delà du plafond, la plus ancienne est coupée avec un fondu court. */
  private startVoice(graph: AudioGraph): Voice {
    const now = graph.ctx.currentTime;
    if (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift();
      if (oldest) {
        oldest.release(now);
        this.releasing.push(oldest);
      }
    }
    const voice = new Voice(graph.ctx, graph.master, graph.noise, this.rng, now + SCHEDULE_LEAD);
    this.voices.push(voice);
    return voice;
  }

  /** Vrai si un choc assez fort peut être joué ; un frôlement inaudible ne relance pas le délai minimal. */
  private impactReady(graph: AudioGraph, kind: ImpactKind, intensity: number): boolean {
    const now = graph.ctx.currentTime;
    if (sfx.impactLevel(intensity) < MIN_IMPACT_LEVEL || now < this.impactReadyAt[kind]) return false;
    this.impactReadyAt[kind] = now + IMPACT_COOLDOWN[kind];
    return true;
  }

  private releaseFinishedVoices(now: number): void {
    disposeFinished(this.voices, now);
    disposeFinished(this.releasing, now);
  }
}

function createGraph(create: () => AudioContext | null, rng: Rng): AudioGraph | null {
  let ctx: AudioContext | null = null;
  try {
    ctx = create();
    if (!ctx) return null;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = COMPRESSOR.threshold;
    compressor.knee.value = COMPRESSOR.knee;
    compressor.ratio.value = COMPRESSOR.ratio;
    compressor.attack.value = COMPRESSOR.attack;
    compressor.release.value = COMPRESSOR.release;
    compressor.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(compressor);
    return { ctx, master, compressor, noise: createNoiseBuffer(ctx, rng) };
  } catch {
    if (ctx) closeQuietly(ctx);
    return null;
  }
}

/** Retire (sans allocation) les voix terminées et déconnecte leurs nœuds. */
function disposeFinished(voices: Voice[], now: number): void {
  let kept = 0;
  for (let i = 0; i < voices.length; i++) {
    const voice = voices[i];
    if (voice.endTime <= now) voice.dispose();
    else voices[kept++] = voice;
  }
  voices.length = kept;
}

function closeQuietly(ctx: AudioContext): void {
  try {
    void Promise.resolve(ctx.close()).catch(() => undefined);
  } catch {
    // Contexte déjà fermé.
  }
}
