/**
 * The first-run questions and where their answers are kept, shared by the ROM page's setup (first-run.ts, while the
 * ROM imports) and the title's setup (setup.ts, for anyone who left one unanswered). No DOM and no engine: the ROM
 * page loads this before the game chunk. `lantern-nds:setup` lists the answered questions; each answer itself is a
 * device option (`lantern-nds:error-reports`, `lantern-nds:options`, the add-on import).
 */
/** `introSkip` is NEW GAME's question on a device that has finished Rowan's intro (intro-skip.ts), not the setup's. */
export type SetupQuestion = 'reports' | 'addon' | 'textSpeed' | 'introSkip';
export const SETUP_KEY = 'lantern-nds:setup'; // pre-rename name, kept: players' stored data uses it
const QUESTIONS: readonly SetupQuestion[] = ['reports', 'addon', 'textSpeed'];

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

/** Each question's words; an answer's index is the stored choice (`reports` 0 allow; `addon` 0 add, 1 skip; `textSpeed` the speed). */
export const ASK: Record<SetupQuestion, Ask> = {
  reports: {
    title: 'Send error reports?',
    text: 'If something breaks, OpenSinnoh can send a report so it gets fixed. Visits are counted anonymously, without cookies.',
    entries: [
      { label: 'Allow', description: 'Sends errors and a speed summary, never names or saves.' },
      { label: "Don't allow", description: 'Nothing is sent.' },
    ],
  },
  addon: {
    title: 'Add HeartGold or SoulSilver?',
    text: 'Optional. With your own HeartGold or SoulSilver (US) ROM, every Pokémon can follow you, not only the 24 that Platinum draws walking.',
    entries: [
      { label: 'Add now', description: 'Choose the .nds file. Nothing is uploaded.' },
      { label: 'Skip', description: 'You can add it later in Options.' },
    ],
  },
  textSpeed: { title: 'Text speed', text: 'How fast should messages appear?', entries: [{ label: 'Slow' }, { label: 'Mid' }, { label: 'Fast' }] },
  introSkip: {
    title: 'Skip the introduction?',
    text: "You have seen Professor Rowan's introduction on this device before.",
    entries: [
      { label: 'Skip', description: 'Choose boy or girl and the names, then play.' },
      { label: 'Watch', description: 'The whole introduction, as on the DS.' },
    ],
  },
};
