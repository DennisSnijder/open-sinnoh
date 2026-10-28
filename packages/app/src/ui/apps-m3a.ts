/**
 * The trainer card on its DS screens (decomp applications/trainer_case): the card (the top screen: the ROM card
 * with its rows, the portrait and the signature at their DS places) and the badge case (the touch screen: the
 * case's art, the badges at sBadgeCoordinates, its button closing the card), two boards at the UI unit side by
 * side or stacked, as compare mode's. Signing puts the prompt, DONE, the message and YES/NO on the case. As in
 * apps.ts nothing here keeps state: each view is redrawn when it changes and every control sends its tap id.
 * Without the art (the fixture) our own CSS stands in at the same places.
 */
import { decodeSignature, SIGNATURE_HEIGHT, SIGNATURE_WIDTH, type AppYesNo, type TrainerCardView } from '@opensinnoh/contracts';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import { at, atTiles, board, boardContext, dsPair } from './board.ts';
import { el } from './core.ts';
import type { Palette } from './pixel-font.ts';
import { bgPicture, sprite, tapButton } from './sprites.ts';
import { S } from '../strings/index.ts';

/** Front: ID, name, money, Pokédex, score (17 tiles wide), time, adventure started (28 tiles) at card_text.c's windows; `started` is the last. */
const FRONT_ROWS: [y: number, w: number][] = [[32, 136], [48, 136], [72, 136], [96, 136], [120, 136], [144, 224], [160, 224]];
/** Back: Hall of Fame debut, times linked, link battles, link trades. */
const BACK_ROWS: [y: number, w: number][] = [[16, 224], [56, 224], [72, 224], [88, 224]];
/** Decomp TrainerCase_DisplaySignature: the signature's tiles at tile (4, 14). */
const SIGNATURE_AT = { x: 32, y: 112 };
/** The signature's colour: index 1 of the card BG palette (trainer_card_normal colour 1, the same in every card level). */
const SIGNATURE_INK = '#737373';
/** sprites.c sBadgeCoordinates (decomp BADGE_ID_* order). */
const BADGES: [number, number][] = [[24, 40], [80, 40], [136, 40], [192, 40], [24, 72], [80, 72], [136, 72], [192, 72]];
/** The case's button (the badge_case art's bottom centre), which closes the card. */
const CASE_BUTTON = [112, 152, 32, 32] as const;
/** Signing on the case: DONE, YES/NO (the standard YES/NO window), the prompt or message box along the bottom. */
const SIGN = { done: [184, 120, 64, 20], yesNo: [22, 12, 9, 6], message: [0, 18, 32, 6] } as const;

function signatureCanvas(hex: string | null, u: number): HTMLCanvasElement {
  const dpr = devicePixelRatio || 1;
  const k = Math.round(u * dpr);
  const canvas = el('canvas', 'signature-art');
  canvas.width = SIGNATURE_WIDTH * k;
  canvas.height = SIGNATURE_HEIGHT * k;
  canvas.style.width = `${(SIGNATURE_WIDTH * k) / dpr}px`;
  canvas.style.height = `${(SIGNATURE_HEIGHT * k) / dpr}px`;
  canvas.setAttribute('aria-hidden', 'true');
  const g = canvas.getContext('2d')!;
  g.fillStyle = SIGNATURE_INK;
  const px = decodeSignature(hex);
  for (let y = 0; y < SIGNATURE_HEIGHT; y++) for (let x = 0; x < SIGNATURE_WIDTH; x++) if (px[y * SIGNATURE_WIDTH + x]) g.fillRect(x * k, y * k, k, k);
  return canvas;
}

/**
 * The live pen stroke. Every pen tap changes the view and redraws the card, so the stroke follows the
 * pointer on the document and maps it onto whichever `.signature-pad` is current.
 */
let stroke: { pointer: number; tap: (id: string) => void } | null = null;

function penTap(e: PointerEvent): string | null {
  const pad = document.querySelector<HTMLElement>('.signature-pad');
  if (!pad) return null;
  const r = pad.getBoundingClientRect();
  return `pen:${Math.floor(((e.clientX - r.left) / r.width) * SIGNATURE_WIDTH)},${Math.floor(((e.clientY - r.top) / r.height) * SIGNATURE_HEIGHT)}`;
}

function onPenMove(e: PointerEvent): void {
  if (e.pointerId !== stroke?.pointer) return;
  const t = penTap(e);
  if (t) stroke.tap(t);
}

function onPenUp(e: PointerEvent): void {
  if (e.pointerId !== stroke?.pointer) return;
  stroke.tap('pen-up');
  stroke = null;
  document.removeEventListener('pointermove', onPenMove);
  document.removeEventListener('pointerup', onPenUp);
  document.removeEventListener('pointercancel', onPenUp);
}

