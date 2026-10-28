/**
 * OpenSinnoh UI components as plain DOM builders (the app's idiom): each returns real HTML controls with the
 * classes os.css styles. Builders take the current value and a callback; a screen that keeps its own state
 * (Options) draws again with the new value. Behaviour lives here only where a control needs it on its own
 * (the select's list, the slider's pointer, toasts).
 */
import { MARK_COLORS, WORDMARK, WORDMARK_LETTERS, markFor, type MarkDef } from './brand.ts';
import { icon, type IconName } from './icons.ts';
import { TOKENS } from './tokens.ts';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  for (const c of children) if (c !== null && c !== false) e.append(c);
  return e;
}

/** The few words the components write themselves; the app sets them for its language (`setUiWords`). */
export interface UiWords {
  on: string;
  off: string;
  previous(label: string): string;
  next(label: string): string;
  /** What the tab strip's scroll arrows move: `previous(tabs)`. */
  tabs: string;
  back: string;
  dismiss: string;
  close: string;
  /** A progress bar whose length is not known yet. */
  busy: string;
}

let words: UiWords = {
  on: 'On',
  off: 'Off',
  previous: (label) => `Previous ${label}`,
  next: (label) => `Next ${label}`,
  tabs: 'tabs',
  back: 'Back',
  dismiss: 'Dismiss',
  close: 'Close',
  busy: 'Busy',
};

/** Sets the components' own words (English until called). */
export function setUiWords(w: UiWords): void {
  words = w;
}

let ids = 0;
/** A unique id for aria references. */
export const uid = (prefix = 'os') => `${prefix}-${++ids}`;

export type Tone = 'world' | 'team' | 'items' | 'system' | 'danger';

export interface ButtonOptions {
  icon?: IconName;
  variant?: 'primary' | 'danger' | 'solid-danger';
  big?: boolean;
  /** Why it cannot be used: the button stays focusable (aria-disabled) and says so. */
  disabled?: string | null;
  label?: string;
  onClick?(e: MouseEvent): void;
}

/** A button on the Control skin. One primary per window; danger only for destructive actions, which confirm. */
export function button(text: string, o: ButtonOptions = {}): HTMLButtonElement {
  const b = h('button', ['os-btn', o.variant, o.big && 'big'].filter(Boolean).join(' '), o.icon ? icon(o.icon) : null, text);
  b.type = 'button';
  if (o.label) b.setAttribute('aria-label', o.label);
  if (o.disabled) {
    b.setAttribute('aria-disabled', 'true');
    const why = h('span', 'os-sr', o.disabled);
    why.id = uid('why');
    b.append(why);
    b.setAttribute('aria-describedby', why.id);
  }
  if (o.onClick) b.addEventListener('click', (e) => !o.disabled && o.onClick!(e));
  return b;
}

/** An icon-only button: its accessible name is repeated by a tooltip. */
export function iconButton(name: IconName, label: string, o: { tooltip?: string; onClick?(): void } = {}): HTMLElement {
  const b = h('button', 'os-btn icon', icon(name));
  b.type = 'button';
  b.setAttribute('aria-label', label);
  if (o.onClick) b.addEventListener('click', () => o.onClick!());
  const tip = h('span', 'os-tip', o.tooltip ?? label);
  tip.setAttribute('role', 'tooltip');
  return h('span', 'os-tipw', b, tip);
}

/** On/off that applies at once; the value is written next to it. */
export function toggle(on: boolean, o: { label?: string; labelledBy?: string; describedBy?: string; disabled?: boolean; words?: [string, string]; onChange?(on: boolean): void } = {}): HTMLButtonElement {
  const [yes, no] = o.words ?? [words.on, words.off];
  const b = h('button', 'os-tgl', h('span', 'tr', h('span', 'kn')), h('span', 'tv', on ? yes : no));
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  b.querySelector('.tv')!.setAttribute('aria-hidden', 'true');
  if (o.label) b.setAttribute('aria-label', o.label);
  if (o.labelledBy) b.setAttribute('aria-labelledby', o.labelledBy);
  if (o.describedBy) b.setAttribute('aria-describedby', o.describedBy);
  if (o.disabled) b.setAttribute('aria-disabled', 'true');
  if (o.onChange) b.addEventListener('click', () => !o.disabled && o.onChange!(!on));
  return b;
}

