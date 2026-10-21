/**
 * The Distortion World import: the three tornworld archives and the overlay 9 tables,
 * joined per room and cross-checked, plus a per-room inventory and the fields still opaque.
 *
 * Output (`distortion-world.json`, a pack asset until contracts 0.27 gives it records): one entry per
 * room in tw_arc order, each with its zone id, world offset, neighbours, supports (with their terrain
 * cells), jump points, camera rows, ghost props, moving platforms, events, simple props and objects;
 * and the shared elevator paths, the waterfall command lists and the sky summary. Values keep their
 * source units (see tw-arc.ts and overlay9.ts); script ids, object graphics, movement actions and map
 * headers also carry their resolved names.
 */
import type { Id } from '@opensinnoh/core';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { readOverlayTables, type DwElevatorPath, type DwEvent, type DwEventCommand, type DwMovingPlatform, type DwObject, type DwSimpleProp, type Overlay9Layout } from './overlay9.ts';
import { readMapInfo, readRoomFile, DistortionFormatError, SUPPORT_KINDS, type DwRoomFile, type DwSupport } from './tw-arc.ts';
import { ATTR_UNREAD, readAttrGrid } from './tw-attr.ts';
import { readSky, type DwSky } from './tw-etc.ts';

export * from './overlay9.ts';
export * from './tw-arc.ts';
export * from './tw-attr.ts';
export * from './tw-etc.ts';

/** Decomp `PropKind`, in order (names, lower-cased). */
export const PROP_KINDS = [
  'small-platform',
  'floating-blue-rock',
  'medium-elevator-platform-1',
  'medium-elevator-platform-2',
  'medium-elevator-platform-sw',
  'medium-moving-platform-1',
  'medium-moving-platform-2',
  'medium-elevator-platform-3',
  'large-elevator-platform-1',
  'medium-elevator-platform-4',
  'horizontal-platform-1',
  'vertical-platform-1',
  'vertical-platform-2',
  'horizontal-platform-2',
  'rotated-platform-east',
  'rotated-platform-west',
  'large-elevator-platform-2',
  'large-elevator-platform-3',
  'large-elevator-platform-4',
  'medium-elevator-platform-5',
  'giratina-shadow',
  'waterfall',
  'land-vine-flower',
  'land-rock',
  'portal',
] as const;

export const ARCHIVES = { main: '/fielddata/tornworld/tw_arc.narc', attr: '/fielddata/tornworld/tw_arc_attr.narc', sky: '/data/tw_arc_etc.narc' };

/** What the import needs from the rest of the importer (names and script resolution). */
export interface DistortionDeps {
  /** MAP_HEADER_COUNT: the tables' "no map". */
  mapCount: number;
  zone(mapHeader: number): Id;
  /** A script id of an object or a start-script command, resolved in the room's script file. */
  label(mapHeader: number, script: number, where: string): Id | undefined;
  gfx(gfx: number): string | undefined;
  movement(action: number): string | undefined;
  flag(flag: number): Id;
}

export type DwRoomCommand = DwEventCommand & { label?: Id; actionName?: string; zone?: Id };

export interface DwRoom {
  zone: Id;
  mapHeader: number;
  file: number;
  offset: { x: number; altitude: number; z: number };
  previous: Id | null;
  next: Id | null;
  unknown00: number;
  supports: (DwSupport & { cells: number[] })[];
  jumpPoints: DwRoomFile['jumpPoints'];
  cameraRows: DwRoomFile['cameraRows'];
  ghostProps: DwRoomFile['ghostProps'];
  movingPlatforms: DwMovingPlatform[];
  events: (Omit<DwEvent, 'commands'> & { commands: DwRoomCommand[] })[];
  simpleProps: DwSimpleProp[];
  objects: (DwObject & { sprite?: string; label?: Id; hideFlag?: Id })[];
}

export interface DistortionWorld {
  rooms: DwRoom[];
  elevatorPaths: DwElevatorPath[];
  cascadeUp: DwEventCommand[];
  cascadeDown: DwEventCommand[];
  sky: DwSky;
}

/** One line of the inventory per room, and each opaque field with the distinct values it holds. */
export interface DistortionAudit {
  rooms: { zone: Id; supports: Record<string, number>; jumpPoints: number; cameraRows: number; ghostGroups: number; ghostProps: number; ghostTriggers: number; movingPlatforms: number; events: number; commands: Record<string, number>; simpleProps: number; objects: number }[];
  opaque: { field: string; values: number[] }[];
}

