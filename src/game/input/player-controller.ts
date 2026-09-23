import type { DriverController, DriverInput } from '../core/types';

/** Source de commandes du joueur (KeyboardInput en pratique). */
export interface DriverInputSource {
  readDriverInput(): DriverInput;
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