function signaturePad(d: DrawContext, hex: string | null): HTMLElement {
  const pad = el('div', 'signature-pad', signatureCanvas(hex, d.unit));
  pad.setAttribute('aria-label', S.aria.signature);
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (stroke) return;
    stroke = { pointer: e.pointerId, tap: d.tap };
    document.addEventListener('pointermove', onPenMove);
    document.addEventListener('pointerup', onPenUp);
    document.addEventListener('pointercancel', onPenUp);
    onPenMove(e);
  });
  return pad;
}

/** The card: the ROM card picture (by side and level), its rows, the portrait or the signature; a tap flips it. */
function cardBoard(d: DrawContext, v: TrainerCardView): HTMLElement {
  const cell = `${v.side}_${v.pokedex ? v.stars : 'nodex'}`;
  const art = d.art.sheet('trainer_case/card');
  const colors = art?.textColors?.[art.names!.indexOf(cell)];
  const ink: Palette = colors ? [colors.fg, colors.shadow] : 'ink';
  const root = board(`trainer-card ${v.side} stars-${v.stars}${art ? ' rom' : ''}`);
  const screen = bgPicture(d, 'trainer_case/top_screen', 0, 0, 'card-screen');
  if (screen) root.append(screen);
  if (art) root.append(at(el('span', 'card-art', d.art.cells('trainer_case/card', [cell], d.unit)!), 0, 0, 256, 192));
  if (!v.signing) root.append(at(tapButton(d, 'flip', 'card-flip', [], 'Flip the card'), 0, 0, 256, 192));
  const fields = v.side === 'front' ? [...v.fields, v.started] : v.back;
  const rows = v.side === 'front' ? FRONT_ROWS : BACK_ROWS;
  fields.forEach((f, i) => {
    const [y, w] = rows[i]!;
    root.append(at(el('div', 'card-row', d.text(f.label, ink), d.text(f.value, ink)), 16, y, w, 16));
  });
  if (v.side === 'front') {
    const p = d.art.sheet(`trainer_case/portrait_${v.gender}`)?.cells[0];
    const pic = p && d.art.cells(`trainer_case/portrait_${v.gender}`, [0], d.unit);
    if (pic) root.append(at(el('div', 'card-portrait-art', pic), -p.ox, -p.oy, p.w, p.h));
  } else {
    const sig = v.signing ? signaturePad(d, v.signature) : tapButton(d, 'sign', 'card-sign', [signatureCanvas(v.signature, d.unit)], 'Sign the card');
    root.append(at(sig, SIGNATURE_AT.x, SIGNATURE_AT.y, SIGNATURE_WIDTH, SIGNATURE_HEIGHT));
  }
  return root;
}

function yesNoWindow(d: DrawContext, yn: AppYesNo): HTMLElement {
  return framed(d, 'yes-no', stop(d, 'yes', [d.text(yn.yes)], 'menu-entry', yn.cursor === 0), stop(d, 'no', [d.text(yn.no)], 'menu-entry', yn.cursor === 1));
}

/** The badge case: its art, the badges got, its button (closes); while signing, the prompt, DONE and the confirmation. */
function caseBoard(d: DrawContext, v: TrainerCardView): HTMLElement {
  const root = board('badge-case');
  const bg = bgPicture(d, 'trainer_case/case', 0, 0, 'case-art');
  root.append(bg ?? at(el('span', 'case-css'), 0, 0, 256, 192));
  root.setAttribute('aria-label', `${v.badges.filter(Boolean).length} / 8`);
  v.badges.forEach((got, i) => {
    if (!got) return;
    const [x, y] = BADGES[i]!;
    const badge = sprite(d, 'trainer_case/badges', i, x, y, 'badge-slot got rom');
    root.append(badge ?? at(el('span', 'badge-slot got css'), x, y, 32, 32));
  });
  const s = v.signing;
  if (!s) {
    root.append(at(tapButton(d, 'done', 'case-button', [el('span', 'sr-only', v.done)], v.done), ...CASE_BUTTON));
    return root;
  }
  root.append(at(stop(d, 'done', [d.text(s.done)], 'card-done', true), ...SIGN.done));
  if (s.yesNo) root.append(atTiles(yesNoWindow(d, s.yesNo), ...SIGN.yesNo));
  root.append(atTiles(messageBox(d, s.message?.text ?? s.prompt, s.message?.waiting ?? false), ...SIGN.message));
  return root;
}

export function trainerCard(wide: DrawContext, v: TrainerCardView): HTMLElement {
  const d = boardContext(wide);
  const pair = dsPair(d, `card-sheet${v.signing ? ' signing' : ''}`, cardBoard(d, v), caseBoard(d, v));
  if (d.art.sheet('trainer_case/top_screen')) Object.assign(pair.dataset, { backdrop: 'trainer_case/top_screen', backdropBottom: 'trainer_case/case' });
  pair.setAttribute('aria-label', v.title);
  return pair;
}