export function importDistortionWorld(fs: NitroFs, region: Uint8Array, regionStart: number, layout: Overlay9Layout, deps: DistortionDeps): { world: DistortionWorld; audit: DistortionAudit } {
  const ov9 = fs.overlays().find((o) => o.id === 9);
  if (!ov9) throw new DistortionFormatError('no overlay 9');
  const tables = readOverlayTables(region, regionStart, ov9.ramAddress, layout, deps.mapCount);
  const main = readNarc(fs.file(ARCHIVES.main));
  const attrs = readNarc(fs.file(ARCHIVES.attr));
  const infos = readMapInfo(main[0]!);
  if (main.length !== infos.length + 1) throw new DistortionFormatError(`tw_arc: ${main.length} members for ${infos.length} rooms`);

  const opaque = new Map<string, Set<number>>();
  const note = (field: string, v: number) => {
    let s = opaque.get(field);
    if (!s) opaque.set(field, (s = new Set()));
    s.add(v);
  };
  const byMap = <T extends { mapHeader: number }>(rows: T[], what: string) => {
    const m = new Map<number, T>();
    for (const row of rows) {
      if (!infos.some((i) => i.mapHeader === row.mapHeader)) throw new DistortionFormatError(`${what}: map header ${row.mapHeader} is not a Distortion World room`);
      if (m.has(row.mapHeader)) throw new DistortionFormatError(`${what}: map header ${row.mapHeader} twice`);
      m.set(row.mapHeader, row);
    }
    return m;
  };
  const connections = byMap(tables.connections, 'sDistWorldMapConnectionList');
  const platforms = byMap(tables.movingPlatforms, 'sMovingPlatformsMapTemplates');
  const events = byMap(tables.events, 'sMapEvents');
  const simple = byMap(tables.simpleProps, 'sSimplePropsMapTemplates');
  const objects = byMap(tables.objects, 'sMapObjectEvents');
  const optZone = (h: number | null) => (h === null ? null : deps.zone(h));
  const command = (c: DwEventCommand, mapHeader: number, where: string): DwRoomCommand => {
    if (c.kind === 'start-script') {
      const label = deps.label(mapHeader, c.script, where);
      if (!label) throw new DistortionFormatError(`${where}: script ${c.script} has no label`);
      return { ...c, label };
    }
    if (c.kind === 'set-map-object-animation') {
      const name = deps.movement(c.action);
      if (!name) throw new DistortionFormatError(`${where}: movement action ${c.action} has no name`);
      return { ...c, actionName: name };
    }
    if (c.kind === 'add-map-object') return { ...c, zone: deps.zone(c.mapHeader) };
    if (c.kind === 'move-platform') note('move-platform unknown04', c.unknown04);
    return c;
  };

  const rooms = infos.map((info): DwRoom => {
    const zone = deps.zone(info.mapHeader);
    const conn = connections.get(info.mapHeader);
    if (!conn) throw new DistortionFormatError(`${zone}: not in sDistWorldMapConnectionList`);
    const file = readRoomFile(main[info.file + 1] ?? new Uint8Array(), `tw_arc ${zone}`);
    note('room file unknown00', file.unknown00);
    for (const j of file.jumpPoints) note('jump point unknown04', j.unknown04);
    const supports = file.supports.map((s, i) => {
      const bytes = attrs[s.attr];
      if (!bytes) throw new DistortionFormatError(`${zone} support ${i}: tw_arc_attr member ${s.attr} of ${attrs.length}`);
      const cells = readAttrGrid(bytes, s, `${zone} support ${i} (tw_arc_attr ${s.attr})`);
      for (const c of cells) if (c & ATTR_UNREAD) note('terrain cell bits 8–14', c & ATTR_UNREAD);
      return { ...s, cells: [...cells] };
    });
    for (const g of file.ghostProps?.props ?? []) if (g.group >= 24) throw new DistortionFormatError(`${zone}: ghost group ${g.group} beyond the 24-bit mask`);
    for (const g of file.ghostProps?.triggers ?? []) if (g.group >= 24) throw new DistortionFormatError(`${zone}: ghost trigger group ${g.group} beyond the 24-bit mask`);
    return {
      zone,
      mapHeader: info.mapHeader,
      file: info.file,
      offset: info.offset,
      previous: optZone(conn.previous),
      next: optZone(conn.next),
      unknown00: file.unknown00,
      supports,
      jumpPoints: file.jumpPoints,
      cameraRows: file.cameraRows,
      ghostProps: file.ghostProps,
      movingPlatforms: platforms.get(info.mapHeader)?.platforms ?? [],
      events: (events.get(info.mapHeader)?.events ?? []).map((e, i) => ({ ...e, commands: e.commands.map((c, k) => command(c, info.mapHeader, `${zone} event ${i} command ${k}`)) })),
      simpleProps: (simple.get(info.mapHeader)?.props ?? []).map((p) => {
        note('simple prop unknown00', p.unknown00);
        return p;
      }),
      objects: (objects.get(info.mapHeader)?.objects ?? []).map((o, i) => {
        const where = `${zone} object ${i}`;
        const label = deps.label(info.mapHeader, o.script, where);
        if (o.script && !label) throw new DistortionFormatError(`${where}: script ${o.script} has no label`);
        const sprite = deps.gfx(o.gfx);
        if (!sprite) throw new DistortionFormatError(`${where}: object gfx ${o.gfx} has no name`);
        return { ...o, sprite, ...(label ? { label } : {}), ...(o.hiddenFlag ? { hideFlag: deps.flag(o.hiddenFlag) } : {}) };
      }),
    };
  });
  for (const [i, path] of tables.elevatorPaths.entries()) if (path.next !== null && path.next === i) throw new DistortionFormatError(`elevator path ${i} continues into itself`);
  for (const r of rooms) for (const p of r.movingPlatforms) if (p.elevatorPath !== null && !tables.elevatorPaths[p.elevatorPath]) throw new DistortionFormatError(`${r.zone}: elevator path ${p.elevatorPath}`);

  const world: DistortionWorld = {
    rooms,
    elevatorPaths: tables.elevatorPaths,
    cascadeUp: tables.cascadeUp,
    cascadeDown: tables.cascadeDown,
    sky: readSky(readNarc(fs.file(ARCHIVES.sky))),
  };
  return { world, audit: { rooms: rooms.map(inventoryOf), opaque: [...opaque].map(([field, values]) => ({ field, values: [...values].sort((a, b) => a - b) })) } };
}

