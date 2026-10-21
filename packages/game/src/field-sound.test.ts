import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { audioTrace, withFieldSounds } from '../../../tests/fixtures/audio.ts';
import { readPack } from '../test/packs.ts';
import { loadGamePacks } from './packs.ts';
import { createGame } from './game.ts';
import { CountingStubLog } from './stub-log.ts';

const f = (s: string) => `fixture:${s}` as Id;
function gameWithScript(ir: string) {
  const pack = structuredClone(readPack('fixture'));
  const regs = withFieldSounds(loadGamePacks([pack]).registries);
  pack.registries.sequences = [...regs.sequences.values()].map((s) => ({ ...s }));
  pack.registries.cries = [...regs.cries.values()].map((c) => ({ ...c }));
  pack.registries.texts!.push({ id: f('Text_SoundPages'), text: 'Good morning, traveller!{scroll}Two{clear}Three' });
  Object.assign(pack.scripts.labels, parseIR(ir).labels);
  const game = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
  game.state.vars[f('VAR_ROOM_INTRO')] = 1;
  for (let i = 0; i < 10; i++) game.tick();
  const sounds = audioTrace(game.sound, game.registries, () => game.state.tick);
  const start = game.state.tick;
  game.scripts.start({ label: f('SOUND_TEST'), zone: game.state.player.zone, source: 'test' });
  return { game, sounds, start };
}

describe('script-owned field sound ordering', () => {
  it.each([1158, 1157, 1160, 1163])('pickup keeps fanfare %i at the script instruction, without an AddItem duplicate', (source) => {
    const g = gameWithScript(`fixture:SOUND_TEST::
  play_se 1500
  wait_se 1500
  play_fanfare ${source}
  add_item 1, 1, var(fixture:VAR_RESULT)
  wait_fanfare
  end
`);
    for (let i = 0; g.game.scripts.running() && i < 100; i++) g.game.tick();
    const starts = g.sounds.filter((s) => s.op === 'start');
    expect(starts.map((s) => [s.tick - g.start, s.source])).toEqual([[0, 1500], [3, source]]);
    expect(g.game.state.bag.items!.some((s) => s.item === f('ITEM_LAMP_OIL'))).toBe(true);
    expect(g.game.scripts.running()).toBe(false);
  });

  it.each([[0, 7, 1611], [1, 10, 1610]])('obstacle %i preserves its yielding dispatch and the script wait of %i ticks', (kind, delay, source) => {
    const g = gameWithScript(`fixture:SOUND_TEST::
  start_destroy_obstacle_animation ${kind}, var(fixture:VAR_SCENE)
  wait_time ${delay}, var(fixture:VAR_RESULT)
  remove_object 0
  end
`);
    let removed = -1;
    for (let i = 0; g.game.scripts.running() && i < 100; i++) {
      const before = g.game.state.objects.some((o) => o.localId === 0);
      const tick = g.game.state.tick;
      g.game.tick();
      if (before && !g.game.state.objects.some((o) => o.localId === 0)) removed = tick;
    }
    expect(g.sounds.filter((s) => s.op === 'start').map((s) => [s.tick - g.start, s.source])).toEqual([[0, source]]);
    expect(removed - g.sounds[0]!.tick).toBe(delay + 2); // Dispatch yields, WaitTime counts its callbacks, then the VM resumes.
  });
});

it('map music changes before the arrival door starts, so the music reset cannot stop its cue', () => {
  const { game } = gameWithScript('fixture:SOUND_TEST::\n  end\n');
  game.tick();
  const town = game.registries.zones.get(f('TOWN'))!;
  town.music = { day: f('SEQ_ROUTE'), night: f('SEQ_ROUTE') };
  game.registries.props.get(f('PROP_DOOR'))!.doorSounds = { open: 1541, close: 1543 };
  game.world.warp(f('ROOM'), 15, 19, 'down');
  for (let i = 0; i < 30; i++) game.tick();
  const commands: { tick: number; op: string; source?: number }[] = [];
  game.sound.output = { send(c) {
    commands.push({ tick: game.state.tick, op: c.op, ...(c.op === 'start' ? { source: game.registries.sequences.get(c.seq)!.sourceIndex } : {}) });
  } };
  game.press('down'); game.tick(); game.release('down');
  for (let i = 0; i < 40; i++) game.tick();
  const door = commands.findIndex((c) => c.source === 1541);
  expect(door).toBeGreaterThan(0);
  const at = commands[door]!.tick;
  expect(commands.filter((c) => c.tick === at && (c.op === 'stop-all' || c.op === 'start')).map((c) => [c.op, c.source])).toEqual([['stop-all', undefined], ['start', 1002], ['start', 1541]]);
});

describe('message box sound (decomp TextPrinter_Continue)', () => {
  const A = { held: ['a' as const], pressed: ['a' as const], touch: null };
  const IDLE = { held: [], pressed: [], touch: null };
  const SCRIPT = `fixture:SOUND_TEST::
  message text(fixture:Text_SoundPages)
  wait_button
  close_message
  end
`;
  const confirms = (g: ReturnType<typeof gameWithScript>) => g.sounds.filter((s) => s.op === 'start' && s.source === 1500).map((s) => s.tick);

  it('plays SE_CONFIRM once per press that ends a {scroll}/{clear} wait; the closing A/B is silent', () => {
    const g = gameWithScript(SCRIPT);
    const presses: number[] = [];
    for (let i = 0; g.game.scripts.running() && i < 400; i++) {
      const press = g.game.scripts.view().message?.waitingForInput === true;
      if (press) presses.push(g.game.state.tick);
      g.game.step(press ? A : IDLE);
    }
    expect(g.game.scripts.running()).toBe(false);
    // Two page breaks and the closing wait_button.
    expect(presses).toHaveLength(3);
    expect(confirms(g)).toEqual(presses.slice(0, 2));
  });

  it('pressing to speed up the printing is silent', () => {
    const g = gameWithScript(SCRIPT);
    for (let i = 0; i < 3; i++) g.game.step(i === 1 ? IDLE : A);
    expect(g.game.scripts.view().message?.waitingForInput).toBe(false);
    expect(confirms(g)).toEqual([]);
  });

});