/**
 * Every value inline, the chosen one in the accent with a 1-dot underline (never colour alone). Toggle buttons
 * (`aria-pressed`): the screen that owns the cursor steps them with its own keys.
 */
export function pick(values: string[], index: number, o: { label: string; disabled?: boolean; onPick?(i: number): void }): HTMLElement {
  const g = h('div', 'os-pick');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', o.label);
  if (o.disabled) g.setAttribute('aria-disabled', 'true');
  values.forEach((v, i) => {
    const b = h('button', i === index ? 'on' : '', v);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i === index));
    if (o.disabled) b.setAttribute('aria-disabled', 'true');
    if (o.onPick) b.addEventListener('click', () => !o.disabled && o.onPick!(i));
    g.append(b);
  });
  return g;
}

/** ◀ value ▶ for 2 to 5 short named values (more, or long names: a select). The value is the focus target. */
export function cycle(values: string[], index: number, o: { label: string; disabled?: boolean; onStep?(d: 1 | -1): void }): HTMLElement {
  const c = h('span', 'os-cyc');
  if (o.disabled) c.setAttribute('aria-disabled', 'true');
  const arrow = (d: 1 | -1) => {
    const a = h('button', `arr ${d < 0 ? 'prev' : 'next'}`, icon(d < 0 ? 'left' : 'right'));
    a.type = 'button';
    a.setAttribute('aria-label', (d < 0 ? words.previous : words.next)(o.label));
    if (o.onStep) a.addEventListener('click', () => !o.disabled && o.onStep!(d));
    return a;
  };
  const v = h('button', 'cv', values[index] ?? '');
  v.type = 'button';
  v.setAttribute('aria-label', `${o.label}: ${values[index] ?? ''}`);
  if (o.disabled) v.setAttribute('aria-disabled', 'true');
  if (o.onStep) v.addEventListener('click', () => !o.disabled && o.onStep!(1));
  c.append(arrow(-1), v, arrow(1));
  return c;
}

/** A level of 10 steps or fewer, drawn as cells, the number always shown. Arrow keys and pointer set it. */
export function slider(value: number, max: number, o: { label: string; min?: number; disabled?: boolean; text?: (v: number) => string; keyboard?: boolean; onSet?(v: number): void }): HTMLElement {
  const min = o.min ?? 0;
  const cells = 10;
  const per = (max - min) / cells;
  const s = h('span', 'os-sld');
  s.tabIndex = 0;
  s.setAttribute('role', 'slider');
  s.setAttribute('aria-label', o.label);
  s.setAttribute('aria-valuemin', String(min));
  s.setAttribute('aria-valuemax', String(max));
  s.setAttribute('aria-valuenow', String(value));
  const text = o.text ? o.text(value) : `${value}`;
  s.setAttribute('aria-valuetext', text);
  if (o.disabled) s.setAttribute('aria-disabled', 'true');
  const strip = h('span', 'cells');
  for (let i = 0; i < cells; i++) {
    const c = h('span', `cell${value >= min + per * (i + 1) - 1e-9 ? ' on' : ''}`);
    c.dataset.value = String(min + per * (i + 1));
    strip.append(c);
  }
  const num = h('span', 'num', text);
  num.setAttribute('aria-hidden', 'true');
  s.append(strip, num);
  if (o.onSet && !o.disabled) {
    s.addEventListener('click', (e) => {
      const r = strip.getBoundingClientRect();
      const i = Math.min(cells, Math.max(0, Math.ceil(((e.clientX - r.left) / r.width) * cells)));
      o.onSet!(min + per * i);
    });
    // A screen that reads keys through the game's input (Options) steps the slider itself.
    if (o.keyboard !== false) s.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      o.onSet!(Math.min(max, Math.max(min, value + d * per)));
    });
  }
  return s;
}

