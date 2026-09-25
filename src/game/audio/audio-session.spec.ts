import { describe, expect, it } from 'vitest';
import {
  isAppleTouchDevice,
  requestPlaybackSession,
  SilentLoop,
  silentWavDataUri,
  type LoopingAudio,
} from './audio-session';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile';

class FakeAudio implements LoopingAudio {
  src = '';
  loop = false;
  paused = true;
  playCalls = 0;
  attributes = new Map<string, string>();
  fail = false;

  play(): Promise<void> {
    this.playCalls++;
    if (this.fail) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'src') this.src = '';
  }

  load(): void {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

describe('isAppleTouchDevice', () => {
  it('reconnaît iPhone et iPad (y compris iPadOS « Mac tactile »), pas Android ni un Mac', () => {
    expect(isAppleTouchDevice({ userAgent: IPHONE })).toBe(true);
    expect(
      isAppleTouchDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBe(true);
    expect(
      isAppleTouchDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }),
    ).toBe(false);
    expect(isAppleTouchDevice({ userAgent: ANDROID })).toBe(false);
    expect(isAppleTouchDevice(undefined)).toBe(false);
  });
});

describe('requestPlaybackSession', () => {
  it('passe la session audio en « lecture » si l’API existe', () => {
    const nav = { userAgent: IPHONE, audioSession: { type: 'auto' } };
    requestPlaybackSession(nav);
    expect(nav.audioSession.type).toBe('playback');
    expect(() => requestPlaybackSession({ userAgent: ANDROID })).not.toThrow();
    expect(() => requestPlaybackSession(undefined)).not.toThrow();
  });
});

describe('SilentLoop', () => {
  it('joue en boucle un son muet, une seule fois tant qu’il joue, puis se libère', () => {
    const audio = new FakeAudio();
    const loop = new SilentLoop(() => audio);
    expect(audio.loop).toBe(true);
    expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(audio.attributes.get('x-webkit-airplay')).toBe('deny');

    loop.play();
    loop.play();
    expect(audio.playCalls).toBe(1);

    loop.dispose();
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe('');
    loop.play();
    expect(audio.playCalls).toBe(1);
  });

  it('lecture refusée : pas d’erreur, un prochain geste réessaie', async () => {
    const audio = new FakeAudio();
    audio.fail = true;
    const loop = new SilentLoop(() => audio);
    expect(() => loop.play()).not.toThrow();
    await Promise.resolve();
    audio.fail = false;
    loop.play();
    expect(audio.playCalls).toBe(2);
  });
});

describe('silentWavDataUri', () => {
  it('produit un WAV PCM muet valide', () => {
    const uri = silentWavDataUri();
    const bytes = Uint8Array.from(atob(uri.split(',')[1]), (char) => char.charCodeAt(0));
    const ascii = (from: number, to: number): string =>
      String.fromCharCode(...bytes.slice(from, to));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 12)).toBe('WAVE');
    expect(ascii(36, 40)).toBe('data');
    expect(bytes.length).toBe(44 + 800);
    expect(bytes.slice(44).every((byte) => byte === 128)).toBe(true);
  });
});
