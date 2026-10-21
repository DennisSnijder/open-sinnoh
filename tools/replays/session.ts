/**
 * An incremental replay-writing session: a headless game held in memory behind a local HTTP port, so a story
 * replay is written leg by leg without replaying it from its anchor each time. Needs the ROM (OPENSINNOH_NDS_ROM).
 *
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/session.ts tests/rom-replays/cp9.replay [--seed 1] [--port 7701]
 *
 * It plays the replay from its parent's chain anchor once, then holds a checkpoint: the save at the end of
 * the last committed lines that ended where the game can save (plus the battle log and the replay modes,
 * which a save does not hold), and the lines committed since.
 * - `POST /try` (body: replay lines): from the checkpoint, the pending lines then the body; prints the end
 *   (explore.ts's report). Nothing is kept.
 * - `POST /commit`: the same, and when it passes the body is appended to the replay file; the checkpoint
 *   moves to the end when the game can save there.
 * - `POST /to?x=…&z=…`: walk lines from the checkpoint's end (path.ts), not played.
 * A draft tool: run the finished replay with the checkpoint tests (a load can differ from a played-through
 * state: wanderers and timers restart).
 */
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import type { BattleLogEntry, EvolutionMode, GameState, Matrix, WildBattleMode } from '@opensinnoh/contracts';
import { parseReplay } from '@opensinnoh/core';
import { gameDriver, runReplay, type Game, type ReplayDriver } from '@opensinnoh/game';
import { MapGrid } from '../../packages/world/src/tiles.ts';
import { walkLines } from './path.ts';
import { prepareRomCache } from '../../tests/rom.ts';
import { anchoredDriver, anchoredText, chainAnchor, readReplay, REPLAYS, storyGame } from '../../tests/integration/checkpoints-anchors.ts';

const args = process.argv.slice(2);
const file = args.find((a) => /\.replay$/.test(a));
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const seed = Number(opt('seed') ?? 1);
const port = Number(opt('port') ?? 7701);
if (!file || !process.env.OPENSINNOH_NDS_ROM) throw new Error('usage: OPENSINNOH_NDS_ROM=<rom> tsx tools/replays/session.ts <file.replay> [--seed N] [--port P]');
await prepareRomCache();
const name = basename(file);
const prefix = parseReplay(readReplay(name)).from!.file;
const game: Game = storyGame(seed);
const base = gameDriver(game);

interface Checkpoint {
  save: string;
  battles: BattleLogEntry[];
  wild: WildBattleMode;
  evolve: EvolutionMode;
  pending: string;
}
let cp: Checkpoint;
let lastBattles: BattleLogEntry[] = [];
/** The replay modes the lines leave (a run's round trip resets the game's own). */
const modes = { wild: 'battle' as WildBattleMode, evolve: 'manual' as EvolutionMode };
function readModes(text: string): void {
  for (const m of text.matchAll(/^\S+ (wild|evolve) (\w+)\s*$/gm)) {
    if (m[1] === 'wild') modes.wild = m[2] as WildBattleMode;
    else modes.evolve = m[2] as EvolutionMode;
  }
}

/** A driver whose reset is the checkpoint: the save at its clock, the battle log and the modes put back. */
function driverAt(c: Checkpoint): ReplayDriver {
  const now = (JSON.parse(c.save) as { state: GameState }).state.gameTime.now;
  return {
    ...base,
    async reset(s) {
      // The runner's round trip resets too: keep the run's battle log for the next checkpoint.
      lastBattles = structuredClone(game.battles) as BattleLogEntry[];
      await base.reset(s);
      await base.setClock(now.date, `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`);
      await base.load(c.save);
      (game.battles as BattleLogEntry[]).push(...structuredClone(c.battles));
      game.wildBattles = c.wild;
      game.evolutions = c.evolve;
    },
  };
}

function report(): string {
  const out: string[] = [];
  const s = game.state;
  const v = game.scripts.view();
  out.push(`player ${s.player.zone.replace('platinum:MAP_HEADER_', '')} ${s.player.x},${s.player.z} facing ${s.player.facing} ${s.playerState}; script ${game.scripts.running() ? 'running' : 'idle'}; canSave ${game.canSave()}; app ${game.app()?.app ?? 'none'}; tick ${s.tick}; wild ${game.wildBattles} evolve ${game.evolutions}`);
  if (v.message) out.push(`message ${JSON.stringify(v.message)}`);
  if (v.yesNo) out.push('yes/no');
  if (v.menu) out.push(`menu: ${JSON.stringify(v.menu)}`);
  const battle = game.battle?.view();
  if (battle) out.push(`battle ${battle.kind} ${battle.topology}: prompt ${battle.prompt?.kind ?? 'none'}; ${JSON.stringify(battle.message?.text ?? '')}`);
  for (const p of s.party) out.push(`party ${p.species.replace('platinum:SPECIES_', '')} L${p.level} ${p.hp}/${p.stats.hp} ${p.moves.map((m) => m.replace('platinum:MOVE_', '')).join(' ')}`);
  out.push(`money ${s.money}; badges ${s.badges.length}`);
  for (const b of game.battles.slice(-4)) out.push(`battle t${b.tick} ${b.kind} ${b.trainers.join('+').replaceAll('platinum:', '')}${b.species.join('+').replaceAll('platinum:SPECIES_', '')} ${b.result} ${b.topology}`);
  const zone = game.registries.zones.get(s.player.zone)!;
  const grid = new MapGrid(game.registries, game.registries.matrices.get(zone.matrix) as Matrix);
  const zones = [...game.registries.zones.values()].filter((z) => z.matrix === zone.matrix);
  const mark = new Map<string, string>();
  const key = (x: number, z: number) => `${x},${z}`;
  for (const z of zones) {
    for (const w of z.events.warps) mark.set(key(w.x, w.z), 'w');
    for (const c of z.events.coords) for (let dx = 0; dx < c.width; dx++) for (let dz = 0; dz < c.length; dz++) mark.set(key(c.x + dx, c.z + dz), 'c');
  }
  for (const o of s.objects) mark.set(key(o.x, o.z), String(o.localId % 10));
  mark.set(key(s.player.x, s.player.z), 'P');
  const radius = 9;
  const [x0, x1, z0, z1] = [s.player.x - radius * 2, s.player.x + radius * 2, s.player.z - radius, s.player.z + radius];
  for (let d = 2; d >= 0; d--) {
    let row = '     ';
    for (let x = x0; x <= x1; x++) row += String(x).padStart(3)[2 - d];
    out.push(row);
  }
  for (let z = z0; z <= z1; z++) {
    let row = `${String(z).padStart(4)} `;
    for (let x = x0; x <= x1; x++) row += mark.get(key(x, z)) ?? (grid.blocked(x, z) ? '#' : '.');
    out.push(row);
  }
  const events = zones.flatMap((z) => z.events.objects.map((e) => ({ e, zone: z.id })));
  for (const o of s.objects) {
    const e = events.find((ev) => ev.e.localId === o.localId && ev.zone === o.zone)?.e;
    if (Math.abs(o.x - s.player.x) > 30 || Math.abs(o.z - s.player.z) > 20) continue;
    out.push(`obj #${o.localId} @${o.x},${o.z} ${o.facing} type ${o.movementType} ${e?.label?.replace('platinum:', '') ?? ''}${e?.trainer ? ` trainer ${e.trainer.id.replace('platinum:', '')} sight ${e.data[0]}` : ''}`);
  }
  return out.join('\n');
}