/** Label above, help or error below. Validate on blur and on submit, never per keystroke before the first blur. */
export function textInput(o: { label: string; value?: string; placeholder?: string; help?: string; error?: string; disabled?: boolean }): HTMLElement {
  const id = uid('in');
  const label = h('label', '', o.label);
  label.htmlFor = id;
  const input = h('input', 'os-inp');
  input.id = id;
  input.value = o.value ?? '';
  if (o.placeholder) input.placeholder = o.placeholder;
  if (o.disabled) input.disabled = true;
  const field = h('div', 'os-input', label, input);
  const note = o.error ? h('span', 'os-err', icon('warn'), o.error) : o.help ? h('span', 'os-help', o.help) : null;
  if (note) {
    note.id = uid('note');
    input.setAttribute('aria-describedby', note.id);
    field.append(note);
  }
  if (o.error) input.setAttribute('aria-invalid', 'true');
  return field;
}

/** A field that opens up to 6 rows: a popover on desktop, a modal bottom sheet below 480 px. */
export function select(options: string[], index: number, o: { label: string; onPick?(i: number): void }): HTMLElement {
  const lid = uid('sl');
  const vid = uid('sv');
  const label = h('span', 'os-input', o.label);
  label.id = lid;
  label.style.fontWeight = '600';
  const value = h('span', '', options[index] ?? '');
  value.id = vid;
  const b = h('button', 'os-sel', value, icon('down'));
  b.type = 'button';
  b.setAttribute('aria-haspopup', 'listbox');
  b.setAttribute('aria-expanded', 'false');
  b.setAttribute('aria-labelledby', `${lid} ${vid}`);
  const list = h('ul', 'os-lbx');
  list.id = uid('list');
  list.tabIndex = 0;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', o.label);
  list.hidden = true;
  b.setAttribute('aria-controls', list.id);
  const items = options.map((n, i) => {
    const li = h('li', '', icon('check'), n);
    li.id = uid('option');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === index));
    li.addEventListener('click', () => pick(i));
    list.append(li);
    return li;
  });
  const wrap = h('div', 'os-sel-wrap', label, b, list);
  let modal: HTMLDialogElement | null = null;
  let cur = index;
  let chosen = index;
  const paint = () => {
    items.forEach((li, i) => li.classList.toggle('cur', i === cur));
    list.setAttribute('aria-activedescendant', items[cur]!.id);
    // Scroll the list only; scrollIntoView would also move the screen behind the sheet.
    const item = items[cur]!;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  };
  const close = (restore = true) => {
    list.hidden = true;
    b.setAttribute('aria-expanded', 'false');
    if (modal) {
      wrap.append(list);
      modal.close();
      modal.remove();
      modal = null;
    }
    if (restore) b.focus({ preventScroll: true });
  };
  const open = () => {
    list.hidden = false;
    b.setAttribute('aria-expanded', 'true');
    if ((wrap.closest('.os-screen')?.clientWidth ?? innerWidth) <= 480) {
      modal = h('dialog', 'os-select-modal');
      const [scrim, panel] = sheet(o.label, [list], [], { onClose: () => close() });
      // The native dialog owns modality and focus; the sheet supplies the system's presentation.
      panel!.removeAttribute('role');
      panel!.removeAttribute('aria-modal');
      modal.setAttribute('aria-labelledby', panel!.getAttribute('aria-labelledby')!);
      scrim!.addEventListener('click', () => close());
      modal.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
      const first = panel!.querySelector<HTMLButtonElement>('button')!;
      modal.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        if (!e.shiftKey && document.activeElement === list) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          list.focus();
        }
      });
      modal.append(scrim!, panel!);
      wrap.append(modal);
      modal.showModal();
    }
    cur = chosen;
    list.focus({ preventScroll: true });
    paint();
  };
  const pick = (i: number) => {
    chosen = i;
    items.forEach((li, j) => li.setAttribute('aria-selected', String(i === j)));
    value.textContent = options[i]!;
    close();
    o.onPick?.(i);
  };
  b.addEventListener('click', () => list.hidden ? open() : close());
  b.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') cur = Math.min(options.length - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)));
    else if (e.key === 'Home') cur = 0;
    else if (e.key === 'End') cur = options.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') pick(cur);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') {
      if (!modal) close(false);
      return;
    } else if (e.key.length === 1) {
      const i = options.findIndex((n) => n.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) cur = i;
    } else return;
    e.preventDefault();
    paint();
  });
  wrap.addEventListener('focusout', (e) => {
    if (!modal && !wrap.contains(e.relatedTarget as Node | null)) close(false);
  });
  return wrap;
}

