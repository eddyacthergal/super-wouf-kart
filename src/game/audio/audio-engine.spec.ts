import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriftTier, GameEvent } from '../core/types';
import { AudioEngine, type PlayerAudioState } from './audio-engine';
import { MAX_VOICES } from './synth';

// ---------------------------------------------------------------------------
// Faux AudioContext minimal : enregistre les nœuds créés, les connexions et
// les automatisations. Les erreurs d'usage de l'API sont levées ET mémorisées,
// pour que le try/catch du moteur ne les masque pas.
// ---------------------------------------------------------------------------

type Connectable = FakeNode | FakeParam;

interface ParamCall {
  method: string;
  value: number;
  time: number;
}

class FakeParam {
  readonly calls: ParamCall[] = [];

  constructor(
    private readonly ctx: FakeAudioContext,
    /** Dernière valeur fixée ou visée. */
    public value: number,
  ) {}

  setValueAtTime(value: number, time: number): this {
    return this.record('setValueAtTime', value, time);
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.record('linearRampToValueAtTime', value, time);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (!(value > 0)) this.ctx.fail(`rampe exponentielle vers ${value}`);
    return this.record('exponentialRampToValueAtTime', value, time);
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    if (!(timeConstant > 0)) this.ctx.fail('constante de temps invalide');
    return this.record('setTargetAtTime', value, time);
  }

  cancelScheduledValues(time: number): this {
    this.calls.push({ method: 'cancelScheduledValues', value: Number.NaN, time });
    return this;
  }

  private record(method: string, value: number, time: number): this {
    if (!Number.isFinite(value) || !Number.isFinite(time) || time < 0) this.ctx.fail(`${method}(${value}, ${time})`);
    this.calls.push({ method, value, time });
    this.value = value;
    return this;
  }
}

class FakeNode {
  readonly connections: Connectable[] = [];
  disconnected = false;

  constructor(protected readonly ctx: FakeAudioContext) {}

  connect(target: Connectable): Connectable {
    if (target === undefined || target === null) this.ctx.fail('connect() sans cible');
    this.connections.push(target);
    return target;
  }

  disconnect(): void {
    this.connections.length = 0;
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(this.ctx, 1);
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(this.ctx, 350);
  readonly Q = new FakeParam(this.ctx, 1);
  readonly gain = new FakeParam(this.ctx, 0);
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(this.ctx, -24);
  readonly knee = new FakeParam(this.ctx, 30);
  readonly ratio = new FakeParam(this.ctx, 12);
  readonly attack = new FakeParam(this.ctx, 0.003);
  readonly release = new FakeParam(this.ctx, 0.25);
}

class FakeSource extends FakeNode {
  startTime: number | null = null;
  stopTime: number | null = null;

  start(when = 0): void {
    if (this.startTime !== null) this.ctx.fail('start() appelé deux fois');
    this.startTime = when;
  }

  stop(when?: number): void {
    if (this.startTime === null) this.ctx.fail('stop() avant start()');
    this.stopTime = when ?? this.ctx.currentTime;
  }

  playingAt(time: number): boolean {
    return this.startTime !== null && (this.stopTime === null || this.stopTime > time);
  }
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = new FakeParam(this.ctx, 440);
  readonly detune = new FakeParam(this.ctx, 0);
}

class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
}

