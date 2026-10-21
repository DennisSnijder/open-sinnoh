/**
 * Headless menu models (contracts 0.11 `CreateApp`, 0.12 battle bag and party, 0.13 storage, naming): the
 * game hosts them next to the VM, the app draws their `AppView`. Each app is a stack of screens driven by
 * the field's `InputFrame`.
 */
import type { AppHost, AppModel, CreateApp, Registries, StubLog } from '@opensinnoh/contracts';
import { menuContext } from './context.ts';
import { battleBagScreen, battlePartyScreen } from './battle.ts';
import { trainerCardScreen } from './card-dex.ts';
import { evolutionScreen } from './evolution.ts';
import { martScreen } from './mart.ts';
import { caughtEntryScreen } from './pokedex.ts';
import { namingScreen } from './naming.ts';
import { partyScreen } from './party.ts';
import { AppStack } from './stack.ts';
import { optionsScreen, startMenu } from './start-menu.ts';
import { MenuText } from './strings.ts';
import { storageScreen } from './storage.ts';
import { summaryScreen } from './summary.ts';
import { hatchScreen } from './hatch.ts';
import { libraryTvScreen } from './library-tv.ts';
import { hallOfFamePcScreen, hallOfFameRecordScreen } from './hall-of-fame.ts';
import { creditsScreen } from './credits.ts';
import { rowanIntroScreen, type RowanIntroOptions } from './rowan-intro.ts';
import { bagScreen } from './bag.ts';
import { moveReminderScreen } from './move-reminder.ts';
import { tradeScreen } from './trade.ts';
import { easyChatScreen } from './easy-chat.ts';
import { mysteryGiftScreen, type MysteryGiftOptions } from './mystery-gift.ts';
import { itemWheelScreen } from './item-wheel.ts';
import { poffinCookingApp } from './poffin-cooking.ts';
import { poffinCaseScreen } from './poffin-case.ts';
import { miningScreen } from './mining.ts';
import { undergroundMenu, undergroundVendor } from './underground.ts';

export const createApp: CreateApp = (request, deps) => {
  const ctx = menuContext(deps);
  switch (request.app) {
    case 'start-menu':
      return new AppStack(startMenu(ctx), { app: 'start-menu' });
    case 'mart':
      return new AppStack(martScreen(ctx, request), { app: 'mart' });
    case 'bag-select':
      return new AppStack(battleBagScreen(ctx, request), { app: 'bag-select', item: null, target: null });
    case 'party-select':
      return new AppStack(battlePartyScreen(ctx, request), { app: 'party-select', slot: null });
    case 'party':
      return new AppStack(partyScreen(ctx, { kind: 'select' }), { app: 'party', slot: null });
    case 'party-order':
      return new AppStack(partyScreen(ctx, { kind: 'order', count: request.count }), { app: 'party-order', order: null });
    case 'storage':
      return new AppStack(storageScreen(ctx, request.mode), { app: 'storage' });
    case 'pokedex-entry':
      return new AppStack(caughtEntryScreen(ctx, request.species, request.form), { app: 'pokedex-entry' });
    case 'signature':
      return new AppStack(trainerCardScreen(ctx, 'signature'), { app: 'signature' });
    case 'naming':
      return new AppStack(namingScreen(ctx, request, (name) => ({ close: { app: 'naming', name } }), () => ctx.host.options().autoLowercase === 0), { app: 'naming', name: null });
    case 'daycare-select':
      return new AppStack(partyScreen(ctx, { kind: 'daycare' }), { app: 'daycare-select', slot: null });
    case 'hatch':
      return new AppStack(hatchScreen(ctx, request.slot), { app: 'hatch', nickname: null });
    case 'library-tv':
      return new AppStack(libraryTvScreen(), { app: 'library-tv' });
    case 'hall-of-fame':
      return new AppStack(request.mode === 'record' ? hallOfFameRecordScreen(ctx) : hallOfFamePcScreen(ctx), { app: 'hall-of-fame' });
    case 'credits':
      return new AppStack(creditsScreen(ctx, request.skippable), { app: 'credits' });
    case 'bag-pick':
      return new AppStack(bagScreen(ctx, { kind: 'pick', pocket: request.pocket, done: (item) => ({ close: { app: 'bag-pick', item } }) }), { app: 'bag-pick', item: null });
    case 'move-reminder':
      return new AppStack(moveReminderScreen(ctx, { ...request, done: (learned) => ({ close: { app: 'move-reminder', learned } }) }), { app: 'move-reminder', learned: false });
    case 'trade':
      return new AppStack(tradeScreen(ctx, request, () => ({ close: { app: 'trade' } })), { app: 'trade' });
    case 'evolution':
      return new AppStack(evolutionScreen(ctx, request, (evolved) => ({ close: { app: 'evolution', evolved } })), { app: 'evolution', evolved: false });
    case 'easy-chat':
      return new AppStack(easyChatScreen(deps.registries, deps.state, request.words, (words) => ({ close: { app: 'easy-chat', words } })), { app: 'easy-chat', words: null });
    case 'mystery-gift':
      return new AppStack(mysteryGiftScreen({ registries: deps.registries, state: deps.state, date: () => deps.host.clock().date, host: deps.host, log: deps.log }, (received) => ({ close: { app: 'mystery-gift', received } })), { app: 'mystery-gift', received: false });
    case 'item-wheel':
      return new AppStack(itemWheelScreen(ctx), { app: 'item-wheel', item: null });
    case 'poffin-cooking':
      return new AppStack(poffinCookingApp(ctx), { app: 'poffin-cooking' });
    case 'poffin-case':
      return new AppStack(poffinCaseScreen(ctx, () => ({ close: { app: 'poffin-case' } })), { app: 'poffin-case' });
    case 'mining':
      return new AppStack(miningScreen(ctx, request.spot), { app: 'mining', dug: false });
    case 'ug-menu':
      return new AppStack(undergroundMenu(ctx), { app: 'ug-menu', goUp: false });
    case 'ug-vendor':
      return new AppStack(undergroundVendor(ctx, request.vendor), { app: 'ug-vendor' });
    case 'summary-teach':
      return new AppStack(summaryScreen(ctx, { party: () => deps.state.party, slot: request.slot, mode: { kind: 'teach', move: request.move, done: (forget) => ({ close: { app: 'summary-teach', forget } }) } }), { app: 'summary-teach', forget: null });
  }
};

