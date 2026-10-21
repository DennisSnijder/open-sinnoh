/**
 * Generates the names-only reference tables the importer uses to give ROM records readable IDs:
 *   packages/importer/data/names.json   (constant names, message ids, script entry names)
 *   packages/importer/data/charmap.json (Gen 4 char code → Unicode character)
 *
 * Reads pret/pokeplatinum (no licence: names and structure only). It copies no game text, no code
 * and no data values beyond the indexes that key a name.
 *
 *   pnpm tsx tools/names/generate.ts [path/to/pokeplatinum]
 *
 * The decomp is found from the argument, $POKEPLATINUM_DIR, or the nearest `reference-projects/pokeplatinum`
 * above this file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CharmapFile, NamesFile, Runs } from '../../packages/importer/src/names.ts';

const outDir = resolve(import.meta.dirname, '../../packages/importer/data');

function findDecomp(): string {
  const arg = process.argv[2] ?? process.env.POKEPLATINUM_DIR;
  if (arg) return resolve(arg);
  for (let d = import.meta.dirname; d !== dirname(d); d = dirname(d)) {
    const p = join(d, 'reference-projects/pokeplatinum');
    if (existsSync(p)) return p;
  }
  throw new Error('pokeplatinum decomp not found; pass its path or set POKEPLATINUM_DIR');
}

const root = findDecomp();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const lines = (p: string) =>
  read(p)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

/** Evaluates a metang enum list (`NAME` or `NAME = <number | earlier NAME>`, C enum semantics). */
function evalEnum(path: string): Map<string, number> {
  const values = new Map<string, number>();
  let next = 0;
  for (const line of lines(path)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/.exec(line);
    if (!m) throw new Error(`${path}: cannot parse "${line}"`);
    const [, name, expr] = m as unknown as [string, string, string | undefined];
    let v = next;
    if (expr !== undefined) {
      if (/^\d+$/.test(expr)) v = Number(expr);
      else if (/^0x[0-9a-fA-F]+$/.test(expr)) v = Number(expr);
      else if (values.has(expr)) v = values.get(expr) as number;
      else throw new Error(`${path}: unknown expression "${expr}"`);
    }
    values.set(name, v);
    next = v + 1;
  }
  return values;
}

/** Dense name list from an enum: names with `prefix`, indexed by value; later aliases win. */
function denseNames(path: string, prefix: string, max = Infinity): (string | null)[] {
  const out: (string | null)[] = [];
  for (const [name, v] of evalEnum(path)) {
    if (!name.startsWith(prefix) || v > max) continue;
    while (out.length < v) out.push(null);
    out[v] = name;
  }
  return out;
}

/** Sparse runs: [[start, names...]] for contiguous value ranges. */
function toRuns(entries: [number, string][]): Runs {
  const sorted = [...new Map(entries).entries()].sort((a, b) => a[0] - b[0]);
  const runs: Runs = [];
  for (const [v, name] of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[0] + last[1].length === v) last[1].push(name);
    else runs.push([v, [name]]);
  }
  return runs;
}

/** Longest common prefix ending at "_", for compact per-file name lists. */
function commonPrefix(names: readonly string[]): string {
  if (names.length < 2) return '';
  let p = names[0] as string;
  for (const n of names) while (!n.startsWith(p)) p = p.slice(0, -1);
  const cut = p.lastIndexOf('_');
  return cut < 0 ? '' : p.slice(0, cut + 1);
}

function compact(names: readonly (string | null)[]): { prefix: string; names: (string | null)[] } {
  const prefix = commonPrefix(names.filter((n): n is string => n !== null));
  return { prefix, names: names.map((n) => (n === null ? null : n.slice(prefix.length))) };
}

// --- simple enums ---
const zones = lines('generated/map_headers.txt')
  .map((l) => l.split(/\s*=\s*/)[0] as string)
  .filter((n) => !['MAP_HEADER_COUNT', 'MAP_HEADER_INVALID', 'MAP_HEADER_DYNAMIC'].includes(n));