// One observer for live strips; screens replace their DOM on redraw, so release detached strips.
const tabLayouts = new Map<HTMLElement, () => void>();
let tabResize: ResizeObserver | undefined;
let tabRemoval: MutationObserver | undefined;
function observeTabs(root: HTMLElement, layout: () => void): void {
  tabResize ??= new ResizeObserver((entries) => {
    for (const { target } of entries) tabLayouts.get(target as HTMLElement)?.();
  });
  tabRemoval ??= new MutationObserver(() => {
    for (const strip of tabLayouts.keys()) if (!strip.isConnected) {
      tabResize!.unobserve(strip);
      tabLayouts.delete(strip);
    }
    if (!tabLayouts.size) tabRemoval!.disconnect();
  });
  tabLayouts.set(root, layout);
  tabResize.observe(root);
  tabRemoval.observe(document.body, { childList: true, subtree: true });
}

/** Underline tabs, with edge fades and scroll arrows only while content remains offscreen. */
export function tabs(items: { id: string; label: string; icon?: IconName }[], selected: string, o: { label: string; keyboard?: boolean; onSelect?(id: string): void }): HTMLElement {
  const list = h('div', 'os-tabs');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', o.label);
  list.id = uid('tabs');
  const arrow = (dir: -1 | 1) => {
    const b = h('button', `os-tab-scroll ${dir < 0 ? 'prev' : 'next'}`, icon(dir < 0 ? 'left' : 'right'));
    b.type = 'button';
    b.setAttribute('aria-label', (dir < 0 ? words.previous : words.next)(words.tabs));
    b.title = b.getAttribute('aria-label')!;
    b.setAttribute('aria-controls', list.id);
    // Scrolling is a pointer convenience; keyboard and pad focus reveal the chosen tab directly.
    b.tabIndex = -1;
    b.addEventListener('click', () => list.scrollBy({ left: dir * Math.max(44, list.clientWidth - 44) }));
    return b;
  };
  const prev = arrow(-1);
  const next = arrow(1);
  const root = h('div', 'os-tabs-wrap', prev, list, next);
  const edges = () => {
    const first = list.firstElementChild as HTMLElement;
    const last = list.lastElementChild as HTMLElement;
    root.classList.toggle('more-before', first.offsetLeft < list.scrollLeft - 1);
    root.classList.toggle('more-after', last.offsetLeft + last.offsetWidth > list.scrollLeft + list.clientWidth + 1);
  };
  const reveal = (tab: HTMLElement) => {
    // Reveal only along this strip, without scrolling the page.
    const r = tab.getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    if (r.left < viewport.left) list.scrollLeft -= Math.ceil(viewport.left - r.left);
    else if (r.right > viewport.right) list.scrollLeft += Math.ceil(r.right - viewport.right);
  };
  for (const t of items) {
    const on = t.id === selected;
    const b = h('button', '', t.icon ? icon(t.icon) : null, t.label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    b.dataset.tab = t.id;
    if (o.onSelect) b.addEventListener('click', () => o.onSelect!(t.id));
    b.addEventListener('focus', () => reveal(b));
    list.append(b);
  }
  if (o.keyboard !== false) list.addEventListener('keydown', (e) => {
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : e.key === 'ArrowRight' ? (at + 1) % buttons.length : e.key === 'ArrowLeft' ? (at + buttons.length - 1) % buttons.length : -1;
    if (to < 0) return;
    e.preventDefault();
    buttons[to]!.focus({ preventScroll: true });
    buttons[to]!.click();
  });
  list.addEventListener('scroll', edges);
  requestAnimationFrame(() => {
    if (!root.isConnected) return;
    const layout = () => {
      root.classList.remove('has-overflow');
      root.classList.toggle('has-overflow', list.scrollWidth > list.clientWidth + 1);
      reveal((list.contains(document.activeElement) ? document.activeElement : list.querySelector('[aria-selected="true"]')) as HTMLElement);
      edges();
    };
    observeTabs(root, layout);
    void document.fonts.ready.then(() => { if (root.isConnected) layout(); });
    layout();
  });
  return root;
}

/** The ▶ that marks the cursor row (shown by the row's `is-cursor` or focus). */
const cursorMark = () => {
  const c = h('span', 'cur', icon('cursor'));
  c.setAttribute('aria-hidden', 'true');
  return c;
};

/** A list row: the ▶, label, description and one control; the cursor row has the sel fill, a 1-dot line and the ▶. */
export function row(label: string, description: string, control: Node, o: { disabled?: boolean; cursor?: boolean } = {}): HTMLElement {
  const lab = h('div', 'lab', label);
  lab.id = uid('lab');
  const desc = h('div', 'desc', description);
  desc.id = uid('desc');
  const r = h('div', `os-row${o.cursor ? ' is-cursor' : ''}`, cursorMark(), h('div', '', lab, desc), h('div', 'ctl', control));
  if (o.disabled) r.setAttribute('aria-disabled', 'true');
  return r;
}

/**
 * A short list of answers to one question, all visible, each a button with a label and an optional line under
 * it (the setup's questions). The cursor (`is-cursor`, `aria-current`) is the screen's; a click picks.
 */
export function choices(items: { label: string; description?: string }[], cursor: number, o: { label: string; onPick?(i: number): void }): HTMLElement {
  const g = h('div', 'os-choices');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', o.label);
  items.forEach((it, i) => {
    const b = h('button', `os-choice${i === cursor ? ' is-cursor' : ''}`, cursorMark(), h('span', 'cl', it.label), it.description ? h('span', 'cd', it.description) : null);
    b.type = 'button';
    if (i === cursor) b.setAttribute('aria-current', 'true');
    if (o.onPick) b.addEventListener('click', () => o.onPick!(i));
    g.append(b);
  });
  return g;
}

/**
 * A file picker: a label around a visually hidden file input, so the whole box opens the system's file dialog
 * and the input keeps the label as its name. `drop` is the big target (a page may light it with `.over` while
 * a file is dragged over it); `quiet` a secondary pick on the Control skin.
 */
export function filePicker(label: string, o: { hint?: string; accept?: string; id?: string; describedBy?: string; variant?: 'drop' | 'quiet'; icon?: IconName; onFile?(f: File): void } = {}): HTMLLabelElement {
  const input = h('input');
  input.type = 'file';
  if (o.accept) input.accept = o.accept;
  if (o.id) input.id = o.id;
  if (o.describedBy) input.setAttribute('aria-describedby', o.describedBy);
  const drop = (o.variant ?? 'drop') === 'drop';
  const box = h('label', `os-file ${drop ? 'drop' : 'quiet'}`, input, icon(o.icon ?? 'import', drop ? 32 : 16), h('span', 'fl', label), drop && o.hint ? h('span', 'fh', o.hint) : null);
  if (o.onFile)
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) o.onFile!(f);
    });
  return box;
}

