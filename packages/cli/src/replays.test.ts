/**
 * The demo mod changes behaviour only when it is loaded: the same inputs (packs/demo-mod's replay) on the
 * fixture alone give the vanilla starter and guide line. Headless, real World and VM.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayDriver } from '@opensinnoh/game';
import { loadEngine } from './engine.ts';
import { readPackDir } from './workspace.ts';

const PACKS = join(import.meta.dirname, '../../../packs');
/** The mod's replay without its party asserts, which only hold with the mod. */
const inputs = readFileSync(join(PACKS, 'demo-mod/replays/starter-swap.replay'), 'utf8')
  .split('\n')
  .filter((l) => !/assert (party|var fixture:VAR_PLAYER_STARTER)/.test(l))
  .join('\n');

async function play(packNames: string[]) {
  const engine = await loadEngine();
  const game = createGame({ packs: packNames.map((p) => readPackDir(join(PACKS, p))), ...engine, seed: 1, log: new CountingStubLog(() => {}) });
  const messages: string[] = [];
  const panels: string[][] = [];
  const base = gameDriver(game);
  const driver: ReplayDriver = {
    ...base,
    advance(n) {
      for (let i = 0; i < n; i++) {
        game.tick();
        const view = game.scripts.view();
        if (view.message?.waitingForInput && messages.at(-1) !== view.message.text) messages.push(view.message.text);
        if (view.panel.kind === 'choice' && !panels.length) panels.push(view.panel.options.map((o) => o.label));
      }
    },
  };
  const result = await runReplay(driver, inputs, { registries: game.registries, repeat: false });
  return { result, messages, panels, party: game.state.party.map((m) => m.species) };
}

describe('demo-mod vs vanilla (same inputs)', () => {
  it('with the mod: slot 0 is Rainlet (Dripling) and the guide says the overridden line', async () => {
    const r = await play(['fixture', 'demo-mod']);
    expect(r.result.error).toBeUndefined();
    expect(r.panels[0]).toEqual(['Rainlet', 'Emberkit', 'Mosslet']);
    expect(r.party).toEqual(['fixture:SPECIES_DRIPLING']);
    expect(r.messages.at(-1)).toBe('Rainlet loves the rain.\nTake it for a walk in the grass!');
  });

  it('without the mod: slot 0 is Mosslet and the guide says the fixture line', async () => {
    const r = await play(['fixture']);
    expect(r.result.error).toBeUndefined();
    expect(r.panels[0]).toEqual(['Mosslet', 'Emberkit', 'Dripling']);
    expect(r.party).toEqual(['fixture:SPECIES_MOSSLET']);
    expect(r.messages.at(-1)).toBe('The grass is safe with a companion.');
    expect(r.messages.join('\n')).not.toMatch(/Rainlet/);
  });
});
