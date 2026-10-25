/**
 * The field start menu (decomp start_menu.c) and the screens it opens with the data the state has:
 * party, bag, trainer card, save, options and the Pokédex. Entries follow the DS order and
 * conditions: POKéDEX once obtained, POKéMON once the party is not empty, BAG, the player's name
 * (trainer card), SAVE, OPTIONS, EXIT. The cursor is remembered between openings, as on the DS.
 */
import type { Button } from '@opensinnoh/core';
import { newGameRecord, type DeviceOptions, type OptionsView, type SaveView, type StartMenuView } from '@opensinnoh/contracts';
import { bagScreen } from './bag.ts';
import { trainerCardScreen } from './card-dex.ts';
import { menuSe, playTime, type MenuContext } from './context.ts';
import { currentObjective } from './objective.ts';
import { partyScreen } from './party.ts';
import { pokedexScreen } from './pokedex.ts';
import { moveCursor, tapIndex, type Screen, type Step } from './stack.ts';
import type { MenuKey } from './strings.ts';

type Input = { button: Button } | { tap: string };
type EntryId = StartMenuView['entries'][number]['id'];

const ENTRIES: { id: EntryId; label: MenuKey }[] = [
  { id: 'retire', label: 'startRetire' },
  { id: 'pokedex', label: 'startPokedex' },
  { id: 'pokemon', label: 'startPokemon' },
  { id: 'bag', label: 'startBag' },
  { id: 'trainer', label: 'startTrainer' },
  { id: 'save', label: 'startSave' },
  { id: 'options', label: 'startOptions' },
  { id: 'exit', label: 'startExit' },
];

const CLOSE = { close: { app: 'start-menu' as const } };

/** SystemFlag_CheckSafariGameActive (FLAG_SAFARI_GAME_ACTIVE; never in packs without a Great Marsh). */
function safariGame(ctx: MenuContext): boolean {
  const flag = newGameRecord(ctx.registries).greatMarsh?.flag;
  return !!flag && (ctx.state.flags[flag] ?? ctx.registries.flags.get(flag)?.initial ?? false);
}

export function startMenu(ctx: MenuContext): Screen {
  // StartMenu_GetSafariHiddenOptions: in a Safari Game SAVE (and CHAT) are hidden; otherwise RETIRE is.
  const entries = () => {
    const safari = safariGame(ctx);
    return ENTRIES.filter((e) => (e.id !== 'pokedex' || ctx.state.pokedex.obtained) && (e.id !== 'pokemon' || ctx.state.party.length > 0) && (e.id !== 'retire' || safari) && (e.id !== 'save' || !safari));
  };
  let cursor = Math.max(0, entries().findIndex((e) => e.id === ctx.memory.startEntry));
  /** The entry whose screen is open over the menu. */
  let open: string | null = null;
  const select = (i: number): Step => {
    const entry = entries()[i];
    if (!entry) return;
    menuSe(ctx, 1500);
    cursor = i;
    ctx.memory.startEntry = entry.id;
    open = entry.id;
    switch (entry.id) {
      case 'retire':
        return { close: { app: 'start-menu', retire: true } };
      case 'pokedex':
        return { push: pokedexScreen(ctx) };
      case 'pokemon':
        return { push: partyScreen(ctx, { kind: 'field' }) };
      case 'bag':
        return { push: bagScreen(ctx, { kind: 'field' }) };
      case 'trainer':
        return { push: trainerCardScreen(ctx) };
      case 'save':
        return { push: saveScreen(ctx) };
      case 'options':
        return { push: optionsScreen(ctx) };
      case 'exit':
        return CLOSE;
    }
  };
  return {
    view: () => ({
      app: 'start-menu',
      title: ctx.text.t('startTrainer', ctx.state.names.player),
      entries: entries().map((e) => ({ id: e.id, label: e.id === 'trainer' ? ctx.text.t(e.label, ctx.state.names.player) : ctx.text.t(e.label) })),
      cursor,
      // StartMenu_PrintBallCount: the count, 2 digits without padding.
      ...(safariGame(ctx) ? { ballStock: { label: ctx.text.t('startSafariBalls'), stock: ctx.text.t('startBallStock', String(ctx.state.safari?.balls ?? 0)) } } : {}),
      // OpenSinnoh, not Platinum: the current objective beside the menu (option `objective`).
      ...objective(ctx),
    }),
    input(i: Input): Step {
      if ('tap' in i) {
        if (i.tap === 'back') { menuSe(ctx, 1500); return CLOSE; }
        const n = tapIndex(i.tap, 'entry');
        return n === null ? undefined : select(n);
      }
      const b = i.button;
      if (b === 'up' || b === 'down') {
        const next = moveCursor(cursor, entries().length, 1, b);
        if (next !== cursor) menuSe(ctx, 1504);
        cursor = next;
        ctx.memory.startEntry = entries()[cursor]!.id;
      } else if (b === 'a') return select(cursor);
      else if (b === 'b' || b === 'x' || b === 'start') { menuSe(ctx, 1500); return CLOSE; }
      return;
    },
    /**
     * Back from an entry's screen. The Pokédex, party, bag, trainer card and options replaced the field map on the DS,
     * so it starts again (StartMenu_Exit* → FieldSystem_StartFieldMap); SAVE runs over the field.
     */
    resume(): Step {
      if (open !== null && FIELD_MAP_APPS.has(open)) ctx.host.fieldReturn?.();
      open = null;
      return undefined;
    },
  };
}

