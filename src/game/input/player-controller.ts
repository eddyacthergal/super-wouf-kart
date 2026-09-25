import type { DriverController, DriverInput } from '../core/types';
import { clamp } from '../core/vec2';

/** Source de commandes du joueur (KeyboardInput, TouchInput). */
export interface DriverInputSource {
  readDriverInput(): DriverInput;
}

/**
 * Réunit plusieurs sources (clavier et écran tactile) : une commande est active si une source
 * l'active, les braquages s'additionnent (bornés à [-1, 1]). Chaque source est lue à chaque pas,
 * pour que ses appuis d'objet en attente soient consommés.
 */
export function combineInputSources(sources: readonly DriverInputSource[]): DriverInputSource {
  return {
    readDriverInput: () => {
      const inputs = sources.map((source) => source.readDriverInput());
      const brake = inputs.some((input) => input.brake);
      return {
        // Le frein l'emporte : l'accélération automatique du tactile ne doit pas le contrer.
        throttle: !brake && inputs.some((input) => input.throttle),
        brake,
        steer: clamp(
          inputs.reduce((sum, input) => sum + input.steer, 0),
          -1,
          1,
        ),
        drift: inputs.some((input) => input.drift),
        useItem: inputs.some((input) => input.useItem),
      };
    },
  };
}

/** Contrôleur du kart du joueur : relaie à chaque pas les commandes lues sur la source. */
export class PlayerController implements DriverController {
  constructor(
    readonly racerId: number,
    private readonly source: DriverInputSource,
  ) {}

  update(): DriverInput {
    return this.source.readDriverInput();
  }
}
