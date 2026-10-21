/**
 * opensinnoh.com's script: the theme pick (the app's key and setter), the hero loop's play/pause (paused for
 * reduced motion), the whole-pixel snap and the anonymous visit count (analytics.ts). The art is markup and the tokens are CSS from the build (prerender.ts).
 */
import 'virtual:os-tokens.css';
import '@opensinnoh/ui/fonts.css';
import '@opensinnoh/ui/os.css';
import './site.css';
import { setThemeMode, snapPixels, themeMode, type ThemeMode } from '@opensinnoh/ui';
import { installAnalytics } from './analytics.ts';

const picks = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-pick]')];
const showTheme = () => {
  const mode = themeMode();
  for (const b of picks) b.setAttribute('aria-pressed', String(b.dataset.themePick === mode));
};
for (const b of picks)
  b.addEventListener('click', () => {
    setThemeMode(b.dataset.themePick as ThemeMode);
    showTheme();
  });
showTheme();

const video = document.querySelector<HTMLVideoElement>('video.loop')!;
const toggle = document.querySelector<HTMLButtonElement>('[data-loop-toggle]')!;
const still = matchMedia('(prefers-reduced-motion: reduce)');
const showLoop = () => {
  toggle.setAttribute('aria-label', `Gameplay montage, press to ${video.paused ? 'play' : 'pause'}`);
};
const play = () => {
  video.preload = 'auto';
  // A refused autoplay (data saver, a browser policy) leaves the poster; the video itself is the play button.
  video.play().catch(showLoop);
};
video.addEventListener('play', showLoop);
video.addEventListener('pause', showLoop);
toggle.addEventListener('click', () => (video.paused ? play() : video.pause()));
still.addEventListener('change', () => (still.matches ? video.pause() : play()));
if (!still.matches) play();
showLoop();

const snap = () => snapPixels(document.body);
void document.fonts.ready.then(snap);
addEventListener('resize', snap);

installAnalytics();
