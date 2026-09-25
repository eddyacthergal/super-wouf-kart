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

  it('tourne à gauche ou à droite, tout droit si les deux sont appuyés', () => {
    const touch = new TouchInput();
    touch.set('left', true);
    expect(touch.readDriverInput().steer).toBe(-1);
    touch.set('right', true);
    expect(touch.readDriverInput().steer).toBe(0);
    touch.set('left', false);
    expect(touch.readDriverInput().steer).toBe(1);
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

  it('reset relâche tout et oublie l’objet en attente', () => {
    const touch = new TouchInput();
    touch.set('left', true);
    touch.set('brake', true);
    touch.set('drift', true);
    touch.set('item', true);
    touch.reset();
    expect(touch.readDriverInput()).toEqual({ ...NEUTRAL_INPUT, throttle: true });
  });
});
