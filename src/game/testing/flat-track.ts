/** Stade plat pour les tests de rendu qui veulent un circuit sans aucun relief (ni `y`, ni `bank`). */
import { buildCenterline, type TrackCorner } from '../track/centerline';
import { Track } from '../track/track';

export function createFlatTrack(): Track {
  const corners: TrackCorner[] = [
    { x: 195, z: -45, radius: 45 },
    { x: 195, z: 45, radius: 45 },
    { x: -195, z: 45, radius: 45 },
    { x: -195, z: -45, radius: 45 },
  ];
  const line = buildCenterline({ x: 0, z: -45 }, corners);
  return new Track(line);
}
