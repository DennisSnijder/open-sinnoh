/**
 * The Easy Chat word picker (decomp applications/easy_chat, opened by ScrCmd_ChooseCustomMessageWord(s)) in group
 * mode: the blanks under "Please enter a phrase or word.", the group list, then the group's words in two columns. A
 * word fills the blank and the cursor moves on; once every blank is filled, "Is this your answer?". B on the blanks
 * asks "Quit without doing anything?". Our groups are the word banks themselves (decomp easy_chat_word_list.c sorts
 * its own lists; POKéMON lists the seen species, as the DS does); POKéMON 2, MOVE 2, ABC mode and the locked words
 * are not offered.
 */
import type { Button, Id } from '@opensinnoh/core';
import type { EasyChatView, GameState, Registries } from '@opensinnoh/contracts';
import { easyChatWord, gameLanguage, wordOrder, WORD_NONE, type EasyChatBank } from '@opensinnoh/services';
import { Dialog } from './dialog.ts';
import { moveCursor, tapIndex, type Screen, type Step } from './stack.ts';
import { MenuText } from './strings.ts';

type Input = { button: Button } | { tap: string };

/** The words' rows shown at once (two columns). */
export const EASY_CHAT_ROWS = 6;
const COLUMNS = 2;
const TEXT = { prompt: 'pl_msg_00000437_00007', confirm: 'pl_msg_00000437_00006', quit: 'pl_msg_00000437_00008', yes: 'pl_msg_00000437_00009', no: 'pl_msg_00000437_00010' } as const;
/** Our groups: the EasyChatGroups label and its banks. */
const GROUPS: readonly { label: string; banks: readonly EasyChatBank[] }[] = [
  { label: 'EasyChatGroups_Text_Pokemon', banks: ['TEXT_BANK_SPECIES_NAME'] },
  { label: 'EasyChatGroups_Text_Move', banks: ['TEXT_BANK_MOVE_NAMES_UPPERCASE'] },
  { label: 'EasyChatGroups_Text_Status', banks: ['TEXT_BANK_POKEMON_TYPE_NAMES', 'TEXT_BANK_ABILITY_NAMES_UPPERCASE'] },
  { label: 'EasyChatGroups_Text_Trainer', banks: ['TEXT_BANK_TRAINER_WORDS'] },
  { label: 'EasyChatGroups_Text_People', banks: ['TEXT_BANK_PEOPLE_WORDS'] },
  { label: 'EasyChatGroups_Text_Greetings', banks: ['TEXT_BANK_GREETINGS'] },
  { label: 'EasyChatGroups_Text_Lifestyle', banks: ['TEXT_BANK_LIFESTYLE_WORDS'] },
  { label: 'EasyChatGroups_Text_Feelings', banks: ['TEXT_BANK_FEELINGS'] },
  { label: 'EasyChatGroups_Text_ToughWords', banks: ['TEXT_BANK_TOUGH_WORDS'] },
  { label: 'EasyChatGroups_Text_Union', banks: ['TEXT_BANK_UNION_WORDS'] },
];
const CANCEL = 'EasyChatGroups_Text_Cancel';
export const EASY_CHAT_MESSAGES = [...Object.values(TEXT), ...GROUPS.map((g) => g.label), CANCEL];

/**
 * A group's words: each bank's named entries, the duplicates the decomp keeps (sDummy*) once, in the game language's
 * order (services `wordOrder`; the German one is the German ROM's own word lists' order).
 */
function groupWords(registries: Registries, text: MenuText, state: GameState, banks: readonly EasyChatBank[]): { word: number; text: string }[] {
  const seen = new Set(state.pokedex.seen);
  const speciesAt = new Map([...registries.species.values()].map((x) => [x.sourceIndex, x.id]));
  const words = new Map<string, number>();
  const ns = text.ns;
  for (const bank of banks) {
    const messages = registries.textBanks.get(`${ns}:${bank}` as Id)!.messages;
    messages.forEach((id, entry) => {
      if (bank === 'TEXT_BANK_SPECIES_NAME') {
        const species = speciesAt.get(entry);
        if (!species || !seen.has(species)) return;
      }
      const s = text.text(id);
      // Entry 0 of the name banks ("-----") and the empty ones are not words.
      if (!/[\p{L}\p{N}]/u.test(s) || words.has(s)) return;
      words.set(s, easyChatWord(registries, bank, entry));
    });
  }
  const order = wordOrder(gameLanguage(registries));
  return [...words].map(([t, word]) => ({ word, text: t })).sort((a, b) => order(a.text, b.text));
}

