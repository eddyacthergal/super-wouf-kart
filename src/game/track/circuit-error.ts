/** Erreur de description d'un circuit : problèmes lisibles, en français, tous listés d'un coup. */
export class CircuitError extends Error {
  constructor(
    readonly issues: readonly string[],
    circuit?: string,
  ) {
    super(`${circuit ? `Circuit « ${circuit} » : ` : ''}${issues.join(' ')}`);
    this.name = 'CircuitError';
  }
}
