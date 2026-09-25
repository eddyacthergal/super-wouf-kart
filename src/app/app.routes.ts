import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Wouf Kart',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  {
    path: 'garage',
    title: 'Garage · Wouf Kart',
    loadComponent: () => import('./features/garage/garage').then((m) => m.Garage),
  },
  {
    path: 'circuits',
    title: 'Circuits · Wouf Kart',
    loadComponent: () => import('./features/circuits/circuit-select').then((m) => m.CircuitSelect),
  },
  {
    path: 'course',
    title: 'Course · Wouf Kart',
    loadComponent: () => import('./features/race/race-page').then((m) => m.RacePage),
  },
  { path: '**', redirectTo: '' },
];
