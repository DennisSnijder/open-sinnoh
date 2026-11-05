/**
 * The trainer card's signature without a stylus. The model takes pen taps only (the DS signs by touch), so buttons
 * become those taps here, as the Pokétch's touch mode does: Y on the card's back starts signing; then the d-pad moves
 * the pen, A held draws, Y clears, X or Start is DONE and B cancels (the model's own). Replays record the taps.
 */
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH, type InputFrame, type TrainerCardView } from '@opensinnoh/contracts';
import { el } from './core.ts';

/** Signature pixels a tick (a fifth of the box's width a second, at 30 Hz). */
const STEP = 2;

export class SignaturePen {
  private x = SIGNATURE_WIDTH >> 1;
  private y = SIGNATURE_HEIGHT >> 1;
  private down = false;
  /** Buttons have moved the pen: its mark shows (a pointer needs none). */
  private shown = false;

  constructor(private readonly tap: (id: string) => void) {}

  private up(): void {
    if (this.down) this.tap('pen-up');
    this.down = false;
  }

  /** One tick while the trainer card is open. */
  input(frame: InputFrame, view: TrainerCardView): void {
    const s = view.signing;
    if (!s) {
      this.up();
      this.shown = false;
      if (view.side === 'back' && frame.pressed.includes('y')) this.tap('sign');
      return;
    }
    if (s.message || s.yesNo) return this.up();
    if (frame.pressed.includes('x') || frame.pressed.includes('start')) {
      this.up();
      this.tap('done');
      return;
    }
    if (frame.pressed.includes('y')) this.tap('clear');
    const held = (b: 'up' | 'down' | 'left' | 'right' | 'a') => frame.held.includes(b);
    const dx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    const dy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
    if (dx || dy || held('a')) this.shown = true;
    this.x = Math.min(SIGNATURE_WIDTH - 1, Math.max(0, this.x + dx * STEP));
    this.y = Math.min(SIGNATURE_HEIGHT - 1, Math.max(0, this.y + dy * STEP));
    if (!held('a')) return this.up();
    if (dx || dy || !this.down) this.tap(`pen:${this.x},${this.y}`);
    this.down = true;
  }

  /** Per rendered frame: the pen's mark on the pad (the pad is redrawn with each stroke). */
  frame(): void {
    const pad = document.querySelector<HTMLElement>('.signature-pad');
    if (!pad || !this.shown) return;
    let mark = pad.querySelector<HTMLElement>('.signature-pen');
    if (!mark) pad.append((mark = el('span', 'signature-pen')));
    mark.style.left = `${(this.x / SIGNATURE_WIDTH) * 100}%`;
    mark.style.top = `${(this.y / SIGNATURE_HEIGHT) * 100}%`;
  }
}
