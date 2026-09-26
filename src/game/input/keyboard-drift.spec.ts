import { describe, expect, it } from 'vitest';
import { AiController } from '../ai/ai-controller';
import { createAiPersonality } from '../ai/personality';
import { FIXED_DT } from '../core/constants';
import { createRng } from '../core/rng';
import { EMPTY_SKINS, type DriverController, type GameEvent } from '../core/types';
import { headingOf, sub, wrapAngle } from '../core/vec2';
import { createRoster } from '../race/roster';
import { RaceSimulation } from '../race/simulation';
import { TRACK_CATALOG } from '../track/catalog';
import type { TrackDefinition } from '../track/track-definition';
import { createTrack } from '../track/track';
import { KeyboardInput } from './keyboard-input';
import { PlayerController } from './player-controller';

type Style = 'sans dérapage' | 'flèche lâchée' | 'flèche gardée';

interface Lap {
  time: number;
  drifts: number;
  wrongWay: number;
  walls: number;
  boosts: number;
  offroad: number;
}

/**
 * Un tour joué par le vrai chemin du joueur : événements clavier → KeyboardInput →
 * PlayerController → simulation, au milieu des 7 IA. Hors virage, ↑ et flèches (tout ou rien)
 * vers un point devant. À l'entrée d'un virage : Espace + flèche vers l'intérieur, flèche lâchée
 * 0,2 s plus tard ou gardée, Espace relâché à la sortie ou quand le virage change de sens.
 */
function playLap(definition: TrackDefinition, style: Style): Lap {
  const track = createTrack(definition);
  const rng = createRng(3);
  const sim = new RaceSimulation(track, createRoster('chihuahua', EMPTY_SKINS, rng), {
    laps: 1,
    rng,
  });
  const target = new EventTarget();
  const keyboard = new KeyboardInput({ target });
  keyboard.attach();
  const key = (type: 'keydown' | 'keyup', code: string): void => {
    target.dispatchEvent(new KeyboardEvent(type, { code }));
  };
  const controllers = new Map<number, DriverController>();
  for (const racer of sim.state.racers) {
    controllers.set(
      racer.id,
      racer.isPlayer
        ? new PlayerController(racer.id, keyboard)
        : new AiController(
            racer.id,
            createAiPersonality(createRng(9), racer.id),
            createRng(racer.id),
          ),
    );
  }
  const player = sim.state.racers.find((racer) => racer.isPlayer);
  if (!player) throw new Error('Pas de joueur');
  const lap: Lap = { time: 0, drifts: 0, wrongWay: 0, walls: 0, boosts: 0, offroad: 0 };
  let phase: 'drive' | 'entry' | 'hold' = 'drive';
  let entryTime = 0;
  let arrow = '';
  let wasDrifting = false;
  key('keydown', 'ArrowUp');
  for (let i = 0; i < 120 / FIXED_DT && !player.finished; i++) {
    const kart = player.kart;
    const projection = track.project(kart.position, kart.trackIndex);
    const curvature = track.sampleAt(projection.s + 10).curvature;
    if (phase === 'drive') {
      const ahead = track.sampleAt(projection.s + 10 + kart.speed * 0.35);
      const error = wrapAngle(headingOf(sub(ahead.position, kart.position)) - kart.heading);
      const wanted = error > 0.05 ? 'ArrowLeft' : error < -0.05 ? 'ArrowRight' : '';
      for (const code of ['ArrowLeft', 'ArrowRight'])
        key(code === wanted ? 'keydown' : 'keyup', code);
    }
    if (sim.state.phase === 'racing') {
      if (
        style !== 'sans dérapage' &&
        phase === 'drive' &&
        Math.abs(curvature) > 1 / 50 &&
        kart.speed > 14
      ) {
        arrow = curvature > 0 ? 'ArrowLeft' : 'ArrowRight';
        key('keyup', 'ArrowLeft');
        key('keyup', 'ArrowRight');
        key('keydown', 'Space');
        key('keydown', arrow);
        phase = 'entry';
        entryTime = 0;
      } else if (phase === 'entry' && (entryTime += FIXED_DT) > 0.2) {
        if (style === 'flèche lâchée') key('keyup', arrow);
        phase = 'hold';
      } else if (
        phase === 'hold' &&
        (!kart.drift.active ||
          Math.abs(curvature) < 1 / 70 ||
          curvature > 0 !== (arrow === 'ArrowLeft'))
      ) {
        key('keyup', 'Space');
        key('keyup', arrow);
        phase = 'drive';
      }
    }
    const events: GameEvent[] = sim.step(FIXED_DT, controllers);
    for (const event of events) {
      if (!('racerId' in event) || event.racerId !== player.id) continue;
      if (event.type === 'wall') lap.walls++;
      if (event.type === 'boost' && event.source === 'drift') lap.boosts++;
    }
    if (kart.drift.active && !wasDrifting) {
      lap.drifts++;
      // Virage à gauche (courbure > 0) : dérapage attendu à gauche (-1).
      if (Math.sign(curvature) === kart.drift.direction) lap.wrongWay++;
    }
    wasDrifting = kart.drift.active;
    if (sim.state.phase === 'racing') {
      lap.time += FIXED_DT;
      if (kart.offroad) lap.offroad += FIXED_DT;
    }
  }
  return lap;
}

describe('dérapage au clavier, par le vrai chemin des commandes', () => {
  it.each(TRACK_CATALOG.map((track) => [track.name, track] as const))(
    '%s : dérapage dans chaque virage, sans choc ni sortie de piste, et plus rapide que sans déraper',
    (_name, definition) => {
      const reference = playLap(definition, 'sans dérapage');
      for (const style of ['flèche lâchée', 'flèche gardée'] as const) {
        const lap = playLap(definition, style);
        expect(lap.drifts, style).toBeGreaterThanOrEqual(5);
        expect(lap.wrongWay, style).toBe(0);
        expect(lap.walls, style).toBe(0);
        expect(lap.offroad / lap.time, style).toBeLessThan(0.02);
        expect(lap.boosts, style).toBeGreaterThanOrEqual(lap.drifts - 2);
        expect(lap.time, style).toBeLessThan(reference.time);
      }
    },
    120_000,
  );
});
