import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, BUILD_DATE_LOADER } from '../../core/build-info';
import { BuildVersion, formatBuildDate } from './build-version';

describe('BuildVersion', () => {
  async function render(buildDate: string | null): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [{ provide: BUILD_DATE_LOADER, useValue: () => Promise.resolve(buildDate) }],
    });
    const fixture = TestBed.createComponent(BuildVersion);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('affiche la version de package.json et la date du build au format dd/MM/yyyy HH:mm:ss', async () => {
    // Date locale : le résultat ne dépend pas du fuseau de la machine de test.
    const iso = new Date(2026, 8, 5, 7, 4, 9).toISOString();
    const element = await render(iso);
    expect(element.textContent).toContain(`Version ${APP_VERSION}`);
    const time = element.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(iso);
    expect(time?.textContent?.trim()).toBe('05/09/2026 07:04:09');
    expect(element.textContent?.replace(/\s+/g, ' ')).toContain('build 05/09/2026 07:04:09');
  });

  it('n’affiche que la version si la date du build est inconnue', async () => {
    const element = await render(null);
    expect(element.textContent).toContain(`Version ${APP_VERSION}`);
    expect(element.textContent).not.toContain('build');
    expect(element.querySelector('time')).toBeNull();
  });

  it('affiche la date brute si elle est illisible', async () => {
    const element = await render('inconnue');
    expect(element.querySelector('time')?.textContent?.trim()).toBe('inconnue');
  });

  it('formatBuildDate complète chaque champ par des zéros', () => {
    expect(formatBuildDate(new Date(2026, 11, 31, 23, 59, 58))).toBe('31/12/2026 23:59:58');
    expect(formatBuildDate(new Date(2027, 0, 1, 0, 0, 0))).toBe('01/01/2027 00:00:00');
  });
});
