import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import { routes } from './app.routes';
import { SETTINGS_STORAGE } from './core/settings.store';
import { MemoryStorage } from './testing/memory-storage';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        { provide: SETTINGS_STORAGE, useValue: new MemoryStorage() },
      ],
    });
  });

  it('déclare des routes paresseuses titrées, et renvoie les inconnues vers l’accueil', () => {
    const summary = routes.map((route) => [route.path, route.title ?? null, typeof route.loadComponent]);
    expect(summary).toEqual([
      ['', 'Wouf Kart', 'function'],
      ['garage', 'Garage · Wouf Kart', 'function'],
      ['course', 'Course · Wouf Kart', 'function'],
      ['**', null, 'undefined'],
    ]);
    expect(routes.at(-1)?.redirectTo).toBe('');
  });

  it('affiche l’accueil, puis donne le focus au titre de chaque nouvelle page', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const element = fixture.nativeElement as HTMLElement;

    await router.navigateByUrl('/');
    await fixture.whenStable();
    expect(element.querySelector('main h1')?.textContent?.trim()).toBe('Wouf Kart');
    expect(TestBed.inject(Title).getTitle()).toBe('Wouf Kart');

    await router.navigateByUrl('/garage');
    await fixture.whenStable();
    expect(TestBed.inject(Title).getTitle()).toBe('Garage · Wouf Kart');
    expect(document.activeElement).toBe(element.querySelector('main h1'));
    expect(document.activeElement?.textContent?.trim()).toBe('Garage');
  });

  it('redirige une adresse inconnue vers l’accueil', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/nulle-part');
    await fixture.whenStable();
    expect(router.url).toBe('/');
  });
});
