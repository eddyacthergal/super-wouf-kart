/**
 * Commandes tactiles du joueur (téléphone, tablette), alimentées par l'écran : joystick de
 * direction (analogique) et boutons. L'accélération est automatique : le frein la coupe (et fait
 * reculer à l'arrêt), comme dans les jeux de kart sur mobile, ce qui laisse un pouce pour tourner
 * et l'autre pour le reste.
 */
import type { DriverInput } from '../core/types';
import { clamp } from '../core/vec2';
import type { TouchAction } from '../game-api';

export class TouchInput {
  private readonly held = new Set<TouchAction>();
  private steer = 0;
  /** Front montant du bouton d'objet, en attente de lecture. */
  private itemRequested = false;

  /** Appui (`pressed`) ou relâchement d'un bouton. */
  set(action: TouchAction, pressed: boolean): void {
    if (pressed) {
      if (action === 'item' && !this.held.has('item')) this.itemRequested = true;
      this.held.add(action);
    } else {
      this.held.delete(action);
    }
  }

  /** Braquage du joystick, de -1 (gauche) à +1 (droite) ; une valeur invalide vaut « tout droit ». */
  setSteer(steer: number): void {
    this.steer = Number.isFinite(steer) ? clamp(steer, -1, 1) : 0;
  }

  /** Relâche toutes les commandes et oublie l'appui d'objet en attente. */
  reset(): void {
    this.held.clear();
    this.steer = 0;
    this.itemRequested = false;
  }

  /** Commandes pour le pas courant ; consomme le front montant du bouton d'objet. */
  readDriverInput(): DriverInput {
    const useItem = this.itemRequested;
    this.itemRequested = false;
    const brake = this.held.has('brake');
    return {
      throttle: !brake,
      brake,
      steer: this.steer,
      drift: this.held.has('drift'),
      useItem,
    };
  }
}
