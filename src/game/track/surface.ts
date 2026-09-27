/** Sol de la piste autour d'un échantillon : plan incliné par la pente et le dévers. */
import type { TrackSample, TrackSurface } from '../core/types';

export function surfaceOf(sample: TrackSample, lateral: number): TrackSurface {
  // dh/dlateral : un dévers positif abaisse le bord gauche (lateral > 0).
  const cross = -Math.tan(sample.bank);
  return {
    height: sample.height + cross * lateral,
    gradient: {
      x: sample.tangent.x * sample.grade + sample.left.x * cross,
      z: sample.tangent.z * sample.grade + sample.left.z * cross,
    },
  };
}