export function easyChatScreen(registries: Registries, state: GameState, count: 1 | 2, done: (words: number[] | null) => Step): Screen {
  const t = new MenuText(registries, EASY_CHAT_MESSAGES);
  const dialog = new Dialog(t.message(TEXT.yes), t.message(TEXT.no), () => {});
  const words: number[] = Array.from({ length: count }, () => WORD_NONE);
  const groups = GROUPS.map((g) => ({ label: t.message(g.label), banks: g.banks }));
  const listed = new Map<number, { word: number; text: string }[]>();
  const groupList = (g: number) => {
    let l = listed.get(g);
    if (!l) listed.set(g, (l = groupWords(registries, t, state, groups[g]!.banks)));
    return l;
  };
  const wordText = new Map<number, string>();
  let mode: EasyChatView['mode'] = 'slots';
  let slot = 0;
  let group = 0;
  let cursor = 0;
  let top = 0;

  const ask = (): Step =>
    dialog.confirm([t.message(TEXT.confirm)], (yes) => (yes ? done([...words]) : undefined));
  const quit = (): Step => dialog.confirm([t.message(TEXT.quit)], (yes) => (yes ? done(null) : undefined));
  const openGroup = (g: number): Step => {
    if (g === groups.length) return void (mode = 'slots');
    if (!groupList(g).length) return;
    group = g;
    mode = 'words';
    cursor = 0;
    top = 0;
  };
  const pick = (i: number): Step => {
    const w = groupList(group)[i];
    if (!w) return;
    words[slot] = w.word;
    wordText.set(w.word, w.text);
    mode = 'slots';
    const empty = words.indexOf(WORD_NONE);
    if (empty >= 0) return void (slot = empty);
    return ask();
  };
  const scroll = () => {
    const row = Math.floor(cursor / COLUMNS);
    if (row < top) top = row;
    else if (row >= top + EASY_CHAT_ROWS) top = row - EASY_CHAT_ROWS + 1;
  };

  return {
    view(): EasyChatView {
      return {
        app: 'easy-chat',
        prompt: t.message(TEXT.prompt),
        slots: words.map((w) => (w === WORD_NONE ? '' : wordText.get(w)!)),
        mode,
        cursor: mode === 'slots' ? slot : mode === 'groups' ? group : cursor,
        groups: [...groups.map((g) => g.label), t.message(CANCEL)],
        group: mode === 'words' ? groups[group]!.label : null,
        words: mode === 'words' ? groupList(group).map((w) => w.text) : [],
        top,
        rows: EASY_CHAT_ROWS,
        message: dialog.message(),
        yesNo: dialog.yesNo(),
      };
    },
    input(i: Input): Step {
      if (dialog.active) return dialog.input(i);
      if ('tap' in i) {
        if (i.tap === 'back') return this.input({ button: 'b' });
        const s = tapIndex(i.tap, 'slot');
        if (s !== null && s >= 0 && s < count) return (slot = s), (mode = 'groups'), undefined;
        const g = tapIndex(i.tap, 'group');
        if (g !== null && mode === 'groups' && g >= 0 && g <= groups.length) return openGroup(g);
        const w = tapIndex(i.tap, 'word');
        if (w !== null && mode === 'words') return pick(w);
        // `word:<text id>`: the listed word with that text, wherever the game language sorts it (replays).
        const named = /^word:([a-z0-9-]+:\S+)$/.exec(i.tap)?.[1];
        if (named && mode === 'words') {
          const at = groupList(group).findIndex((x) => x.text === t.text(named as Id));
          if (at < 0) throw new Error(`easy chat: ${named} is not a word of the open group`);
          return pick(at);
        }
        if (mode === 'words' && (i.tap === 'up' || i.tap === 'down')) {
          const rows = Math.ceil(groupList(group).length / COLUMNS);
          top = Math.max(0, Math.min(rows - EASY_CHAT_ROWS, top + (i.tap === 'up' ? -EASY_CHAT_ROWS : EASY_CHAT_ROWS)));
          cursor = top * COLUMNS;
        }
        return;
      }
      const b = i.button;
      if (mode === 'slots') {
        if (b === 'left' || b === 'up') slot = Math.max(0, slot - 1);
        else if (b === 'right' || b === 'down') slot = Math.min(count - 1, slot + 1);
        else if (b === 'a') mode = 'groups';
        else if (b === 'b') return quit();
        return;
      }
      if (mode === 'groups') {
        if (b === 'up' || b === 'down' || b === 'left' || b === 'right') group = moveCursor(group, groups.length + 1, 2, b);
        else if (b === 'a') return openGroup(group);
        else if (b === 'b') mode = 'slots';
        return;
      }
      const n = groupList(group).length;
      if (b === 'left' && cursor % COLUMNS > 0) cursor--;
      else if (b === 'right' && cursor % COLUMNS < COLUMNS - 1 && cursor + 1 < n) cursor++;
      else if (b === 'up' && cursor >= COLUMNS) cursor -= COLUMNS;
      else if (b === 'down' && cursor + COLUMNS < n) cursor += COLUMNS;
      else if (b === 'a') return pick(cursor);
      else if (b === 'b') mode = 'groups';
      scroll();
      return;
    },
  };
}