/** The start menu's entries whose screen is a DS child process (FieldSystem_StartChildProcess). */
const FIELD_MAP_APPS = new Set(['pokedex', 'pokemon', 'bag', 'trainer', 'options']);

function objective(ctx: MenuContext): Pick<StartMenuView, 'objective'> {
  if (ctx.host.options().objective !== 0) return {};
  const o = currentObjective(ctx.state, ctx.registries);
  return o ? { objective: { title: ctx.text.text(o.title), text: ctx.text.text(o.text) } } : {};
}

/** SAVE: the save-info window and the DS question, YES/NO, then "saved" (closes the menu on A/B). */
export function saveScreen(ctx: MenuContext): Screen {
  let phase: SaveView['phase'] = 'ask';
  let message = ctx.text.t('saveAsk');
  let cursor: 0 | 1 = 0;
  const answer = (yes: boolean): Step => {
    menuSe(ctx, 1500);
    if (!yes) return 'pop';
    try {
      ctx.host.save();
      phase = 'done';
      message = ctx.text.t('saveDone', ctx.state.names.player);
      menuSe(ctx, 1563);
    } catch (e) {
      phase = 'error';
      message = (e as Error).message;
    }
    return;
  };
  const finish = (): Step => (phase === 'done' ? CLOSE : 'pop');
  return {
    view(): SaveView {
      const s = ctx.state;
      const info = [
        { label: ctx.text.t('savePlayer'), value: s.names.player },
        { label: ctx.text.t('saveBadges'), value: String(s.badges.length) },
        ...(s.pokedex.obtained ? [{ label: ctx.text.t('savePokedex'), value: String(s.pokedex.seen.length) }] : []),
        { label: ctx.text.t('saveTime'), value: playTime(ctx) },
      ];
      return { app: 'save', info, phase, message, yes: ctx.text.t('yes'), no: ctx.text.t('no'), cursor };
    },
    input(i: Input): Step {
      if (phase !== 'ask') {
        if (('tap' in i && (i.tap === 'ok' || i.tap === 'back')) || ('button' in i && (i.button === 'a' || i.button === 'b'))) return finish();
        return;
      }
      if ('tap' in i) return i.tap === 'yes' ? answer(true) : i.tap === 'no' || i.tap === 'back' ? answer(false) : undefined;
      if (i.button === 'up' || i.button === 'down') { menuSe(ctx, 1500); cursor = cursor === 0 ? 1 : 0; }
      else if (i.button === 'a') return answer(cursor === 0);
      else if (i.button === 'b') return answer(false);
      return;
    },
  };
}

