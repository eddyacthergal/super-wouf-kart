/**
 * Circuit « Grand Jardin » : points de contrôle de la spline Catmull-Rom centripète fermée (m).
 * Le point 0 est sur la ligne de départ/arrivée ; la course suit les indices croissants.
 *
 * Tour d'environ 910 m, sens global à gauche : longue ligne droite de départ, virage 1, chicane,
 * grande courbe, vallon (demi-tour à droite), épingle de la niche, virage à droite, puis un demi-tour
 * à gauche qui ramène sur la ligne droite. Les points des lignes droites encadrent chaque virage de près
 * pour que la spline suive fidèlement les rayons voulus. Les contraintes (longueur, rayon minimal,
 * écart entre couloirs, etc.) sont vérifiées dans track.spec.ts.
 */
import type { Vec2 } from '../../core/vec2';
import type { TrackDefinition } from '../track-definition';

export const GARDEN_CONTROL_POINTS: readonly Vec2[] = [
  // Ligne droite de départ : le point 0 est la ligne d'arrivée, les points voisins restent alignés.
  { x: -17, z: -90 },
  { x: -64, z: -90 },
  { x: -77, z: -90 },
  // Virage 1 : gauche à 90°, rayon 35 m.
  { x: -87.8, z: -88.3 },
  { x: -97.6, z: -83.3 },
  { x: -105.3, z: -75.6 },
  { x: -110.3, z: -65.8 },
  { x: -112, z: -55 },
  // Ligne droite de sortie du virage 1 (première rangée de boîtes).
  { x: -112, z: -50 },
  { x: -112, z: -20 },
  { x: -112, z: -15 },
  // Chicane du potager : droite 50° puis gauche 50°, rayon 22 m.
  { x: -112.9, z: -8.7 },
  { x: -115.6, z: -2.9 },
  { x: -119.9, z: 1.9 },
  { x: -124.5, z: 5.7 },
  { x: -128.7, z: 10.5 },
  { x: -131.4, z: 16.3 },
  { x: -132.3, z: 22.6 },
  // Courte ligne droite.
  { x: -132.3, z: 27.6 },
  { x: -132.3, z: 32.6 },
  { x: -132.3, z: 37.6 },
  // Grande courbe de la pelouse : gauche 145°, rayon 52 m, qui se referme sur 35° (rayon 28 m).
  { x: -129.7, z: 53.7 },
  { x: -122.2, z: 68.3 },
  { x: -110.6, z: 79.8 },
  { x: -96, z: 87.2 },
  { x: -79.7, z: 89.6 },
  { x: -63.6, z: 86.8 },
  { x: -49.1, z: 79.2 },
  { x: -37.7, z: 67.4 },
  { x: -33.9, z: 59.7 },
  { x: -32.7, z: 51.3 },
  // Ligne droite centrale.
  { x: -32.7, z: 46.3 },
  { x: -32.7, z: 33 },
  { x: -32.7, z: 28 },
  // Vallon : demi-tour à droite en deux virages (rayons 28 et 24 m).
  { x: -31.3, z: 19.3 },
  { x: -27.3, z: 11.5 },
  { x: -21.1, z: 5.3 },
  { x: -13.3, z: 1.4 },
  { x: -4.7, z: 0 },
  { x: 2, z: 0 },
  { x: 9.4, z: 1.2 },
  { x: 16.1, z: 4.6 },
  { x: 21.4, z: 9.9 },
  { x: 24.8, z: 16.6 },
  { x: 26, z: 24 },
  // Ligne droite vers la niche (deuxième rangée de boîtes).
  { x: 26, z: 29 },
  { x: 26, z: 59 },
  { x: 26, z: 64 },
  // Épingle de la niche : gauche à 180°, rayon 21 m.
  { x: 27.3, z: 71.2 },
  { x: 30.9, z: 77.5 },
  { x: 36.5, z: 82.2 },
  { x: 43.4, z: 84.7 },
  { x: 50.6, z: 84.7 },
  { x: 57.5, z: 82.2 },
  { x: 63.1, z: 77.5 },
  { x: 66.7, z: 71.2 },
  { x: 68, z: 64 },
  // Ligne droite de retour.
  { x: 68, z: 59 },
  { x: 68, z: 29 },
  { x: 68, z: 24 },
  // Virage à droite à 90°, rayon 24 m.
  { x: 69.2, z: 16.6 },
  { x: 72.6, z: 9.9 },
  { x: 77.9, z: 4.6 },
  { x: 84.6, z: 1.2 },
  { x: 92, z: 0 },
  { x: 102, z: 0 },
  // Demi-tour à gauche en deux virages de 90° (rayon 30 m) encadrant la troisième rangée de boîtes.
  { x: 111.3, z: -1.5 },
  { x: 119.6, z: -5.7 },
  { x: 126.3, z: -12.4 },
  { x: 130.5, z: -20.7 },
  { x: 132, z: -30 },
  { x: 132, z: -35 },
  { x: 132, z: -55 },
  { x: 132, z: -60 },
  { x: 130.5, z: -69.3 },
  { x: 126.3, z: -77.6 },
  { x: 119.6, z: -84.3 },
  { x: 111.3, z: -88.5 },
  { x: 102, z: -90 },
  // Retour sur la ligne droite de départ.
  { x: 97, z: -90 },
  { x: 67, z: -90 },
  { x: 62, z: -90 },
  { x: 49, z: -90 },
];

export const GRAND_JARDIN: TrackDefinition = {
  id: 'grand-jardin',
  name: 'Grand Jardin',
  description: 'Le grand tour : longue ligne droite, chicane et épingle de la niche.',
  theme: 'garden',
  controlPoints: GARDEN_CONTROL_POINTS,
  decor: {
    landmarks: [
      { kind: 'doghouse', x: -40, z: -114, radius: 5.5 },
      { kind: 'kibble-bowl', x: 47, z: 58, radius: 4.4 },
      { kind: 'watering-can', x: 72, z: -50, radius: 6.2 },
      // Rayon = portée des jets d'eau tournants (~7,4 m), pas seulement le pied de l'arroseur.
      // Rayon = portée des jets d'eau tournants (~7,4 m), pas seulement le pied de l'arroseur.
      { kind: 'sprinkler', x: -8, z: -46, radius: 7.6 },
      { kind: 'giant-bone', x: -64, z: -46, radius: 6.5 },
      { kind: 'gnome', x: -3, z: 30, radius: 2.8 },
      { kind: 'gnome', x: 112, z: 42, radius: 2.8 },
    ],
    // Pierres de gué : un chemin sinueux qui traverse la pelouse centrale.
    path: { from: { x: -94, z: -30 }, to: { x: 114, z: -24 } },
  },
};
