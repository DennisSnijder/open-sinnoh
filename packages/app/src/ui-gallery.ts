/**
 * The OpenSinnoh UI gallery (dev builds only: `?ui-gallery`, main.ts): every component and state of
 * @opensinnoh/ui, side by side in the dark and the light theme. tests/browser/ui-gallery.spec.ts checks it
 * for overflow, console errors, text contrast, touch targets and whole pixels. Original content only.
 */
import {
  ICONS,
  WINDOW_FRAMES,
  backButton,
  banner,
  button,
  choices,
  cycle,
  dialog,
  filePicker,
  footer,
  h,
  icon,
  iconButton,
  logo,
  pick,
  pixelTitle,
  progress,
  row,
  select,
  sheet,
  slider,
  snapPixels,
  tabs,
  textInput,
  titleTab,
  toast,
  toggle,
  typeText,
  wordmark,
  type IconName,
  type Tone,
} from '@opensinnoh/ui';

const CSS = `
html:has(body.os-gallery), body.os-gallery { overflow: auto; height: auto; }
.gal { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 960px) { .gal { grid-template-columns: minmax(0, 1fr); } }
.gal-theme { padding: 24px 16px 48px; display: grid; gap: 16px; align-content: start; min-width: 0; }
.gal-card { background: var(--os-face); box-shadow: inset 0 0 0 2px var(--os-line); padding: 16px; display: grid; gap: 12px; min-width: 0; }
.gal-card > h3 { margin: 0; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--os-muted); text-transform: uppercase; letter-spacing: .06em; }
.gal-demo { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; min-width: 0; }
.gal-win { margin-top: 16px; padding: 4px 8px 8px; }
.gal-stage { position: relative; height: 256px; overflow: hidden; background: var(--os-bg); }
/* The sheet's stage: its 75% holds the whole demo at 400 px, where touch rows are taller (nothing scrolls inside). */
.gal-stage.tall { height: 384px; }
.gal-field { height: 96px; box-shadow: inset 0 0 0 2px var(--os-line); }
/* The 64-px wordmark steps down to 40 px on a phone, as on the ROM page. */
@container os-screen (max-width: 480px) { .gal .os-title.d64 { font-size: 40px; line-height: 48px; } }
.gal-narrow { width: 100%; max-width: 240px; }
.gal-icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
.gal-icons figure { margin: 0; display: grid; justify-items: center; gap: 8px; padding: 8px 4px; box-shadow: inset 0 0 0 2px var(--os-line); font-size: 12px; line-height: 16px; color: var(--os-muted); }
.gal-icons .os-ico { color: var(--os-ink); }
.gal-brand { display: flex; flex-wrap: wrap; gap: 16px; align-items: end; }
`;

function card(title: string, ...children: Node[]): HTMLElement {
  return h('section', 'gal-card', h('h3', '', title), ...children);
}
const demo = (...children: Node[]) => h('div', 'gal-demo', ...children);
/** A window with a title tab on its edge and some content. */
const tabbed = (tab: HTMLElement, ...children: Node[]) => h('div', 'os-win gal-win', tab, ...children);