/**
 * A title in live pixel text (selectable, read aloud, scaled with zoom): 32 px for screen titles (Pixelify 500),
 * 40 and 64 px for the wordmark and headlines (700). On a window face it carries the 1-dot shadow.
 */
export function pixelTitle(text: string, size: 32 | 40 | 64 = 32, o: { tag?: 'h1' | 'h2' | 'h3' | 'span' } = {}): HTMLElement {
  return h(o.tag ?? 'span', `os-title${size === 32 ? '' : ` d${size}`}`, text);
}

/**
 * A window's title tab: its name on the top edge, filled with the screen's tone (what the window is about), an
 * on-tone icon and an optional end (a step count). Put it first in the window. `bar`: across the top instead
 * (a sheet); every tab becomes the bar below a 480-px screen.
 */
export function titleTab(title: string, o: { tone?: Tone; icon?: IconName; id?: string; tag?: 'h2' | 'h3'; end?: Node[]; bar?: boolean } = {}): HTMLElement {
  const t = h(o.tag ?? 'h2', 't', title);
  if (o.id) t.id = o.id;
  const tab = h('header', `os-tab os-tone-${o.tone ?? 'system'}${o.bar ? ' bar' : ''}`, o.icon ? icon(o.icon) : null, t);
  if (o.end?.length) tab.append(h('span', 'end', ...o.end));
  return tab;
}

