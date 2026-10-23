/**
 * The secret base's field prompts (decomp src/underground/secret_bases.c), DS windows over the field:
 * - `drill` (SecretBases_DiggerDrillTask): "The Digger Drill was used!" for 30 ticks once shown, "Discovered a small
 *   cavern!", then "make your Secret Base here?" or, with a base already, "move here?" and YES/NO;
 * - `enter` (SecretBases_EnterBasePromptTask, the own base): "It's your own Secret Base. Would you like to go in?",
 *   then "Leave the entrance open? Or close it so you can decorate?" and LEAVE DOOR OPEN / CLOSE AND DECORATE (B: no);
 * - `exit` (SecretBases_ExitBasePromptTask): "Exit the Secret Base?"; with the entrance closed "Open the door and exit
 *   the Secret Base?" and then the wireless notice, both YES/NO (the DS relaunches its wireless; the notice stays).
 * The field acts on the answer (World.undergroundAppDone).
 */
import { readUnderground, TRAP } from '@opensinnoh/core';
import type { UndergroundBasePrompt, UndergroundBaseView } from '@opensinnoh/contracts';
import { Dialog } from './dialog.ts';
import { menuSe, type MenuContext } from './context.ts';
import { plainText } from './strings.ts';
import type { Screen, Step } from './stack.ts';

/** SE_CONFIRM. */
const SE_CONFIRM = 1500;
/** DRILL_STATE_WAIT: 30 ticks after "…was used!". */
const DRILL_WAIT = 30;

export function undergroundBaseScreen(ctx: MenuContext, prompt: UndergroundBasePrompt): Screen {
  const se = (n: number) => menuSe(ctx, n);
  const dialog = new Dialog(ctx.text.t('bagYes'), ctx.text.t('bagNo'), se);
  const text = (name: string, ...slots: string[]) => ctx.text.message(`UndergroundCommon_Text_${name}`, ...slots);
  let menu: { cursor: number } | null = null;
  let timed: { text: string; t: number } | null = null;
  const answer = (a: 'yes' | 'no' | 'open' | 'close'): Step => ({ close: { app: 'ug-base', prompt, answer: a } });

  switch (prompt) {
    case 'drill': {
      const id = ctx.registries.textBanks.get(ctx.text.id('TEXT_BANK_UNDERGROUND_TRAPS'))?.messages[TRAP.diggerDrill];
      if (!id) throw new Error('underground base: TEXT_BANK_UNDERGROUND_TRAPS has no Digger Drill');
      timed = { text: text('ItemWasUsed', '', '', '', plainText(ctx.registries.texts.get(id)!.text)), t: 0 };
      break;
    }
    case 'enter':
      dialog.confirm([text('EnterOwnBasePrompt')], (yes) => {
        if (!yes) return answer('no');
        return dialog.say([text('LeaveEntranceOpenOrClose')], () => {
          menu = { cursor: 0 };
          return;
        });
      });
      break;
    case 'exit':
      if (ctx.host.undergroundPlace?.() === 'closed') dialog.confirm([text('OpenDoorAndExitBasePrompt')], (yes) => (yes ? dialog.confirm([text('CommsWillBeLaunched')], (go) => answer(go ? 'yes' : 'no')) : answer('no')));
      else dialog.confirm([text('ExitBasePrompt')], (yes) => answer(yes ? 'yes' : 'no'));
      break;
  }

  const drillPrompt = (): Step => {
    const moving = readUnderground(ctx.state).base !== null;
    return dialog.confirm([text(moving ? 'MoveBasePrompt' : 'MakeBasePrompt')], (yes) => answer(yes ? 'yes' : 'no'));
  };

  const view = (): UndergroundBaseView => ({
    app: 'ug-base',
    menu: menu && !dialog.active ? { entries: [{ label: text('LeaveDoorOpen') }, { label: text('CloseAndDecorate') }], cursor: menu.cursor } : null,
    message: timed ? { text: timed.text, waiting: false } : (dialog.message() ?? (menu ? { text: text('LeaveEntranceOpenOrClose'), waiting: false } : null)),
    yesNo: dialog.yesNo(),
  });

  const tick = (): Step => {
    if (!timed) return;
    timed.t++;
    if (timed.t <= DRILL_WAIT) return;
    timed = null;
    return dialog.say([text('DiscoveredCavern')], drillPrompt);
  };

  const input = (i: { button: string } | { tap: string }): Step => {
    if (timed) return;
    if (dialog.active) return dialog.input(i as never);
    const m = menu;
    if (!m) return;
    const b = 'button' in i ? i.button : null;
    const tap = 'tap' in i ? i.tap : null;
    if (b === 'up' || b === 'down') {
      m.cursor = m.cursor === 0 ? 1 : 0;
      se(SE_CONFIRM);
      return;
    }
    if (b === 'b' || tap === 'back') {
      se(SE_CONFIRM);
      return answer('no');
    }
    const pick = tap?.startsWith('menu:') ? Number(tap.slice(5)) : b === 'a' ? m.cursor : null;
    if (pick !== 0 && pick !== 1) return;
    se(SE_CONFIRM);
    return answer(pick === 0 ? 'open' : 'close');
  };

  return { view, input: (i) => input(i as never), tick };
}