const species = denseNames('generated/species.txt', 'SPECIES_');
// Pokémon data enums: moves, abilities, natures, types, egg groups, exp rates, evolution methods,
// move classes/ranges/flags, battle effects, hold effects. Counters (`*_COUNT`, `NUM_*`, `MAX_*`) are left out.
const notCount = (n: string | null) => (n && /_COUNT$|^NUM_|^MAX_/.test(n) ? null : n);
const enumList = (path: string, prefix: string) => {
  const out = denseNames(path, prefix).map(notCount);
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
};
const moves = enumList('generated/moves.txt', 'MOVE_');
const abilities = enumList('generated/abilities.txt', 'ABILITY_');
const natures = enumList('generated/natures.txt', 'NATURE_');
const types = enumList('generated/pokemon_types.txt', 'TYPE_');
const eggGroups = enumList('generated/egg_groups.txt', 'EGG_GROUP_');
const expRates = enumList('generated/exp_rates.txt', 'EXP_RATE_');
const evolutionMethods = enumList('generated/evolution_methods.txt', 'EVO_');
const moveClasses = enumList('generated/move_classes.txt', 'CLASS_');
/** `enum MoveRange` (a mask: the first name is 0, name i ≥ 1 is bit i − 1) and `enum MoveFlag` (name i is bit i), in order. */
const moveRanges = lines('generated/move_ranges.txt');
const moveFlags = lines('generated/move_flags.txt');
const battleEffects = enumList('generated/move_battle_effects.txt', 'BATTLE_EFFECT_');
const holdEffects = enumList('generated/item_hold_effects.txt', 'HOLD_EFFECT_');
const martSpecialties = lines('generated/mart_specialties_id.txt');
/** Forms with their own pl_personal/wotbl member (res/pokemon/form_registry.json, type "data"), in member order from 496. */
const dataForms = Object.entries(JSON.parse(read('res/pokemon/form_registry.json')) as Record<string, Record<string, unknown>>).flatMap(([sp, forms]) =>
  Object.entries(forms)
    .filter(([, t]) => t === 'data')
    .map(([name], i) => ({ species: `SPECIES_${sp.toUpperCase()}`, form: i + 1, name: name.toUpperCase() })),
);
const items = denseNames('generated/items.txt', 'ITEM_');
const trainers = denseNames('generated/trainers.txt', 'TRAINER_');
const trainerClasses = denseNames('generated/trainer_classes.txt', 'TRAINER_CLASS_');
const trainerMessageTypes = toRuns([...evalEnum('generated/trainer_message_types.txt')].filter(([n]) => n.startsWith('TRMSG_')).map(([n, v]) => [v, n]));
// pl_enc_data members in NARC order (res/field/encounters/encounters.order).
const encounters = lines('res/field/encounters/encounters.order');

/** `enum TileBehavior` (C enum: implicit values count up from the last explicit one). */
const tileBehaviors: (string | null)[] = [];
{
  const body = /enum TileBehavior \{([^}]*)\}/.exec(read('include/constants/field/map_tile_behaviors.h'))?.[1];
  if (!body) throw new Error('enum TileBehavior not found');
  let next = 0;
  for (const raw of body.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const m = /^(TILE_BEHAVIOR_\w+)(?:\s*=\s*(0x[0-9a-fA-F]+|\d+))?$/.exec(entry);
    if (!m) throw new Error(`TileBehavior: cannot parse "${entry}"`);
    const v = m[2] !== undefined ? Number(m[2]) : next;
    while (tileBehaviors.length < v) tileBehaviors.push(null);
    tileBehaviors[v] = m[1] as string;
    next = v + 1;
  }
}
const movementActions = toRuns([...evalEnum('generated/movement_actions.txt')].filter(([n]) => n.startsWith('MOVEMENT_ACTION_')).map(([n, v]) => [v, n]));
const objectGfx = toRuns([...evalEnum('generated/object_events_gfx.txt')].filter(([n]) => n.startsWith('OBJ_EVENT_GFX_') && n !== 'OBJ_EVENT_GFX_SENTINEL_ID').map(([n, v]) => [v, n]));
const textBankNames = lines('generated/text_banks.txt');

const varsFlags = [...evalEnum('generated/vars_flags.txt')];
const flags = toRuns(varsFlags.filter(([n, v]) => n.startsWith('FLAG_') && v < 0x4000).map(([n, v]) => [v, n]));
const vars = toRuns(varsFlags.filter(([n, v]) => n.startsWith('VAR_') && v >= 0x4000).map(([n, v]) => [v, n]));