/**
 * Mystery Gift without a running game (the title's MYSTERY GIFT, over the save's state): the same model the game
 * opens for replays (`mystery-gift`). It closes after a gift is received or on EXIT; the title writes the save.
 */
export function createMysteryGift(options: MysteryGiftOptions): AppModel {
  return new AppStack(mysteryGiftScreen(options, (received) => ({ close: { app: 'mystery-gift', received } })), { app: 'mystery-gift', received: false });
}

/**
 * OPTIONS without a game (the title's Options entry): the same model the start menu opens, over the device's options.
 * It closes (a result) when the player leaves it. The result is the start menu's: no app reads it.
 */
export function createOptions(registries: Registries, host: Pick<AppHost, 'options' | 'setOption'>, log: StubLog): AppModel {
  const text = new MenuText(registries);
  return new AppStack(optionsScreen({ registries, text, host: host as AppHost, log }), { app: 'start-menu' });
}

/**
 * Rowan's intro (the title's NEW GAME, before a game state exists): the DS intro with the naming keyboard; its
 * result is the names and gender the new game starts with.
 */
export function createRowanIntro(options: RowanIntroOptions): AppModel {
  return new AppStack(rowanIntroScreen(options, (r) => ({ close: { app: 'rowan-intro', ...r } })), { app: 'rowan-intro', names: { player: '', rival: '' }, gender: 'male' });
}

export { INTRO_TEXT, type RowanIntroOptions } from './rowan-intro.ts';
export { MENU_TEXT, MenuText, plainPages, plainText, type MenuKey } from './strings.ts';
export { moveCursor, REPEAT_DELAY, REPEAT_EVERY } from './stack.ts';
export { BODY_SHAPES, dexLists, numericalRows, searchDex, NO_QUERY, TYPED_NAME, type DexEntry, type DexQuery } from './pokedex.ts';
export { areaLayers, PAINTED } from './pokedex-area.ts';
export { EVOLUTION_STRINGS } from './evolution.ts';
export { OPENSINNOH_CARD } from './credits.ts';
export { DISCARD_TICKS, RECEIVE_TICKS, SEARCH_TICKS, type MysteryGiftOptions } from './mystery-gift.ts';
export { GIFT_CODE_PROMPT } from './naming.ts';
export { ParticleSystem } from './particles.ts';
export { createPoketch } from './poketch/system.ts';
export { calcDigit, calcEval, calcText, calcZero, type CalcValue } from './poketch/tools.ts';
export { cellPosition, cellZone, flyLocationAt, foundHidden, locationCell, namedCell, startCell, townMapScreen, unlockedLocations } from './town-map.ts';