async function play(lines: string): Promise<{ ok: boolean; text: string }> {
  const text = `${cp.pending}\n${lines}\n`;
  const t0 = Date.now();
  const result = await runReplay(driverAt(cp), text, { registries: game.registries, seed, name, repeat: false, resolve: (f) => ({ name: f, text: readReplay(f) }) });
  return { ok: result.ok, text: `${result.ok ? 'OK' : 'FAILED'} in ${Date.now() - t0} ms: ${result.ticks} ticks\n${result.error ?? ''}\n${report()}\n` };
}

function moveCheckpoint(lines: string): string {
  readModes(lines);
  // A few idle ticks (written to the replay) reach a point where the game can save.
  let wait = 0;
  while (!game.canSave() && !game.inBattle() && !game.scripts.running() && wait < 90) {
    game.tick();
    wait++;
  }
  const extra = wait ? `+${wait} release select\n` : '';
  if (extra) appendFileSync(`${REPLAYS}/${name}`, extra);
  if (!game.canSave() || game.inBattle()) {
    cp.pending += `\n${lines}\n${extra}`;
    return `checkpoint kept (cannot save here); lines pending (${cp.pending.split('\n').length} lines)\n`;
  }
  cp = { save: base.save() as string, battles: lastBattles, wild: modes.wild, evolve: modes.evolve, pending: '' };
  return `checkpoint moved${wait ? ` after ${wait} idle ticks` : ''}\n`;
}

// Start: the replay so far from its parent's anchor.
{
  const anchor = await chainAnchor(prefix, seed);
  const t0 = Date.now();
  const anchored = anchoredDriver(base, anchor);
  const keep: ReplayDriver = { ...anchored, reset: async (sd) => ((lastBattles = structuredClone(game.battles) as BattleLogEntry[]), anchored.reset(sd)) };
  const result = await runReplay(keep, anchoredText(name, prefix), { registries: game.registries, seed, name, repeat: false, resolve: (f) => ({ name: f, text: readReplay(f) }) });
  console.log(`${name} so far: ${result.ok ? 'OK' : 'FAILED'} ${result.ticks} ticks in ${Date.now() - t0} ms ${result.error ?? ''}`);
  if (!result.ok) process.exit(1);
  readModes(readReplay(name));
  let wait = 0;
  while (!game.canSave() && wait < 600) {
    game.tick();
    wait++;
  }
  if (!game.canSave()) throw new Error('the replay so far must end where the game can save');
  if (wait) console.log(`(${wait} idle ticks after the load: not written)`);
  cp = { save: base.save() as string, battles: lastBattles, wild: modes.wild, evolve: modes.evolve, pending: '' };
  console.log(report());
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      try {
        if (url.pathname === '/try') res.end((await play(body)).text);
        else if (url.pathname === '/commit') {
          const r = await play(body);
          if (r.ok) {
            appendFileSync(`${REPLAYS}/${name}`, body.endsWith('\n') ? body : `${body}\n`);
            res.end(`${r.text}committed; ${moveCheckpoint(body)}`);
          } else res.end(`${r.text}NOT committed\n`);
        } else if (url.pathname === '/to') {
          await play('');
          const s = game.state;
          const zone = game.registries.zones.get(s.player.zone)!;
          const grid = new MapGrid(game.registries, game.registries.matrices.get(zone.matrix) as Matrix);
          const zones = [...game.registries.zones.values()].filter((z) => z.matrix === zone.matrix);
          res.end(walkLines(game, grid, zones, Number(url.searchParams.get('x')), Number(url.searchParams.get('z'))).join('\n') + '\n');
        } else if (url.pathname === '/js') {
          // Debugging: a function body run with the game after the last try (`game` in scope).
          res.end(`${JSON.stringify(new Function('game', body)(game), null, 1)}\n`);
        } else res.end(report() + '\n');
      } catch (e) {
        res.end(`ERROR ${(e as Error).stack}\n`);
      }
    })();
  });
}).listen(port, () => console.log(`session on http://localhost:${port}`));
