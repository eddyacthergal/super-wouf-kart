/**
 * Commandes tactiles du joueur (téléphone, tablette), alimentées par les boutons à l'écran.
 * L'accélération est automatique : le frein la coupe (et fait reculer à l'arrêt), comme dans
 * les jeux de kart sur mobile, ce qui laisse un pouce pour tourner et l'autre pour le reste.
 */
import type { DriverInput } from '../core/types';
import type { TouchAction } from '../game-api';

export class TouchInput {
  private readonly held = new Set<TouchAction>();
  /** Front montant du bouton d'objet, en attente de lecture. */
  private itemRequested = false;

  /** Appui (`pressed`) ou relâchement d'une commande. */
  set(action: TouchAction, pressed: boolean): void {
    if (pressed) {
      if (action === 'item' && !this.held.has('item')) this.itemRequested = true;
      this.held.add(action);
    } else {
      this.held.delete(action);
    }
  }

  /** Relâche toutes les commandes et oublie l'appui d'objet en attente. */
  reset(): void {
    this.held.clear();
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
      steer: (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0),
      drift: this.held.has('drift'),
      useItem,
    };
  }
}
