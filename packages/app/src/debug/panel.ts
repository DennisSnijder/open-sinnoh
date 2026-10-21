import type { Id } from '@opensinnoh/core';
import { DEV_EVENTS } from '@opensinnoh/contracts';
import type { Session } from '../boot.ts';
import type { CheckpointEntry } from '../../../../tools/dev-checkpoints.ts';
import { debugActions } from './actions.ts';
import './panel.css';

/** Mounted only by the DEV + URL gate. No game art or game-style UI. */
export function mountDebugPanel(session: () => Session, releaseKeys: () => void): void {
  const actions = debugActions(session);
  const panel = document.createElement('details');
  panel.id = 'dev-debug';
  const summary = document.createElement('summary');
  summary.textContent = 'Developer tools';
  panel.append(summary);
  panel.addEventListener('focusin', releaseKeys);
  panel.addEventListener('pointerdown', releaseKeys);
  const status = document.createElement('output');
  status.setAttribute('role', 'status');
  // Keep game shortcuts out of the developer controls, including buttons and the summary.
  for (const name of ['keydown', 'keyup', 'pointerdown', 'pointerup'] as const) panel.addEventListener(name, (e) => e.stopPropagation());
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { panel.open = false; summary.focus(); }
  });
  let busy = false;
  const run = async (action: () => void | Promise<void>) => {
    if (busy) { status.textContent = 'Busy: the last action is still running.'; return; }
    busy = true;
    try { status.textContent = 'Working…'; await action(); if (status.textContent === 'Working…') status.textContent = 'Done.'; }
    catch (e) { status.textContent = (e as Error).message; console.error('debug panel:', e); }
    finally { busy = false; }
  };
  function form(): HTMLFormElement {
    const el = document.createElement('form');
    panel.append(el);
    el.addEventListener('submit', (e) => e.preventDefault());
    return el;
  }
  function field(parent: HTMLElement, name: string, value = '', type = 'text'): HTMLInputElement {
    const label = document.createElement('label');
    label.textContent = name;
    const input = document.createElement('input');
    input.type = type; input.value = value; input.required = true;
    label.append(input); parent.append(label);
    return input;
  }
  function button(parent: HTMLElement, name: string, action: () => void | Promise<void>): void {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = name;
    el.addEventListener('click', () => void run(action)); parent.append(el);
  }
  function records(parent: HTMLElement, name: string, values: ReadonlyMap<Id, unknown>, initial = ''): HTMLInputElement {
    const input = field(parent, name, initial);
    const list = document.createElement('datalist'); list.id = `debug-${name}`;
    input.setAttribute('list', list.id);
    for (const id of values.keys()) { const opt = document.createElement('option'); opt.value = id; list.append(opt); }
    parent.append(list);
    return input;
  }
  const game = session().game;
  const warp = form();
  const map = records(warp, 'Map', game.registries.zones, game.state.player.zone);
  const x = field(warp, 'Tile X', String(game.state.player.x), 'number');
  const z = field(warp, 'Tile Z', String(game.state.player.z), 'number');
  button(warp, 'Warp', () => actions.warp(map.value, x.value, z.value));
  const flags = form();
  const flag = records(flags, 'Flag', game.registries.flags);
  button(flags, 'Read flag', () => {
    const g = session().game; const def = g.registries.flags.get(flag.value as Id);
    if (!def) throw new Error('Unknown flag');
    status.textContent = String(g.state.flags[def.id] ?? def.initial);
  });
  button(flags, 'Set flag', () => actions.flag(flag.value, true));
  button(flags, 'Clear flag', () => actions.flag(flag.value, false));
  button(flags, 'Reset flag', () => actions.flag(flag.value, null));
  const vars = form();
  const variable = records(vars, 'Var', game.registries.vars);
  const value = field(vars, 'Value', '0', 'number');
  button(vars, 'Read var', () => {
    const g = session().game; const def = g.registries.vars.get(variable.value as Id);
    if (!def) throw new Error('Unknown var');
    if (def.scope === 'temp') throw new Error('Script-local temporary vars are not part of GameState.');
    value.value = String(g.state.vars[def.id] ?? def.initial);
  });
  button(vars, 'Set var', () => actions.variable(variable.value, value.value));
  button(vars, 'Clear var', () => actions.variable(variable.value, null));
  const items = form();
  const item = records(items, 'Item', game.registries.items);
  const count = field(items, 'Count', '1', 'number');
  button(items, 'Give item', () => actions.item(item.value, count.value));
  const mons = form();
  const species = records(mons, 'Species', game.registries.species);
  const level = field(mons, 'Level', '5', 'number');
  button(mons, 'Give Pokémon', () => actions.pokemon(species.value, level.value));
  // The event-only content (Darkrai, Shaymin, Arceus, Rotom's forms, the Regis): the ROM's distribution var and key item, or a fateful Regigigas.
  const events = form();
  for (const name of Object.keys(DEV_EVENTS)) button(events, `Event: ${name}`, () => actions.event(name));
  const clock = form();
  const now = game.clock();
  const date = field(clock, 'Date', now.date, 'date');
  const time = field(clock, 'Time', `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`, 'time');
  button(clock, 'Freeze clock', () => actions.clock(date.value, time.value));
  const checkpoints = form();
  const label = document.createElement('label'); label.textContent = 'Story checkpoint';
  const select = document.createElement('select'); label.append(select); checkpoints.append(label);
  button(checkpoints, 'Refresh cache', refresh);
  button(checkpoints, 'Load checkpoint', async () => {
    if (!select.value) throw new Error('No checkpoint selected.');
    const response = await fetch(`/__opensinnoh/debug/checkpoints?id=${encodeURIComponent(select.value)}`);
    if (!response.ok) throw new Error(await response.text());
    await actions.checkpoint(await response.text());
  });
  async function refresh() {
    const response = await fetch('/__opensinnoh/debug/checkpoints');
    if (!response.ok) throw new Error(await response.text());
    const entries: CheckpointEntry[] = await response.json();
    select.replaceChildren(...entries.map((entry) => { const opt = document.createElement('option'); opt.value = entry.id; opt.textContent = entry.label; return opt; }));
  }
  panel.append(status);
  // Outside the field's touch-action:none surface so native forms and scrolling work on phones.
  document.body.append(panel);
  void run(refresh);
}
