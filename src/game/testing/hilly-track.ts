/** Stade vallonné pour les tests de rendu : montée de 8 m et deux virages relevés à 20°. */
import { buildCenterline, type TrackCorner } from '../track/centerline';
import { buildProfile } from '../track/profile';
import { Track } from '../track/track';

export function createHillyTrack(): Track {
  const corners: TrackCorner[] = [
    { x: 195, z: -45, radius: 45, y: 0 },
    { x: 195, z: 45, radius: 45, y: 8, bank: 20 },
    { x: -195, z: 45, radius: 45, y: 8, bank: 20 },
    { x: -195, z: -45, radius: 45, y: 0 },
  ];
  const line = buildCenterline({ x: 0, z: -45 }, corners);
  return new Track(line, buildProfile(line, corners));
}