/** OPTIONS (decomp options_menu.c): up/down pick a row, left/right change it; stored by the host. */
export function optionsScreen(ctx: Pick<MenuContext, 'registries' | 'text' | 'host' | 'log'>): Screen {
  let cursor = 0;
  const t = (k: MenuKey) => ctx.text.t(k);
  const rows: { key: keyof DeviceOptions; label: MenuKey; desc: MenuKey; values: () => string[] }[] = [
    { key: 'textSpeed', label: 'optTextSpeed', desc: 'optTextSpeedDesc', values: () => [t('optSlow'), t('optMid'), t('optFast')] },
    { key: 'sound', label: 'optSound', desc: 'optSoundDesc', values: () => [t('optStereo'), t('optMono')] },
    { key: 'battleScene', label: 'optBattleScene', desc: 'optBattleSceneDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'battleStyle', label: 'optBattleStyle', desc: 'optBattleStyleDesc', values: () => [t('optShift'), t('optSet')] },
    { key: 'buttonMode', label: 'optButtonMode', desc: 'optButtonModeDesc', values: () => [t('optButtonNormal'), t('optButtonStartX'), t('optButtonLA')] },
    { key: 'frame', label: 'optFrame', desc: 'optFrameDesc', values: () => Array.from({ length: 20 }, (_, i) => ctx.text.frameType(i)) },
    // A modern option after the DS's (docs/decisions.md: trade-only evolutions in single player).
    { key: 'tradeEvolution', label: 'optTradeEvolution', desc: 'optTradeEvolutionDesc', values: () => [t('optOn'), t('optOff')] },
    // docs/decisions.md: the lead party Pokémon follows the player.
    { key: 'followers', label: 'optFollowers', desc: 'optFollowersDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'followerStyle', label: 'optFollowerStyle', desc: 'optFollowerStyleDesc', values: () => [t('optFollowerStill'), t('optFollowerWalk')] },
    // OpenSinnoh, not Platinum: the naming keyboard goes to lowercase after the first character.
    { key: 'autoLowercase', label: 'optAutoLowercase', desc: 'optAutoLowercaseDesc', values: () => [t('optOn'), t('optOff')] },
    // The quality-of-life options (OpenSinnoh, not Platinum; docs/decisions.md).
    { key: 'autoRun', label: 'optAutoRun', desc: 'optAutoRunDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'repelPrompt', label: 'optRepelPrompt', desc: 'optRepelPromptDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'itemWheel', label: 'optItemWheel', desc: 'optItemWheelDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'followerTalk', label: 'optFollowerTalk', desc: 'optFollowerTalkDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'statView', label: 'optStatView', desc: 'optStatViewDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'summaryRename', label: 'optRename', desc: 'optRenameDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'dexNameSearch', label: 'optDexNameSearch', desc: 'optDexNameSearchDesc', values: () => [t('optOn'), t('optOff')] },
    { key: 'character', label: 'optCharacter', desc: 'optCharacterDesc', values: () => [t('optCharacterPlatinum'), t('optCharacterHgss')] },
    // NOT DS: Underground vendors count toward Spiritomb in place of the players met over DS Wireless.
    { key: 'spiritombVendors', label: 'optSpiritombVendors', desc: 'optSpiritombVendorsDesc', values: () => [t('optOn'), t('optOff')] },
    // OpenSinnoh, not Platinum: the start menu shows the current objective.
    { key: 'objective', label: 'optObjective', desc: 'optObjectiveDesc', values: () => [t('optOn'), t('optOff')] },
  ];
  const step = (row: number, delta: number) => {
    const r = rows[row]!;
    const n = r.values().length;
    menuSe(ctx, 1500);
    ctx.host.setOption(r.key, (ctx.host.options()[r.key] + delta + n) % n);
  };
  return {
    view(): OptionsView {
      const options = ctx.host.options();
      return {
        app: 'options',
        title: t('optionsTitle'),
        rows: rows.map((r) => ({ key: r.key, label: t(r.label), values: r.values(), value: options[r.key], description: t(r.desc) })),
        close: t('optClose'),
        closeDescription: t('optCloseDesc'),
        description: cursor < rows.length ? t(rows[cursor]!.desc) : t('optCloseDesc'),
        cursor,
      };
    },
    input(i: Input): Step {
      if ('tap' in i) {
        if (i.tap === 'close' || i.tap === 'back') { menuSe(ctx, 1500); return 'pop'; }
        const row = tapIndex(i.tap, 'row');
        if (row !== null && row >= 0 && row < rows.length && cursor !== row) { menuSe(ctx, 1500); cursor = row; }
        const m = /^(value|step):(\d+):(-?\d+)$/.exec(i.tap);
        if (m) {
          const r = Number(m[2]);
          const v = Number(m[3]);
          if (r >= rows.length) return;
          cursor = r;
          if (m[1] === 'value' && v >= 0 && v < rows[r]!.values().length && ctx.host.options()[rows[r]!.key] !== v) { menuSe(ctx, 1500); ctx.host.setOption(rows[r]!.key, v); }
          else if (m[1] === 'step' && (v === 1 || v === -1)) step(r, v);
        }
        return;
      }
      const b = i.button;
      if (b === 'up' || b === 'down') { menuSe(ctx, 1500); cursor = moveCursor(cursor, rows.length + 1, 1, b); }
      else if ((b === 'left' || b === 'right') && cursor < rows.length) step(cursor, b === 'left' ? -1 : 1);
      else if ((b === 'a' && cursor === rows.length) || b === 'b') { menuSe(ctx, 1500); return 'pop'; }
      return;
    },
  };
}
