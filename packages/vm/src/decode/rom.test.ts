import { beforeAll, describe, expect, it } from 'vitest';
import { parseIR, printIR, type Id } from '@opensinnoh/core';
import type { Flag, Registries, Text, Var } from '@opensinnoh/contracts';
import { decodeMessageBank } from '@opensinnoh/nds';
import { decodeInitScripts, decodeScripts } from './decode.ts';
import { memberKind, COMMANDS } from '../commands.ts';
import { coverage } from '../coverage.ts';
import { loadRomScripts, romPath } from '../rom-fixture.ts';
import { Driver, newState } from '../test-support.ts';

describe.skipIf(!romPath)('decode scr_seq on the ROM', () => {
  let rom: ReturnType<typeof loadRomScripts>;
  beforeAll(() => { rom = loadRomScripts(); });

  it('decodes every script file and round-trips the IR', () => {
    const r = decodeScripts({ members: rom!.members, mapTextBanks: rom!.mapTextBanks });
    expect(rom!.members.length).toBe(1124);
    const text = printIR(r.ir);
    expect(parseIR(text)).toEqual(r.ir);
    const cov = coverage(Object.values(r.ir.labels));
    console.log(
      `decoded ${r.files} files, ${Object.keys(r.ir.labels).length} labels, ${r.instructions} instructions, ${r.opcodes.size} distinct opcodes, ${r.movements.length} movements; VM implements ${cov.usedImplemented.length}/${cov.used.length} used ops`,
    );
    expect(r.files).toBe(575); // 574 script files + the dummy for script id 0
    // The European builds (German, European English) use two commands fewer than US rev 0: the slot machine game and
    // its bonus-streak prize (0x267, 0x275), as their Game Corner has no playable slot machines.
    const us = rom!.gameCode === 'CPUE' && rom!.revision === 0;
    expect(r.opcodes.size).toBe(us ? 720 : 718);
  });

  it('decodes every level-script table', () => {
    let rows = 0;
    rom!.headers.forEach((h) => {
      expect(memberKind(h.init)).toBe('init');
      rows += decodeInitScripts(rom!.members[h.init]!, h.scripts).onFrame.length;
    });
    expect(rows).toBeGreaterThan(0);
    expect(COMMANDS.length).toBe(840);
  });
});

describe.skipIf(!romPath)('VM on ROM scripts', () => {
  it('runs the bedroom rival scene to completion against a fake field', () => {
    const rom = loadRomScripts();
    const r = decodeScripts({ members: rom.members, mapTextBanks: rom.mapTextBanks });
    // Registries synthesised from the refs the IR uses (the importer makes the real ones).
    const vars = new Map<Id, Var>();
    const flags = new Map<Id, Flag>();
    const texts = new Map<Id, Text>();
    const banks = new Map<number, Uint16Array[]>();
    for (const cmds of Object.values(r.ir.labels))
      for (const c of cmds)
        for (const a of c.args) {
          if (a.kind === 'var') {
            const n = Number(a.id.split('/')[1]);
            vars.set(a.id, { id: a.id, sourceIndex: n, initial: 0, scope: n >= 0x8000 ? 'temp' : n < 0x4020 ? 'map' : 'saved' });
          } else if (a.kind === 'flag') flags.set(a.id, { id: a.id, initial: false, scope: 'saved' });
          else if (a.kind === 'text' && a.id.startsWith('platinum:text/')) {
            const [bank, idx] = a.id.slice('platinum:text/'.length).split('/').map(Number) as [number, number];
            if (!banks.has(bank)) banks.set(bank, decodeMessageBank(rom.banks[bank]!));
            const codes = banks.get(bank)![idx];
            if (codes) texts.set(a.id, { id: a.id, text: roughMarkup(codes) });
          }
        }
    const registries = { vars, flags, texts, species: new Map(), items: new Map(), zones: new Map(), sequences: new Map() } as unknown as Registries;
    const labels = new Map(Object.entries(r.ir.labels).map(([id, commands]) => [id as Id, { pack: 'platinum', commands }]));
    const d = new Driver(registries, labels, newState());
    d.vm.start({ label: 'platinum:TwinleafTownPlayerHouse2F/6', zone: 'platinum:zone/415', source: 'coord' });
    let presses = 0;
    for (let i = 0; i < 5000 && d.vm.running(); i++) {
      if (d.vm.view().message?.waitingForInput) {
        d.press('a');
        presses++;
      } else d.tick();
    }
    expect(d.vm.running()).toBe(false);
    expect(presses).toBeGreaterThanOrEqual(5);
    expect(d.state.flags['platinum:flag/371']).toBe(true);
    expect(d.state.vars['platinum:var/16549']).toBe(1); // VAR_PLAYER_HOUSE_RIVAL_STATE
    expect(d.field.calls).toEqual(expect.arrayContaining(['addObject 0', 'removeObject 0', 'lockAll', 'releaseAll']));
    console.log(`rival scene: ${d.ticks} ticks, ${presses} presses, stubs: ${[...d.log.keys.keys()].join(', ')}`);
  });
});

/** Test-only char-code → markup: control codes exact, other chars as "x" (the real charmap is the importer's). */
function roughMarkup(codes: Uint16Array): string {
  let s = '';
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0xffff) break;
    if (c === 0xe000) s += '\n';
    else if (c === 0x25bc) s += '{clear}';
    else if (c === 0x25bd) s += '{scroll}';
    else if (c === 0xfffe) {
      const type = codes[i + 1]!;
      const n = codes[i + 2]!;
      const args = [...codes.subarray(i + 3, i + 3 + n)];
      const hi = type >> 8;
      s += hi === 0x01 || hi === 0x05 || hi === 0x06 ? `{var ${args[0]}}` : `{raw ${type.toString(16).padStart(4, '0').toUpperCase()}${args.length ? ' ' + args.join(',') : ''}}`;
      i += 2 + n;
    } else s += 'x';
  }
  return s;
}