class FakeBuffer {
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 8000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly destination = new FakeNode(this);
  readonly errors: string[] = [];
  /** Toutes les sources, dans l'ordre de création. */
  readonly sources: FakeSource[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly buffers: FakeBuffer[] = [];

  readonly resume = vi.fn(async (): Promise<void> => {
    if (this.state === 'closed') throw new Error('contexte fermé');
    this.state = 'running';
  });

  readonly close = vi.fn(async (): Promise<void> => {
    this.state = 'closed';
  });

  createOscillator(): FakeOscillator {
    const osc = track(this.oscillators, new FakeOscillator(this));
    this.sources.push(osc);
    return osc;
  }

  createBufferSource(): FakeBufferSource {
    const source = track(this.bufferSources, new FakeBufferSource(this));
    this.sources.push(source);
    return source;
  }

  createGain(): FakeGain {
    return track(this.gains, new FakeGain(this));
  }

  createBiquadFilter(): FakeFilter {
    return track(this.filters, new FakeFilter(this));
  }

  createDynamicsCompressor(): FakeCompressor {
    return track(this.compressors, new FakeCompressor(this));
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return track(this.buffers, new FakeBuffer(channels, length, sampleRate));
  }

  fail(message: string): never {
    this.errors.push(message);
    throw new Error(message);
  }
}

function track<T>(list: T[], item: T): T {
  list.push(item);
  return item;
}

// ---------------------------------------------------------------------------
// Outils de test
// ---------------------------------------------------------------------------

const contexts: FakeAudioContext[] = [];

afterEach(() => {
  for (const ctx of contexts) expect(ctx.errors).toEqual([]);
  contexts.length = 0;
});

function createEngine(): { engine: AudioEngine; ctx: FakeAudioContext } {
  const ctx = new FakeAudioContext();
  contexts.push(ctx);
  const engine = new AudioEngine({ createContext: () => ctx as unknown as AudioContext });
  return { engine, ctx };
}

async function createStartedEngine(): Promise<{ engine: AudioEngine; ctx: FakeAudioContext }> {
  const setup = createEngine();
  await setup.engine.resume();
  return setup;
}

/** Gain maître : le nœud relié au compresseur. */
function masterGain(ctx: FakeAudioContext): FakeGain {
  const master = ctx.gains.find((gain) => gain.connections.includes(ctx.compressors[0]));
  if (!master) throw new Error('gain maître introuvable');
  return master;
}

/** Dernier nœud d'une chaîne avant le gain maître (le gain de volume d'un son continu). */
function outputGainOf(ctx: FakeAudioContext, source: FakeNode): FakeGain {
  const master = masterGain(ctx);
  let node: FakeNode = source;
  for (let guard = 0; guard < 10; guard++) {
    const next = node.connections.find((target): target is FakeNode => target instanceof FakeNode);
    if (!next) break;
    if (next === master) {
      if (node instanceof FakeGain) return node;
      break;
    }
    node = next;
  }
  throw new Error('chaîne vers le gain maître introuvable');
}

function firstFilterOf(source: FakeNode): FakeFilter {
  const filter = source.connections.find((target): target is FakeFilter => target instanceof FakeFilter);
  if (!filter) throw new Error('filtre introuvable');
  return filter;
}

/** Sources continues créées par resume() : moteur (dent de scie), dérapage (passe-bande), hors-piste (passe-bas). */
function continuousSounds(ctx: FakeAudioContext) {
  const engineOsc = ctx.oscillators.find((osc) => osc.type === 'sawtooth' && osc.stopTime === null);
  const noiseLoops = ctx.bufferSources.filter((source) => source.loop && source.stopTime === null);
  const drift = noiseLoops.find((source) => firstFilterOf(source).type === 'bandpass');
  const offroad = noiseLoops.find((source) => firstFilterOf(source).type === 'lowpass');
  if (!engineOsc || !drift || !offroad) throw new Error('sons continus introuvables');
  return {
    engineOsc,
    engineGain: outputGainOf(ctx, engineOsc),
    driftFilter: firstFilterOf(drift),
    driftGain: outputGainOf(ctx, drift),
    offroadGain: outputGainOf(ctx, offroad),
  };
}

/** Sources créées par un lot d'événements. */
function sourcesPlayedBy(engine: AudioEngine, ctx: FakeAudioContext, events: readonly GameEvent[], playerId = 0): FakeSource[] {
  const before = ctx.sources.length;
  engine.handleEvents(events, playerId);
  return ctx.sources.slice(before);
}

/** Nombre de sources créées par un lot d'événements. */
function sourcesCreatedBy(engine: AudioEngine, ctx: FakeAudioContext, events: readonly GameEvent[], playerId = 0): number {
  return sourcesPlayedBy(engine, ctx, events, playerId).length;
}

function oscillatorsIn(sources: readonly FakeSource[]): FakeOscillator[] {
  return sources.filter((source): source is FakeOscillator => source instanceof FakeOscillator);
}

function noisesIn(sources: readonly FakeSource[]): FakeBufferSource[] {
  return sources.filter((source): source is FakeBufferSource => source instanceof FakeBufferSource);
}

/** Chaîne de nœuds en aval (premier nœud connecté à chaque étape). */
function downstream(node: FakeNode): FakeNode[] {
  const chain: FakeNode[] = [];
  let current = node;
  for (let guard = 0; guard < 10; guard++) {
    const next = current.connections.find((target): target is FakeNode => target instanceof FakeNode);
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

function filterAfter(node: FakeNode): FakeFilter {
  const filter = downstream(node).find((next): next is FakeFilter => next instanceof FakeFilter);
  if (!filter) throw new Error('filtre introuvable');
  return filter;
}

/** Enveloppe d'une source ponctuelle : premier gain en aval (source → [filtre] → enveloppe). */
function envelopeOf(source: FakeNode): FakeGain {
  const envelope = downstream(source).find((next): next is FakeGain => next instanceof FakeGain);
  if (!envelope) throw new Error('enveloppe introuvable');
  return envelope;
}

function envelopePeak(source: FakeNode): number {
  return Math.max(...envelopeOf(source).gain.calls.map((call) => call.value));
}

/** Valeur de départ et valeur visée en fin de rampe d'un paramètre planifié. */
function rampOf(param: FakeParam): { from: number; to: number } {
  const from = param.calls.find((call) => call.method === 'setValueAtTime')?.value ?? param.value;
  const to = param.calls.find((call) => call.method === 'exponentialRampToValueAtTime')?.value ?? from;
  return { from, to };
}

function durationOf(source: FakeSource): number {
  return (source.stopTime ?? Number.POSITIVE_INFINITY) - (source.startTime ?? 0);
}

/** Notes jouées : une par instant de départ (la plus grave, les autres sont des harmoniques), dans l'ordre. */
function notesOf(oscillators: readonly FakeOscillator[]): { time: number; freq: number }[] {
  const byTime = new Map<number, number>();
  for (const osc of oscillators) {
    const time = osc.startTime ?? 0;
    const freq = rampOf(osc.frequency).from;
    byTime.set(time, Math.min(freq, byTime.get(time) ?? Number.POSITIVE_INFINITY));
  }
  return [...byTime].map(([time, freq]) => ({ time, freq })).sort((a, b) => a.time - b.time);
}

function expectRising(values: readonly number[]): void {
  for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
}

const PLAYER = 0;
const OTHER = 3;

/** Un événement de chaque type qui concerne `racerId`. */
function racerEvents(racerId: number): GameEvent[] {
  return [
    { type: 'drift-tier', racerId, tier: 2 },
    { type: 'boost', racerId, source: 'drift', tier: 3 },
    { type: 'boost', racerId, source: 'item', tier: 0 },
    { type: 'wall', racerId, intensity: 0.7 },
    { type: 'bump', racerId, otherId: racerId === OTHER ? 5 : OTHER, intensity: 0.5 },
    { type: 'item-box', racerId },
    { type: 'item-ready', racerId, item: 'bone' },
    { type: 'item-use', racerId, item: 'tennis-ball' },
    { type: 'hit', racerId, by: 'bone', ownerId: racerId === OTHER ? 5 : OTHER },
    { type: 'lap', racerId, lap: 2 },
    { type: 'final-lap', racerId },
    { type: 'finish', racerId, rank: 1 },
  ];
}

const ALL_EVENTS: GameEvent[] = [
  { type: 'countdown', value: 3 },
  { type: 'go' },
  { type: 'drift-start', racerId: PLAYER },
  ...racerEvents(PLAYER),
];

const RUNNING: PlayerAudioState = {
  speed01: 0.5,
  drifting: false,
  driftTier: 0,
  boosting: false,
  offroad: false,
  active: true,
};

// ---------------------------------------------------------------------------

describe('AudioEngine sans Web Audio', () => {
  it('par défaut (Node, pas d’AudioContext) : indisponible', () => {
    expect(new AudioEngine().available).toBe(false);
  });

  it('une fabrique qui lève une exception rend le moteur indisponible', () => {
    const engine = new AudioEngine({
      createContext: () => {
        throw new Error('refusé');
      },
    });
    expect(engine.available).toBe(false);
  });

  it('toutes les méthodes sont des no-op silencieux', async () => {
    const engine = new AudioEngine({ createContext: () => null });
    expect(engine.available).toBe(false);
    await expect(engine.resume()).resolves.toBeUndefined();
    expect(() => {
      engine.setMuted(true);
      engine.handleEvents(ALL_EVENTS, PLAYER);
      engine.updatePlayer(RUNNING);
      engine.dispose();
      engine.dispose();
    }).not.toThrow();
    expect(engine.muted).toBe(true);
  });
});

describe('AudioEngine avec un contexte', () => {
  it('construit le graphe maître → compresseur → sortie, audible par défaut', () => {
    const { engine, ctx } = createEngine();
    expect(engine.available).toBe(true);
    expect(engine.muted).toBe(false);
    const compressor = ctx.compressors[0];
    expect(compressor.connections).toContain(ctx.destination);
    expect(masterGain(ctx).gain.value).toBeCloseTo(0.6);
  });

  it('aucun son avant resume()', () => {
    const { engine, ctx } = createEngine();
    engine.handleEvents(ALL_EVENTS, PLAYER);
    engine.updatePlayer(RUNNING);
    expect(ctx.sources).toHaveLength(0);
  });

  it('aucun son avant resume(), même si le navigateur a déjà démarré le contexte', async () => {
    const { engine, ctx } = createEngine();
    ctx.state = 'running';
    engine.handleEvents(ALL_EVENTS, PLAYER);
    engine.updatePlayer(RUNNING);
    expect(ctx.sources).toHaveLength(0);

    await engine.resume();
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(sourcesCreatedBy(engine, ctx, [{ type: 'go' }])).toBeGreaterThan(0);
  });

  it('resume() démarre le contexte et les sons continus une seule fois', async () => {
    const { engine, ctx } = createEngine();
    await engine.resume();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    const count = ctx.sources.length;
    expect(count).toBeGreaterThan(0);
    expect(ctx.sources.every((source) => source.startTime !== null && source.stopTime === null)).toBe(true);
    await engine.resume();
    expect(ctx.sources).toHaveLength(count);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('resume() ne rejette jamais, même si le navigateur refuse', async () => {
    const { engine, ctx } = createEngine();
    ctx.resume.mockRejectedValueOnce(new Error('NotAllowedError'));
    await expect(engine.resume()).resolves.toBeUndefined();
    // Contexte toujours suspendu : aucun son ponctuel planifié.
    expect(sourcesCreatedBy(engine, ctx, [{ type: 'go' }])).toBe(0);
  });

  it('les événements du joueur et les événements globaux créent des sources', async () => {
    for (const event of ALL_EVENTS) {
      if (event.type === 'drift-start') continue;
      const { engine, ctx } = await createStartedEngine();
      expect(sourcesCreatedBy(engine, ctx, [event]), event.type).toBeGreaterThan(0);
    }
  });

  it('les événements des autres pilotes ne créent aucune source', async () => {
    const { engine, ctx } = await createStartedEngine();
    expect(sourcesCreatedBy(engine, ctx, racerEvents(OTHER))).toBe(0);
  });

  it('un choc subi par le joueur (otherId) est entendu', async () => {
    const { engine, ctx } = await createStartedEngine();
    const bump: GameEvent = { type: 'bump', racerId: OTHER, otherId: PLAYER, intensity: 1 };
    expect(sourcesCreatedBy(engine, ctx, [bump])).toBeGreaterThan(0);
  });

  it('le joueur touché : glissando descendant et jappement plaintif', async () => {
    const { engine, ctx } = await createStartedEngine();
    const played = sourcesPlayedBy(engine, ctx, [{ type: 'hit', racerId: PLAYER, by: 'bone', ownerId: OTHER }]);
    const oscillators = oscillatorsIn(played);
    // Glissando : plus d'une octave vers le grave.
    const glissando = oscillators.filter((osc) => rampOf(osc.frequency).to < rampOf(osc.frequency).from / 2);
    expect(glissando.length).toBeGreaterThan(0);
    // Jappement : un second son, lui aussi descendant, avec un formant de bruit.
    expect(oscillators.length).toBeGreaterThan(glissando.length);
    expect(noisesIn(played).length).toBeGreaterThan(0);
  });

  it('toucher un adversaire : deux jappements joyeux (≈ 600 → 350 Hz) avec un formant de bruit', async () => {
    const { engine, ctx } = await createStartedEngine();
    const played = sourcesPlayedBy(engine, ctx, [{ type: 'hit', racerId: OTHER, by: 'tennis-ball', ownerId: PLAYER }]);
    const barks = oscillatorsIn(played);
    expect(barks).toHaveLength(2);
    for (const bark of barks) {
      const { from, to } = rampOf(bark.frequency);
      expect(from).toBeGreaterThanOrEqual(550);
      expect(from).toBeLessThanOrEqual(700);
      expect(to).toBeGreaterThanOrEqual(300);
      expect(to).toBeLessThanOrEqual(420);
      expect(durationOf(bark)).toBeLessThan(0.2);
    }
    expect(barks[1].startTime).toBeGreaterThan(barks[0].startTime ?? 0);
    const formants = noisesIn(played);
    expect(formants.length).toBeGreaterThan(0);
    expect(formants.every((noise) => filterAfter(noise).type === 'bandpass')).toBe(true);
  });

  it('un joueur touché par son propre objet entend le son « touché », pas les jappements joyeux', async () => {
    const { engine, ctx } = await createStartedEngine();
    const hurt = sourcesCreatedBy(engine, ctx, [{ type: 'hit', racerId: PLAYER, by: 'mud', ownerId: OTHER }]);
    expect(sourcesCreatedBy(engine, ctx, [{ type: 'hit', racerId: PLAYER, by: 'mud', ownerId: PLAYER }])).toBe(hurt);
  });

  it('le dernier tour remplace le carillon de tour du même lot', async () => {
    const { engine, ctx } = await createStartedEngine();
    const finalLap = sourcesCreatedBy(engine, ctx, [{ type: 'final-lap', racerId: PLAYER }]);
    const both = sourcesCreatedBy(engine, ctx, [
      { type: 'lap', racerId: PLAYER, lap: 3 },
      { type: 'final-lap', racerId: PLAYER },
    ]);
    expect(both).toBe(finalLap);
  });

  it('l’arrivée remplace aussi le carillon de tour ; le dernier tour d’un autre pilote, non', async () => {
    const { engine, ctx } = await createStartedEngine();
    const finish = sourcesCreatedBy(engine, ctx, [{ type: 'finish', racerId: PLAYER, rank: 2 }]);
    const lapAndFinish = sourcesCreatedBy(engine, ctx, [
      { type: 'lap', racerId: PLAYER, lap: 3 },
      { type: 'finish', racerId: PLAYER, rank: 2 },
    ]);
    expect(lapAndFinish).toBe(finish);

    const lap = sourcesCreatedBy(engine, ctx, [{ type: 'lap', racerId: PLAYER, lap: 2 }]);
    const withOtherFinalLap = sourcesCreatedBy(engine, ctx, [
      { type: 'lap', racerId: PLAYER, lap: 2 },
      { type: 'final-lap', racerId: OTHER },
    ]);
    expect(withOtherFinalLap).toBe(lap);
  });

  it('choc contre une haie : volume proportionnel à l’intensité ; un frôlement inaudible est ignoré', async () => {
    const { engine, ctx } = await createStartedEngine();
    const peaksFor = (intensity: number): number[] => {
      ctx.currentTime += 1;
      return sourcesPlayedBy(engine, ctx, [{ type: 'wall', racerId: PLAYER, intensity }]).map(envelopePeak);
    };
    const strong = peaksFor(1);
    const weak = peaksFor(0.25);
    expect(strong.length).toBeGreaterThan(0);
    expect(weak).toHaveLength(strong.length);
    weak.forEach((peak, i) => expect(peak / strong[i]).toBeCloseTo(0.25));
    // Intensité bornée à 1 ; frôlement ou valeur invalide : aucun son.
    expect(peaksFor(4)).toEqual(strong);
    expect(peaksFor(0.01)).toEqual([]);
    expect(peaksFor(Number.NaN)).toEqual([]);

    // Un frôlement ignoré ne relance pas le délai minimal entre deux chocs.
    ctx.currentTime += 1;
    const graze: GameEvent = { type: 'wall', racerId: PLAYER, intensity: 0.01 };
    const hit: GameEvent = { type: 'wall', racerId: PLAYER, intensity: 0.8 };
    expect(sourcesCreatedBy(engine, ctx, [graze, hit])).toBe(strong.length);
  });

  it('choc entre karts : plus léger qu’un choc contre une haie, proportionnel à l’intensité', async () => {
    const { engine, ctx } = await createStartedEngine();
    const wall = sourcesPlayedBy(engine, ctx, [{ type: 'wall', racerId: PLAYER, intensity: 1 }]).map(envelopePeak);
    const bump = sourcesPlayedBy(engine, ctx, [{ type: 'bump', racerId: PLAYER, otherId: OTHER, intensity: 1 }]).map(envelopePeak);
    expect(bump.length).toBeGreaterThan(0);
    expect(Math.max(...bump)).toBeLessThan(Math.max(...wall));

    ctx.currentTime += 1;
    const half = sourcesPlayedBy(engine, ctx, [{ type: 'bump', racerId: OTHER, otherId: PLAYER, intensity: 0.5 }]).map(
      envelopePeak,
    );
    expect(half).toHaveLength(bump.length);
    half.forEach((peak, i) => expect(peak / bump[i]).toBeCloseTo(0.5));
  });

  it('les chocs répétés contre une haie sont limités dans le temps', async () => {
    const { engine, ctx } = await createStartedEngine();
    const wall: GameEvent = { type: 'wall', racerId: PLAYER, intensity: 0.5 };
    const once = sourcesCreatedBy(engine, ctx, [wall]);
    expect(sourcesCreatedBy(engine, ctx, [wall, wall])).toBe(0);
    ctx.currentTime += 1;
    expect(sourcesCreatedBy(engine, ctx, [wall])).toBe(once);
  });

  it('muet : gain maître à 0, aucun son ponctuel ; retour au volume ensuite', async () => {
    const { engine, ctx } = await createStartedEngine();
    const master = masterGain(ctx);
    engine.setMuted(true);
    expect(engine.muted).toBe(true);
    expect(master.gain.value).toBe(0);
    expect(master.gain.calls.at(-1)?.method).toBe('setTargetAtTime');
    expect(sourcesCreatedBy(engine, ctx, [{ type: 'go' }])).toBe(0);
    engine.setMuted(false);
    expect(master.gain.value).toBeCloseTo(0.6);
    expect(sourcesCreatedBy(engine, ctx, [{ type: 'go' }])).toBeGreaterThan(0);
  });

  it('le plafond de voix simultanées est respecté (les plus anciennes sont coupées)', async () => {
    const { engine, ctx } = await createStartedEngine();
    const beep: GameEvent = { type: 'countdown', value: 3 };
    const perVoice = sourcesCreatedBy(engine, ctx, [beep]);
    expect(perVoice).toBeGreaterThan(0);
    ctx.currentTime += 1;

    const burst = Array.from({ length: MAX_VOICES * 3 }, () => beep);
    const created = sourcesCreatedBy(engine, ctx, burst);
    expect(created).toBe(burst.length * perVoice);

    ctx.currentTime += 0.06;
    const burstSources = ctx.sources.slice(-created);
    const playing = burstSources.filter((source) => source.playingAt(ctx.currentTime));
    expect(playing).toHaveLength(MAX_VOICES * perVoice);
    // Ce sont les plus récentes qui jouent encore.
    expect(burstSources.slice(-MAX_VOICES * perVoice).every((source) => source.playingAt(ctx.currentTime))).toBe(true);
  });

  it('les voix terminées sont déconnectées', async () => {
    const { engine, ctx } = await createStartedEngine();
    const gainsBefore = ctx.gains.length;
    engine.handleEvents([{ type: 'item-box', racerId: PLAYER }], PLAYER);
    const voiceGains = ctx.gains.slice(gainsBefore);
    expect(voiceGains.length).toBeGreaterThan(0);
    ctx.currentTime += 5;
    engine.updatePlayer(RUNNING);
    expect(voiceGains.every((gain) => gain.disconnected)).toBe(true);
  });

  it('updatePlayer module la fréquence du moteur selon speed01 (et le boost)', async () => {
    const { engine, ctx } = await createStartedEngine();
    const { engineOsc, engineGain } = continuousSounds(ctx);

    engine.updatePlayer({ ...RUNNING, speed01: 0 });
    const idle = engineOsc.frequency.value;
    expect(idle).toBeCloseTo(70);
    expect(engineGain.gain.value).toBeGreaterThan(0);

    engine.updatePlayer({ ...RUNNING, speed01: 1 });
    const full = engineOsc.frequency.value;
    expect(full).toBeCloseTo(230);

    engine.updatePlayer({ ...RUNNING, speed01: 1, boosting: true });
    expect(engineOsc.frequency.value).toBeCloseTo(full * 1.15);
    expect(engineOsc.frequency.calls.at(-1)?.method).toBe('setTargetAtTime');

    engine.updatePlayer({ ...RUNNING, active: false });
    expect(engineGain.gain.value).toBe(0);
  });

  it('moteur : dent de scie et carré légèrement désaccordés → passe-bas, avec vibrato', async () => {
    const { engine, ctx } = await createStartedEngine();
    const { engineOsc } = continuousSounds(ctx);
    const lowpass = filterAfter(engineOsc);
    expect(lowpass.type).toBe('lowpass');
    const square = ctx.oscillators.find((osc) => osc.type === 'square' && downstream(osc).includes(lowpass));
    if (!square) throw new Error('oscillateur carré du moteur introuvable');
    expect(square.detune.value).not.toBe(0);
    expect(Math.abs(square.detune.value)).toBeLessThan(50);

    engine.updatePlayer({ ...RUNNING, speed01: 1 });
    expect(square.frequency.value).toBeCloseTo(230);

    // Vibrato : un oscillateur lent module la fréquence des deux oscillateurs.
    const vibrato = ctx.gains.find(
      (gain) => gain.connections.includes(engineOsc.frequency) && gain.connections.includes(square.frequency),
    );
    const lfo = ctx.oscillators.find((osc) => vibrato !== undefined && osc.connections.includes(vibrato));
    expect(lfo?.frequency.value).toBeLessThan(20);
    expect(vibrato?.gain.value).toBeGreaterThan(0);
    expect(vibrato?.gain.value).toBeLessThan(10);
  });

  it('updatePlayer : dérapage et hors-piste', async () => {
    const { engine, ctx } = await createStartedEngine();
    const { driftFilter, driftGain, offroadGain } = continuousSounds(ctx);

    engine.updatePlayer(RUNNING);
    expect(driftGain.gain.value).toBe(0);
    expect(offroadGain.gain.value).toBe(0);

    engine.updatePlayer({ ...RUNNING, drifting: true, driftTier: 1 });
    expect(driftGain.gain.value).toBeGreaterThan(0);
    const tier1 = driftFilter.frequency.value;
    engine.updatePlayer({ ...RUNNING, drifting: true, driftTier: 3 });
    expect(driftFilter.frequency.value).toBeGreaterThan(tier1);

    engine.updatePlayer({ ...RUNNING, offroad: true, speed01: 0.05 });
    expect(offroadGain.gain.value).toBe(0);
    engine.updatePlayer({ ...RUNNING, offroad: true, speed01: 0.8 });
    expect(offroadGain.gain.value).toBeGreaterThan(0);
  });

  it('updatePlayer ignore une vitesse invalide', async () => {
    const { engine, ctx } = await createStartedEngine();
    const { engineOsc } = continuousSounds(ctx);
    engine.updatePlayer({ ...RUNNING, speed01: Number.NaN });
    expect(engineOsc.frequency.value).toBeCloseTo(70);
    engine.updatePlayer({ ...RUNNING, speed01: 4 });
    expect(engineOsc.frequency.value).toBeCloseTo(230);
  });

  it('dispose() arrête les sources, déconnecte les nœuds et ferme le contexte', async () => {
    const { engine, ctx } = await createStartedEngine();
    engine.handleEvents(ALL_EVENTS, PLAYER);
    engine.dispose();

    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(engine.available).toBe(false);
    expect(ctx.sources.every((source) => source.stopTime !== null)).toBe(true);
    expect(ctx.gains.every((gain) => gain.disconnected)).toBe(true);
    expect(ctx.filters.every((filter) => filter.disconnected)).toBe(true);
    expect(ctx.sources.every((source) => source.disconnected)).toBe(true);
    expect(ctx.compressors[0].disconnected).toBe(true);

    // Ensuite, tout est no-op.
    const count = ctx.sources.length;
    engine.handleEvents(ALL_EVENTS, PLAYER);
    engine.updatePlayer(RUNNING);
    await engine.resume();
    engine.dispose();
    expect(ctx.sources).toHaveLength(count);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('dispose() tolère un close() qui rejette ou qui lève', async () => {
    const rejecting = createEngine();
    rejecting.ctx.close.mockRejectedValueOnce(new Error('déjà fermé'));
    expect(() => rejecting.engine.dispose()).not.toThrow();

    const throwing = createEngine();
    throwing.ctx.close.mockImplementationOnce(() => {
      throw new Error('déjà fermé');
    });
    expect(() => throwing.engine.dispose()).not.toThrow();
    // Laisse la promesse rejetée être absorbée.
    await Promise.resolve();
  });

  it('dispose() pendant resume() : aucun son continu créé', async () => {
    const { engine, ctx } = createEngine();
    const pending = engine.resume();
    engine.dispose();
    await pending;
    expect(ctx.sources).toHaveLength(0);
  });

  it('sons continus impossibles à créer : rien ne reste actif, les bruitages ponctuels restent possibles', async () => {
    const { engine, ctx } = createEngine();
    // Le 2ᵉ filtre (dérapage) échoue alors que les oscillateurs du moteur sont déjà démarrés.
    const createFilter = ctx.createBiquadFilter.bind(ctx);
    let filterCount = 0;
    vi.spyOn(ctx, 'createBiquadFilter').mockImplementation(() => {
      filterCount++;
      if (filterCount === 2) throw new Error('quota de nœuds atteint');
      return createFilter();
    });

    await expect(engine.resume()).resolves.toBeUndefined();
    expect(ctx.sources.length).toBeGreaterThan(0);
    expect(ctx.sources.every((source) => source.stopTime !== null && source.disconnected)).toBe(true);
    expect(() => engine.updatePlayer(RUNNING)).not.toThrow();
    expect(sourcesCreatedBy(engine, ctx, [{ type: 'go' }])).toBeGreaterThan(0);
  });
});

describe('AudioEngine : caractère des bruitages', () => {
  it('compte à rebours : bip court à 440 Hz ; départ : bip plus long à 880 Hz', async () => {
    const { engine, ctx } = await createStartedEngine();
    const [beep] = oscillatorsIn(sourcesPlayedBy(engine, ctx, [{ type: 'countdown', value: 2 }]));
    const [go] = oscillatorsIn(sourcesPlayedBy(engine, ctx, [{ type: 'go' }]));
    expect(rampOf(beep.frequency)).toEqual({ from: 440, to: 440 });
    expect(rampOf(go.frequency)).toEqual({ from: 880, to: 880 });
    expect(durationOf(beep)).toBeLessThan(0.3);
    expect(durationOf(go)).toBeGreaterThan(durationOf(beep));
  });

  it('chaque bruitage a une enveloppe courte : attaque puis déclin', async () => {
    for (const event of ALL_EVENTS) {
      const { engine, ctx } = await createStartedEngine();
      for (const source of sourcesPlayedBy(engine, ctx, [event])) {
        const calls = envelopeOf(source).gain.calls;
        expect(calls.map((call) => call.method), event.type).toEqual([
          'setValueAtTime',
          'linearRampToValueAtTime',
          'exponentialRampToValueAtTime',
        ]);
        const [start, peak, end] = calls;
        expect(peak.value, event.type).toBeGreaterThan(start.value);
        expect(end.value, event.type).toBeLessThan(peak.value);
        expect(peak.time - start.time, event.type).toBeLessThanOrEqual(0.1);
        expect(end.time - start.time, event.type).toBeLessThan(1);
        expect(source.startTime, event.type).toBe(start.time);
        expect(source.stopTime, event.type).toBeGreaterThanOrEqual(end.time);
      }
    }
  });

  it('le « ting » de dérapage monte avec le palier', async () => {
    const { engine, ctx } = await createStartedEngine();
    const pitchOf = (tier: DriftTier): number => {
      const tones = oscillatorsIn(sourcesPlayedBy(engine, ctx, [{ type: 'drift-tier', racerId: PLAYER, tier }]));
      return Math.min(...tones.map((osc) => rampOf(osc.frequency).from));
    };
    expectRising([pitchOf(1), pitchOf(2), pitchOf(3)]);
  });

  it('boost : souffle filtré qui monte et oscillateur qui glisse vers l’aigu', async () => {
    for (const boost of [
      { type: 'boost', racerId: PLAYER, source: 'drift', tier: 2 },
      { type: 'boost', racerId: PLAYER, source: 'item', tier: 0 },
    ] satisfies GameEvent[]) {
      const { engine, ctx } = await createStartedEngine();
      const played = sourcesPlayedBy(engine, ctx, [boost]);
      const rising = oscillatorsIn(played).filter((osc) => rampOf(osc.frequency).to > rampOf(osc.frequency).from);
      expect(rising.length, boost.source).toBeGreaterThan(0);
      const rush = noisesIn(played);
      expect(rush.length, boost.source).toBeGreaterThan(0);
      for (const noise of rush) {
        const sweep = rampOf(filterAfter(noise).frequency);
        expect(sweep.to, boost.source).toBeGreaterThan(sweep.from);
      }
    }
  });

  it('boîte à objets : arpège montant rapide', async () => {
    const { engine, ctx } = await createStartedEngine();
    const notes = notesOf(oscillatorsIn(sourcesPlayedBy(engine, ctx, [{ type: 'item-box', racerId: PLAYER }])));
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expectRising(notes.map((note) => note.freq));
    expect(notes[notes.length - 1].time - notes[0].time).toBeLessThan(0.4);
  });

  it('objet prêt : « pop » très bref ; objet utilisé : « whoosh » de bruit balayé', async () => {
    const { engine, ctx } = await createStartedEngine();
    const pop = sourcesPlayedBy(engine, ctx, [{ type: 'item-ready', racerId: PLAYER, item: 'bone' }]);
    expect(pop.length).toBeGreaterThan(0);
    expect(pop.every((source) => durationOf(source) <= 0.15)).toBe(true);

    const whoosh = noisesIn(sourcesPlayedBy(engine, ctx, [{ type: 'item-use', racerId: PLAYER, item: 'mud' }]));
    expect(whoosh.length).toBeGreaterThan(0);
    for (const noise of whoosh) {
      const sweep = rampOf(filterAfter(noise).frequency);
      expect(sweep.to).not.toBe(sweep.from);
    }
  });

  it('tour : carillon de deux notes ; dernier tour : trois notes montantes', async () => {
    const { engine, ctx } = await createStartedEngine();
    const lap = notesOf(oscillatorsIn(sourcesPlayedBy(engine, ctx, [{ type: 'lap', racerId: PLAYER, lap: 2 }])));
    expect(lap).toHaveLength(2);
    const finalLap = notesOf(oscillatorsIn(sourcesPlayedBy(engine, ctx, [{ type: 'final-lap', racerId: PLAYER }])));
    expect(finalLap).toHaveLength(3);
    expectRising(finalLap.map((note) => note.freq));
  });

  it('arrivée : arpège majeur puis aboiement', async () => {
    const { engine, ctx } = await createStartedEngine();
    const played = sourcesPlayedBy(engine, ctx, [{ type: 'finish', racerId: PLAYER, rank: 1 }]);
    const oscillators = oscillatorsIn(played);
    const barks = oscillators.filter((osc) => osc.type === 'sawtooth');
    const fanfare = notesOf(oscillators.filter((osc) => osc.type !== 'sawtooth'));
    // Tonique, tierce majeure, quinte, octave (tempérament égal ou juste).
    const ratios = fanfare.map((note) => note.freq / fanfare[0].freq);
    const expected = [1, 1.26, 1.5, 2];
    expect(ratios).toHaveLength(expected.length);
    ratios.forEach((ratio, i) => expect(Math.abs(ratio - expected[i])).toBeLessThan(0.02));
    expect(barks.length).toBeGreaterThan(0);
    expect(noisesIn(played).length).toBeGreaterThan(0);
    const lastNote = fanfare[fanfare.length - 1].time;
    expect(barks.every((bark) => (bark.startTime ?? 0) > lastNote)).toBe(true);
  });
});