function themeColumn(theme: 'dark' | 'light'): HTMLElement {
  const col = h('div', 'os os-screen os-field gal-theme');
  col.dataset.theme = theme;
  col.setAttribute('aria-label', `${theme === 'dark' ? 'Dark' : 'Light'} theme`);
  const noop = () => {};

  col.append(pixelTitle(`OpenSinnoh UI · ${theme}`, 32, { tag: 'h2' }));

  col.append(
    card(
      'Brand: the mark (16-px cut, 32, 64 with its intro) or the wordmark (×2, ×4, ×5 with its intro), never side by side',
      h('div', 'gal-brand', logo(16, { label: 'OpenSinnoh mark, 16 px' }), logo(32, { label: 'OpenSinnoh mark, 32 px' }), logo(64, { label: 'OpenSinnoh mark, 64 px', animate: true })),
      h('div', 'gal-brand', wordmark(2, { label: 'OpenSinnoh' }), wordmark(4, { label: 'OpenSinnoh' })),
      wordmark(5, { label: 'OpenSinnoh', animate: true }),
    ),
  );

  col.append(card('Pixel titles (32, 40, 64)', demo(pixelTitle('Options'), pixelTitle('Data', 40)), pixelTitle('OpenSinnoh', 64)));

  const tones: [Tone, IconName, string][] = [['world', 'pin', 'Lakeside Road'], ['team', 'party', 'Party'], ['items', 'bag', 'Bag'], ['system', 'gear', 'Options'], ['danger', 'warn', 'Something went wrong']];
  col.append(
    card(
      'Title tabs (tone by meaning; the bar)',
      ...tones.map(([t, i, n]) => tabbed(titleTab(n, { tone: t, icon: i, ...(t === 'team' ? { end: [h('span', 'os-num', '5/6')] } : {}) }), h('p', '', 'The window this tab names.'))),
      titleTab('Import save', { tone: 'system', icon: 'import', bar: true }),
    ),
  );

  const busy = button('Saving', { icon: 'save' });
  busy.setAttribute('aria-busy', 'true');
  col.append(
    card(
      'Buttons',
      demo(
        button('Continue', { icon: 'check', variant: 'primary' }),
        button('Export', { icon: 'export' }),
        button('Delete', { icon: 'trash', variant: 'danger' }),
        button('Delete', { icon: 'trash', variant: 'solid-danger' }),
        button('Locked', { disabled: 'Open a save first.' }),
        busy,
        iconButton('star', 'Register'),
        backButton(noop),
      ),
    ),
  );

  const lab = h('span', '', 'Mute');
  lab.id = `gal-mute-${theme}`;
  col.append(
    card(
      'Toggle, pick, cycle, slider',
      demo(lab, toggle(false, { labelledBy: lab.id }), toggle(true, { label: 'Follower' }), toggle(false, { label: 'Battle style', disabled: true })),
      demo(pick(['Slow', 'Mid', 'Fast'], 2, { label: 'Text speed' }), pick(['Shift', 'Set'], 0, { label: 'Battle style', disabled: true })),
      demo(cycle(['Auto', '2x', '3x', '4x'], 0, { label: 'Zoom' }), cycle(['Type 1', 'Type 2'], 0, { label: 'Frame', disabled: true })),
      demo(slider(70, 100, { label: 'Volume', onSet: noop }), slider(30, 100, { label: 'Volume (locked)', disabled: true })),
    ),
  );

  const languages = ['English', 'Deutsch', 'Français', 'Español', 'Italiano', 'Nederlands', 'Polski'];
  const result = h('p', 'gal-select-result', 'Selected language: English');
  col.append(
    card(
      'Text input and select',
      textInput({ label: 'Save name', placeholder: 'Your name' }),
      textInput({ label: 'Save name', value: 'Pip!!', error: 'Use 1 to 16 letters or numbers.' }),
      textInput({ label: 'Save name', value: 'Locked', disabled: true, help: 'Open a save first.' }),
      select(languages, 0, { label: 'Language', onPick: (i) => { result.textContent = `Selected language: ${languages[i]}`; } }),
      result,
    ),
  );

  const sections = [{ id: 'game', label: 'Game', icon: 'pad' }, { id: 'device', label: 'Device', icon: 'screen' }, { id: 'data', label: 'Data', icon: 'disk' }, { id: 'privacy', label: 'Privacy', icon: 'shield' }] satisfies Parameters<typeof tabs>[0];
  // The cursor (or keyboard focus) on the selected tab, and on another one.
  const onSelected = tabs(sections, 'device', { label: 'Sections' });
  onSelected.querySelector('[data-tab="device"]')!.classList.add('is-cursor');
  const onOther = tabs(sections, 'device', { label: 'Sections' });
  onOther.querySelector('[data-tab="data"]')!.classList.add('is-cursor');
  col.append(card('Underline tabs (selected; the cursor on it; the cursor on another)', tabs(sections, 'device', { label: 'Sections' }), onSelected, onOther));

  const overflowTabs = tabs([...sections.slice(0, 2), { id: 'controls', label: 'Controls', icon: 'dpad' }, ...sections.slice(2)], 'game', {
    label: 'Narrow sections',
    onSelect: (id) => {
      for (const tab of overflowTabs.querySelectorAll<HTMLElement>('[role="tab"]')) {
        const on = tab.dataset.tab === id;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
      }
    },
  });
  col.append(card('Overflow tabs (swipe or use the edge arrows)', h('div', 'gal-narrow', overflowTabs)));

  const list = h('div', 'os-list');
  list.append(
    row('Text speed', 'How fast messages appear.', pick(['Slow', 'Mid', 'Fast'], 1, { label: 'Text speed' })),
    row('Follower', 'Your lead partner walks behind you.', toggle(true, { label: 'Follower' }), { cursor: true }),
    row('Windows', 'The frame of OpenSinnoh windows.', pick(['Distortion', 'Slim', 'Drop'], 0, { label: 'Windows' })),
    row('Battle style', 'Kept in your save: change it once a game is open.', pick(['Shift', 'Set'], 0, { label: 'Battle style', disabled: true }), { disabled: true }),
    row('Export save', 'Downloads your last save as a file.', button('Export', { icon: 'export' })),
  );
  col.append(card('List rows on a window (rest, the cursor row, disabled)', tabbed(titleTab('Options', { icon: 'gear' }), list)));

  const over = filePicker('Choose your ROM file', { hint: 'or drop it anywhere on this page', accept: '.nds' });
  over.classList.add('over');
  col.append(
    card(
      'Choices and file pickers (rest, cursor; drop, a file over it, quiet)',
      choices(
        [
          { label: 'Allow', description: 'Sends the error only, never names or saves.' },
          { label: "Don't allow", description: 'Nothing is sent.' },
        ],
        0,
        { label: 'Send error reports?' },
      ),
      filePicker('Choose your ROM file', { hint: 'or drop it anywhere on this page', accept: '.nds' }),
      over,
      demo(filePicker('Add HeartGold or SoulSilver', { variant: 'quiet', icon: 'plus', accept: '.nds' })),
    ),
  );

  const typed = h('p', 'os-win os-desc');
  typed.dataset.frame = 'slim';
  typeText(typed, 'Your lead partner walks behind you.', 2);
  col.append(card('Description box (typed at the Text speed) and footer (Back; a line and Back)', typed, footer(backButton(noop)), footer(backButton(noop), h('p', '', 'Saved on this device.'))));

  col.append(
    card(
      'Toast, banner, progress',
      demo(toast('Saved to your downloads.')),
      banner('That file is not a save.', 'Choose a .sav file exported from OpenSinnoh. Nothing was changed.', { action: button('Choose another', { icon: 'import' }), onDismiss: noop }),
      banner('We need to re-import your ROM.', 'The engine was updated. Your save is safe.', { tone: 'info' }),
      banner('That file could not be used.', ['It is not Pokémon Platinum (US). SHA-1 of your file: ', h('code', '', '0123456789abcdef0123456789abcdef01234567'), '.']),
      progress('Importing ROM', 44),
      progress('Checking the file', null),
      demo(h('span', 'os-cnt', '5/6'), h('span', 'os-bdg', 'NEW')),
    ),
  );

  const dlgStage = h('div', 'gal-stage', dialog('Delete the imported game?', 'Your saves are kept.', [button('No'), button('Delete', { icon: 'trash', variant: 'solid-danger' })]));
  const sheetStage = h('div', 'gal-stage tall', ...sheet('Import save', [h('p', '', 'Choose a save file exported from OpenSinnoh.'), progress('Checking the file', null)], [button('Cancel'), button('Import', { variant: 'primary', disabled: 'Choose a file first.' })], { icon: 'import', onClose: noop }));
  col.append(card('Dialog and sheet', dlgStage, sheetStage));

  col.append(
    card(
      'Frames',
      ...WINDOW_FRAMES.map((k) => {
        const w = h('div', 'os-win', h('span', 'os-px', k.charAt(0).toUpperCase() + k.slice(1)));
        w.dataset.frame = k;
        w.style.padding = '8px 12px';
        return w;
      }),
    ),
  );

  col.append(card('The field (behind our windows when no game is drawn)', h('div', 'os-field gal-field')));

  col.append(
    card(
      `Icons (${Object.keys(ICONS).length})`,
      h('div', 'gal-icons', ...(Object.keys(ICONS) as IconName[]).map((n) => h('figure', '', demo(icon(n, 16), icon(n, 32)), h('figcaption', '', n)))),
    ),
  );
  return col;
}

export async function mountGallery(): Promise<void> {
  document.title = 'OpenSinnoh UI gallery';
  for (const id of ['rom', 'game']) document.getElementById(id)?.setAttribute('hidden', '');
  document.body.classList.add('os-gallery');
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const main = h('main', 'gal', themeColumn('dark'), themeColumn('light'));
  document.body.append(main);
  await Promise.all(['500 20px "Pixelify Sans"', '700 64px "Pixelify Sans"', '16px Silkscreen', '14px Figtree', '600 14px Figtree', '12px "JetBrains Mono"'].map((f) => document.fonts.load(f)));
  await new Promise(requestAnimationFrame);
  snapPixels(main);
  addEventListener('resize', () => snapPixels(main));
  document.body.dataset.galleryReady = '';
}
