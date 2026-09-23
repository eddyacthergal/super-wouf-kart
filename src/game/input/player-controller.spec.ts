import { describe, expect, it, vi } from 'vitest';
import { FIXED_DT } from '../core/constants';
import {
  NEUTRAL_INPUT,
  type DriverContext,
  type DriverController,
  type DriverInput,
} from '../core/types';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import { KeyboardInput } from './keyboard-input';
import { PlayerController } from './player-controller';

function createContext(): DriverContext {
  const track = createCircleTrack();
  const race = createTestRace(track, 2);
  return { racer: race.racers[0], race, track, dt: FIXED_DT };
}

describe('PlayerController', () => {
  it('relaie à chaque pas les commandes lues sur la source', () => {
    const first: DriverInput = {
      throttle: true,
      brake: false,
      steer: -1,
      drift: true,
      useItem: true,
    };
    const second: DriverInput = { ...NEUTRAL_INPUT, brake: true, steer: 0.5 };
    const readDriverInput = vi
      .fn<() => DriverInput>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const controller: DriverController = new PlayerController(3, { readDriverInput });
    const context = createContext();

    expect(controller.racerId).toBe(3);
    expect(controller.update(context)).toEqual(first);
    expect(controller.update(context)).toEqual(second);
    expect(readDriverInput).toHaveBeenCalledTimes(2);
  });

  it('se branche sur KeyboardInput (sans DOM : cible EventTarget)', () => {
    const target = new EventTarget();
    const keyboard = new KeyboardInput({ target });
    keyboard.attach();
    const controller = new PlayerController(0, keyboard);
    const keydown = (code: string): void => {
      target.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: false }),
      );
    };

    keydown('ArrowUp');
    keydown('KeyE');
    expect(controller.update()).toEqual({ ...NEUTRAL_INPUT, throttle: true, useItem: true });
    expect(controller.update()).toEqual({ ...NEUTRAL_INPUT, throttle: true });
    keyboard.detach();
  });
});