function inventoryOf(r: DwRoom): DistortionAudit['rooms'][number] {
  const supports = Object.fromEntries(SUPPORT_KINDS.map((k) => [k, r.supports.filter((s) => s.kind === k).length]).filter(([, n]) => n));
  const groups = new Set([...(r.ghostProps?.props ?? []), ...(r.ghostProps?.triggers ?? [])].map((g) => g.group));
  const commands: Record<string, number> = {};
  for (const e of r.events) for (const c of e.commands) commands[c.kind] = (commands[c.kind] ?? 0) + 1;
  return {
    zone: r.zone,
    supports,
    jumpPoints: r.jumpPoints.length,
    cameraRows: r.cameraRows.length,
    ghostGroups: groups.size,
    ghostProps: r.ghostProps?.props.length ?? 0,
    ghostTriggers: r.ghostProps?.triggers.length ?? 0,
    movingPlatforms: r.movingPlatforms.length,
    events: r.events.length,
    commands,
    simpleProps: r.simpleProps.length,
    objects: r.objects.length,
  };
}

/** The inventory as text, one block per room (printed by `opensinnoh import`). */
export function formatDistortionAudit(a: DistortionAudit): string {
  const kv = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  const lines = ['Distortion World:'];
  for (const r of a.rooms) {
    lines.push(`  ${r.zone.replace(/^platinum:MAP_HEADER_/, '')}: supports ${kv(r.supports)}; jump points ${r.jumpPoints}; camera rows ${r.cameraRows}; ghost groups ${r.ghostGroups} (${r.ghostProps} props, ${r.ghostTriggers} triggers)`);
    lines.push(`    moving platforms ${r.movingPlatforms}; events ${r.events} (${kv(r.commands)}); simple props ${r.simpleProps}; objects ${r.objects}`);
  }
  lines.push(`  opaque fields: ${a.opaque.map((o) => `${o.field} {${o.values.join(', ')}}`).join('; ') || 'none'}`);
  return lines.join('\n');
}