// Camera types and bag pockets come from small C headers.
const cameras = [...read('include/constants/camera_types.h').matchAll(/^\s*(CAMERA_TYPE_\w+),/gm)].map((m) => m[1] as string);
// Overworld weather values (field only: the Battle Frontier values ≥ 1000 and the YEARLY markers are left out).
const weathers: Runs = toRuns(
  [...read('include/constants/overworld_weather.h').matchAll(/^#define (OVERWORLD_WEATHER_\w+)\s+\(?(OVERWORLD_WEATHER_YEARLY_START \+ )?(\d+)\)?$/gm)]
    .filter((m) => Number(m[3]) < 1000 && !/^OVERWORLD_WEATHER_YEARLY_(START|END)$/.test(m[1]!))
    .map((m): [number, string] => [Number(m[3]) + (m[2] ? 32 : 0), m[1] as string]),
);
if (weathers.flatMap(([, n]) => n).length !== 28) throw new Error('overworld weather constants not found');
const pockets: string[] = [];
for (const m of read('include/constants/items.h').matchAll(/^#define (POCKET_\w+)\s+(\d+)$/gm)) {
  if (m[1] !== 'POCKET_MAX') pockets[Number(m[2])] = m[1] as string;
}

// --- text banks: message ids in order (never the text) ---
const textBanks = textBankNames.map((bank) => {
  const file = join(root, 'res/text', `${bank.replace(/^TEXT_BANK_/, '').toLowerCase()}.json`);
  if (!existsSync(file)) return { bank, prefix: '', messages: null };
  const json = JSON.parse(readFileSync(file, 'utf8')) as { messages: { id?: string }[] };
  const c = compact(json.messages.map((m) => m.id ?? null));
  return { bank, prefix: c.prefix, messages: c.names };
});

// --- script files: ScriptEntry names in order; a name used by several files keeps only its first file ---
const scriptOrder = lines('res/field/scripts/scripts.order');
const seenEntry = new Set<string>();
const scripts = scriptOrder.map((file) => {
  const src = read(`res/field/scripts/${file}.s`);
  const entries = [...src.matchAll(/^\s*ScriptEntry\s+(\w+)/gm)].map((m) => m[1] as string);
  const own = new Set<string>();
  const names = entries.map((e) => {
    if (seenEntry.has(e) && !own.has(e)) return null;
    own.add(e);
    return e;
  });
  for (const e of own) seenEntry.add(e);
  const c = compact(names);
  return { file, prefix: c.prefix, entries: c.names };
});

// Script id ranges (src/script_manager.c SCRIPT_RANGE_TABLE + include/script_manager.h offsets).
const offsets = new Map<string, number>();
for (const m of read('include/script_manager.h').matchAll(/^#define (SCRIPT_ID_OFFSET_\w+)\s+(\d+)$/gm)) offsets.set(m[1] as string, Number(m[2]));
const scriptRanges = [...read('src/script_manager.c').matchAll(/Entry\((SCRIPT_ID_OFFSET_\w+),\s*(\w+),\s*(TEXT_BANK_\w+)\)/g)].map((m) => {
  const base = offsets.get(m[1] as string);
  const file = scriptOrder.indexOf(m[2] as string);
  const bank = textBankNames.indexOf(m[3] as string);
  if (base === undefined || file < 0 || bank < 0) throw new Error(`script range ${m[0]} does not resolve`);
  return { base, file, bank };
});
if (scriptRanges.length < 20) throw new Error('script range table not found');

const names: NamesFile = {
  source: 'pret/pokeplatinum (names only)',
  zones,
  cameras,
  weathers,
  pockets,
  species,
  items,
  trainers,
  trainerClasses,
  trainerMessageTypes,
  encounters,
  tileBehaviors,
  movementActions,
  objectGfx,
  flags,
  vars,
  scriptRanges,
  textBanks,
  scripts,
  moves,
  abilities,
  natures,
  types,
  eggGroups,
  expRates,
  evolutionMethods,
  moveClasses,
  moveRanges,
  moveFlags,
  battleEffects,
  holdEffects,
  martSpecialties,
  dataForms,
};

/** One top-level key per line group, one list entry per line: small diffs, still compact. */
function writeCompactJson(path: string, value: Record<string, unknown>): void {
  const parts = Object.entries(value).map(([k, v]) => {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') return `${JSON.stringify(k)}: [\n${v.map((x) => JSON.stringify(x)).join(',\n')}\n]`;
    return `${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  writeFileSync(path, `{\n${parts.join(',\n')}\n}\n`);
}
writeCompactJson(join(outDir, 'names.json'), names as unknown as Record<string, unknown>);

// --- charmap: printable characters only; control codes are handled by the text decoder ---
const chars: [number, string][] = [];
for (const raw of read('tools/msgenc/charmap.txt').split('\n')) {
  const line = raw.replace(/^[ \t]+/, '');
  if (!line || line.startsWith('//')) continue;
  const eq = line.indexOf('=');
  const code = parseInt(line.slice(0, eq), 16);
  const ch = line.slice(eq + 1);
  if ([...ch].length !== 1) continue; // \x0000, \n, \r, \f and {COMMANDS}
  chars.push([code, ch]);
}
const charRuns: [number, string][] = [];
for (const [code, ch] of chars.sort((a, b) => a[0] - b[0])) {
  const last = charRuns[charRuns.length - 1];
  if (last && last[0] + [...last[1]].length === code) last[1] += ch;
  else charRuns.push([code, ch]);
}
const charmap: CharmapFile = { source: 'pret/pokeplatinum tools/msgenc/charmap.txt', runs: charRuns };
writeCompactJson(join(outDir, 'charmap.json'), charmap as unknown as Record<string, unknown>);

console.log(
  `names.json: ${zones.length} zones, ${textBanks.length} text banks, ${scripts.length} script files; charmap.json: ${chars.length} chars`,
);
