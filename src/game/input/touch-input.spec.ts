import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../core/types';
import { TouchInput } from './touch-input';

describe('TouchInput', () => {
  it('accélère tout seul tant que le frein n’est pas appuyé', () => {
    const touch = new TouchInput();
    expect(touch.readDriverInput()).toEqual({ ...NEUTRAL_INPUT, throttle: true });
    touch.set('brake', true);
    expect(touch.readDriverInput()).toEqual({ ...NEUTRAL_INPUT, brake: true });
    touch.set('brake', false);
    expect(touch.readDriverInput().throttle).toBe(true);
  });

  it('joystick : braquage analogique borné à [-1, 1], tout droit si la valeur est invalide', () => {
    const touch = new TouchInput();
    touch.setSteer(-0.4);
    expect(touch.readDriverInput().steer).toBe(-0.4);
    touch.setSteer(3);
    expect(touch.readDriverInput().steer).toBe(1);
    touch.setSteer(-3);
    expect(touch.readDriverInput().steer).toBe(-1);
    touch.setSteer(Number.NaN);
    expect(touch.readDriverInput().steer).toBe(0);
  });

  it('dérape tant que le bouton est maintenu', () => {
    const touch = new TouchInput();
    touch.set('drift', true);
    expect(touch.readDriverInput().drift).toBe(true);
    expect(touch.readDriverInput().drift).toBe(true);
    touch.set('drift', false);
    expect(touch.readDriverInput().drift).toBe(false);
  });

  it('objet : un seul usage par appui, même si le doigt reste posé', () => {
    const touch = new TouchInput();
    touch.set('item', true);
    touch.set('item', true);
    expect(touch.readDriverInput().useItem).toBe(true);
    expect(touch.readDriverInput().useItem).toBe(false);
    touch.set('item', false);
    touch.set('item', true);
    expect(touch.readDriverInput().useItem).toBe(true);
  });

  it('reset relâche tout, recentre le joystick et oublie l’objet en attente', () => {
    const touch = new TouchInput();
    touch.setSteer(-1);
    touch.set('brake', true);
    touch.set('drift', true);
    touch.set('item', true);
    touch.reset();
    expect(touch.readDriverInput()).toEqual({ ...NEUTRAL_INPUT, throttle: true });
  });
});
