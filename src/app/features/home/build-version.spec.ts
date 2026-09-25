import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BuildVersion, formatBuildDate } from './build-version';

describe('BuildVersion', () => {
  async function render(version: string, buildDate: string): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(BuildVersion);
    fixture.componentRef.setInput('version', version);
    fixture.componentRef.setInput('buildDate', buildDate);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('affiche la version et la date du build au format dd/MM/yyyy HH:mm:ss', async () => {
    // Date locale : le résultat ne dépend pas du fuseau de la machine de test.
    const iso = new Date(2026, 8, 5, 7, 4, 9).toISOString();
    const element = await render('1.2.3', iso);
    expect(element.textContent).toContain('Version 1.2.3');
    const time = element.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(iso);
    expect(time?.textContent?.trim()).toBe('05/09/2026 07:04:09');
  });

  it('formatBuildDate complète chaque champ par des zéros', () => {
    expect(formatBuildDate(new Date(2026, 11, 31, 23, 59, 58))).toBe('31/12/2026 23:59:58');
    expect(formatBuildDate(new Date(2027, 0, 1, 0, 0, 0))).toBe('01/01/2027 00:00:00');
  });

  it('affiche la date brute si elle est illisible', async () => {
    const element = await render('1.2.3', 'inconnue');
    expect(element.querySelector('time')?.textContent?.trim()).toBe('inconnue');
  });
});