/** The big Back. */
export function backButton(onClick?: () => void, text = words.back): HTMLButtonElement {
  return button(text, { icon: 'back', big: true, ...(onClick ? { onClick } : {}) });
}

/** A full screen's footer: Back on the right and, on its left, the screen's line (a result) or nothing. */
export function footer(back: HTMLElement, line?: HTMLElement): HTMLElement {
  return h('footer', 'os-foot', line ?? h('span', 'fill'), back);
}

const typing = new WeakMap<HTMLElement, number>();

/**
 * Types `text` into `el` at the game's Text speed (0 slow, 1 mid, 2 fast: 3, 2 or 1 frames a character),
 * at once with reduced motion. The typing is decoration: the whole text is there for assistive tech from the
 * start. A new call replaces a running one.
 */
export function typeText(el: HTMLElement, text: string, speed: number): void {
  clearInterval(typing.get(el));
  const shown = h('span', '');
  shown.setAttribute('aria-hidden', 'true');
  el.replaceChildren(h('span', 'os-sr', text), shown);
  const t = TOKENS.motion.typing as Record<string, number>;
  const frames = [t.slow, t.mid, t.fast][speed];
  if (frames === undefined) throw new Error(`ui: no text speed ${speed}`);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    shown.textContent = text;
    return;
  }
  let n = 0;
  const timer = window.setInterval(() => {
    shown.textContent = text.slice(0, ++n);
    if (n >= text.length) clearInterval(timer);
  }, frames * (TOKENS.motion.frame as number));
  typing.set(el, timer);
}

/** A toast: success and neutral results only, never errors. */
export function toast(message: string): HTMLElement {
  const t = h('div', 'os-win os-toast in', icon('check'), h('span', '', message));
  t.dataset.frame = 'slim';
  return t;
}

/** Shows a toast in a slot (role=status) for 80 frames; a new one replaces the old. */
export function showToast(slot: HTMLElement, message: string): void {
  const t = toast(message);
  slot.replaceChildren(t);
  const frame = 1000 / 30;
  setTimeout(() => t.classList.replace('in', 'out'), (6 + 80) * frame);
  setTimeout(() => t.remove(), (6 + 80 + 4) * frame);
}

export function toastSlot(): HTMLElement {
  const s = h('div', 'os-toast-slot');
  s.setAttribute('role', 'status');
  s.setAttribute('aria-live', 'polite');
  return s;
}

