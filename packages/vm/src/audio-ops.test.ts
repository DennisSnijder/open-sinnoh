/** The sound commands on synthetic IR against the fixture pack's sound records and a fake sound system. */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import { Driver, FakeAudio, loadFixture, newState } from './test-support.ts';

const fixture = loadFixture();
const vars = new Map(fixture.registries.vars);
vars.set('test:VAR_X' as Id, { id: 'test:VAR_X' as Id, sourceIndex: 0x4100, initial: 0, scope: 'saved' });
const registries = { ...fixture.registries, vars };

function drive(ir: string) {
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  return new Driver(registries, labels, newState());
}

function run(d: Driver, label: string, max = 500) {
  d.vm.start({ label: label as Id, zone: 'fixture:TOWN' as Id, source: 'test' });
  return d.until(() => !d.vm.running(), max);
}

describe('sound commands', () => {
  it('play_music, play_fanfare and wait_fanfare, play_se and wait_se, get_current_bgm (sequence numbers are sourceIndex)', () => {
    const d = drive(`
test:Music::
  play_music 1001
  play_fanfare 1100
  wait_fanfare
  play_se 1500
  wait_se 1500
  get_current_bgm var(test:VAR_X)
  end
`);
    const ticks = run(d, 'test:Music');
    expect(d.audio.played).toEqual(['bgm fixture:SEQ_TOWN', 'fanfare fixture:SEQ_JINGLE', 'se fixture:SEQ_SE_BLIP']);
    expect(d.state.vars['test:VAR_X' as Id]).toBe(1001);
    // The waits follow the sound system: the fanfare's ticks, then the sound effect's.
    expect(ticks).toBeGreaterThanOrEqual(FakeAudio.TICKS.fanfare + FakeAudio.TICKS.se);
  });

  it('fade_out_bgm waits for the fade; a sequence the packs lack is logged and not played', () => {
    const d = drive(`
test:Fade::
  fade_out_bgm 0, 30
  play_se 1999
  end
`);
    const ticks = run(d, 'test:Fade');
    expect(d.audio.played).toEqual(['fade out 0 30']);
    expect(ticks).toBeGreaterThanOrEqual(30);
    expect(d.log.keys.has('audio:sequence-missing')).toBe(true);
  });

  it('play_cry plays the species cry; wait_cry waits for it', () => {
    const d = drive(`
test:Cry::
  play_cry 1, 0
  wait_cry
  end
`);
    const species = [...registries.species.values()].find((s) => s.sourceIndex === 1)!;
    const ticks = run(d, 'test:Cry');
    expect(d.audio.played).toEqual([`cry ${species.id}`]);
    expect(ticks).toBeGreaterThanOrEqual(FakeAudio.TICKS.cry);
  });
});
