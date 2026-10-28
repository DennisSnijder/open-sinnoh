/**
 * The first-run questions and where their answers are kept, shared by the ROM page's setup (first-run.ts, while the
 * ROM imports) and the title's setup (setup.ts, for anyone who left one unanswered). No DOM and no engine: the ROM
 * page loads this before the game chunk. `lantern-nds:setup` lists the answered questions; each answer itself is a
 * device option (`lantern-nds:error-reports`, `lantern-nds:options`, `lantern-nds:visual-style`, the add-on import).
 */
import { S } from '../strings/index.ts';

/** `introSkip` is NEW GAME's question on a device that has finished Rowan's intro (intro-skip.ts), not the setup's. */
export type SetupQuestion = 'reports' | 'addon' | 'textSpeed' | 'visualStyle' | 'introSkip';
export const SETUP_KEY = 'lantern-nds:setup'; // pre-rename name, kept: players' stored data uses it
const QUESTIONS: readonly SetupQuestion[] = ['reports', 'addon', 'textSpeed', 'visualStyle'];

/** The questions answered on this device (device data: anything unreadable counts as none). */
export function readAnswered(): SetupQuestion[] {
  try {
    const v = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? QUESTIONS.filter((q) => v.includes(q)) : [];
  } catch {
    return [];
  }
}

/** Marks a question answered; returns the storage error, or null. */
export function storeAnswered(q: SetupQuestion): string | null {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify([...new Set([...readAnswered(), q])]));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export interface Ask {
  title: string;
  text: string;
  entries: { label: string; description?: string }[];
}

/**
 * Each question's words (strings/: the app's language); an answer's index is the stored choice (`reports` 0 allow;
 * `addon` 0 add, 1 skip; `textSpeed` the speed; `visualStyle` the style in VISUAL_STYLES' order).
 */
export const ASK: Readonly<Record<SetupQuestion, Ask>> = {
  get reports() {
    return S.ask.reports;
  },
  get addon() {
    return S.ask.addon;
  },
  get textSpeed() {
    return S.ask.textSpeed;
  },
  get visualStyle() {
    return S.ask.visualStyle;
  },
  get introSkip() {
    return S.ask.introSkip;
  },
};