/**
 * An inline error at the top of a window body: what happened, what is safe, one action. `text` may carry
 * nodes (a file's hash in code). It can be dismissed only when `onDismiss` is given. `tone: 'info'` is the calm
 * notice (why the screen is here and what is safe, like a re-import after an update): the teal ring, never danger.
 */
export function banner(title: string, text: string | (Node | string)[], o: { action?: HTMLElement; onDismiss?(): void; tone?: 'error' | 'info' } = {}): HTMLElement {
  const info = o.tone === 'info';
  const b = h('div', `os-banner${info ? ' info' : ''}`, icon(info ? 'info' : 'warn'), h('div', 'bt', h('b', '', title), ' ', ...(typeof text === 'string' ? [text] : text)));
  // An error interrupts; an info banner (a calm notice: why the screen is here, what is safe) is read in turn.
  b.setAttribute('role', info ? 'status' : 'alert');
  if (o.onDismiss) {
    const dismiss = h('button', 'os-btn icon', icon('close'));
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', words.dismiss);
    dismiss.addEventListener('click', () => o.onDismiss!());
    b.append(dismiss);
  }
  if (o.action) b.append(h('div', 'acts', o.action));
  return b;
}

/** A confirm dialog over a scrim (an alertdialog: it opens on the safe answer). */
export function dialog(title: string, text: string, actions: HTMLElement[]): HTMLElement {
  const tid = uid('dt');
  const did = uid('dd');
  const t = h('h3', '', title);
  t.id = tid;
  const p = h('p', '', text);
  p.id = did;
  const win = h('div', 'os-win os-dlg', t, text ? p : null, h('div', 'acts', ...actions));
  win.setAttribute('role', 'alertdialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-labelledby', tid);
  if (text) win.setAttribute('aria-describedby', did);
  return h('div', 'os-layer', win);
}

/** A bottom sheet (secondary flows on a phone): the rim and halo on top, the title bar, content scrolls, actions pinned. */
export function sheet(title: string, body: Node[], actions: HTMLElement[], o: { icon?: IconName; onClose?(): void } = {}): HTMLElement[] {
  const id = uid('sh');
  const close = h('button', 'os-btn icon', icon('close'));
  close.type = 'button';
  close.setAttribute('aria-label', words.close);
  if (o.onClose) close.addEventListener('click', () => o.onClose!());
  const s = h('section', 'os-sheet', titleTab(title, { tone: 'system', ...(o.icon ? { icon: o.icon } : {}), id, end: [close], bar: true }), h('div', 'sb', ...body), h('div', 'sa', ...actions));
  s.setAttribute('role', 'dialog');
  s.setAttribute('aria-modal', 'true');
  s.setAttribute('aria-labelledby', id);
  return [h('div', 'os-sheet-scrim'), s];
}

