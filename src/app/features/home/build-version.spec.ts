import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BuildVersion } from './build-version';

describe('BuildVersion', () => {
  async function render(version: string, buildDate: string): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(BuildVersion);
    fixture.componentRef.setInput('version', version);
    fixture.componentRef.setInput('buildDate', buildDate);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('affiche la version et la date du build en français', async () => {
    const element = await render('1.2.3', '2026-09-25T12:00:00.000Z');
    expect(element.textContent).toContain('Version 1.2.3');
    const time = element.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-09-25T12:00:00.000Z');
    expect(time?.textContent).toContain('septembre 2026');
  });

  it('affiche la date brute si elle est illisible', async () => {
    const element = await render('1.2.3', 'inconnue');
    expect(element.querySelector('time')?.textContent?.trim()).toBe('inconnue');
  });
});