/** Progress in cells with a percentage, or a stepping block when the length is unknown (`value` null). Always in words. */
export function progress(label: string, value: number | null): HTMLElement {
  const cells = h('div', 'cells', ...Array.from({ length: 16 }, (_, i) => h('i', value !== null && i < Math.round((value / 100) * 16) ? 'on' : '')));
  const p = h('div', `os-prog${value === null ? ' busy' : ''}`, h('div', 'lt', h('b', '', label), h('span', '', value === null ? words.busy : `${Math.round(value)}%`)), cells);
  p.setAttribute('role', 'progressbar');
  p.setAttribute('aria-label', label);
  if (value === null) p.setAttribute('aria-busy', 'true');
  else {
    p.setAttribute('aria-valuemin', '0');
    p.setAttribute('aria-valuemax', '100');
    p.setAttribute('aria-valuenow', String(Math.round(value)));
  }
  return p;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
type Rect = [number, number, number, number];
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const rects = (g: SVGElement, list: Rect[]) => {
  for (const [x, y, width, height] of list) g.append(svgEl('rect', { x, y, width, height }));
};

/** A brand SVG of `w` × `h` art pixels at `scale` CSS px each; named when `label` is given, else decorative. */
function brandSvg(cls: string, w: number, h: number, scale: number, label: string | undefined): SVGSVGElement {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`ui: brand art is drawn at whole scales, not ${scale}`);
  const svg = svgEl('svg', { class: `os-brand ${cls}`, width: w * scale, height: h * scale, viewBox: `0 0 ${w} ${h}`, 'shape-rendering': 'crispEdges' });
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** The mark's pixels into `parent`; with `animate`, each group waits for its intro frame and the caret blinks (os.css). */
function drawMark(parent: SVGElement, m: MarkDef, animate: boolean): void {
  for (const [col, f, list] of m.px) {
    const part = svgEl('g');
    if (col === 'h') part.style.fill = 'var(--os-halo)';
    else part.setAttribute('fill', MARK_COLORS[col]);
    if (animate && f > 0) {
      part.classList.add('f');
      part.style.setProperty('--f', String(f));
    }
    rects(part, list);
    parent.append(part);
  }
  if (animate && m.caret) {
    const [x, y, width, height] = m.caret;
    parent.append(svgEl('rect', { class: 'caret', x, y, width, height, fill: MARK_COLORS.a1 }));
  }
}

/** The wordmark's pixels into `parent`, in the theme's ink and gold; with `animate`, each letter waits for its intro frame (os.css). */
function drawWordmark(parent: SVGElement, animate: boolean): void {
  for (const [x0, x1, f] of WORDMARK_LETTERS) {
    const inLetter = (list: Rect[]) => list.filter(([x]) => x >= x0 && x < x1);
    const ink = inLetter(WORDMARK.ink);
    const gold = inLetter(WORDMARK.accent);
    if (!ink.length === !gold.length) throw new Error(`ui: wordmark letter at ${x0} is not all ink or all gold`);
    const letter = svgEl('g');
    if (animate) {
      letter.classList.add('f');
      letter.style.setProperty('--f', String(f));
    }
    const layer = (fill: string, d: number, list: Rect[]) => {
      const l = svgEl('g', d ? { transform: `translate(${d} ${d})` } : {});
      l.style.fill = fill;
      rects(l, list);
      letter.append(l);
    };
    layer('var(--os-ink-shadow)', 1, [...ink, ...gold]);
    if (gold.length) layer('var(--os-accent)', 0, gold);
    else layer('var(--os-ink)', 0, ink);
    parent.append(letter);
  }
}

export interface BrandOptions {
  /** The accessible name; without it the art is decorative. */
  label?: string;
  /** The stepped 30 Hz intro (the 32-px mark, then its quiet idle; the wordmark); reduced motion shows the static frame. */
  animate?: boolean;
}

/**
 * The OpenSinnoh mark at `size` CSS px: the 16-px Window cut at 16, the 32-px Title-tab window at 32, 64, 96 …
 * Its halo follows the background (`--os-halo`). Only on OpenSinnoh's own screens and the website, never in a
 * screen the game draws.
 */
export function logo(size: number, o: BrandOptions = {}): SVGSVGElement {
  const m = markFor(size);
  const svg = brandSvg(`os-logo${o.animate ? ' anim' : ''}`, m.n, m.n, size / m.n, o.label);
  drawMark(svg, m, !!o.animate);
  return svg;
}

/**
 * The wordmark at a whole `scale` (58 × 11 px at ×1): the O and the S in gold, the ink and its shadow from the theme.
 * With `animate`, its stepped intro: the gold O and S land, then the other letters type in left to right
 * (`WORDMARK_LETTERS`); reduced motion shows the static frame. Where the whole name shows, the wordmark stands
 * alone: the mark and the wordmark are never side by side. Keep a clear space of 2 glyph pixels around it.
 */
export function wordmark(scale: number, o: BrandOptions = {}): SVGSVGElement {
  const svg = brandSvg(`os-wordmark${o.animate ? ' anim' : ''}`, WORDMARK.w, WORDMARK.h, scale, o.label);
  drawWordmark(svg, !!o.animate);
  return svg;
}
