/**
 * The import's Distortion World as contracts records (0.27.18, `distortion.ts`): one `distortionRooms` record
 * per room, keyed by its zone, and `NewGame.distortionWorld`. Units stay the source's (tiles, fx32 steps);
 * object heights become world units, prop kinds names.
 */
import type { DistortionRoom, DistortionWorldTables, DwCommand, DwCondition, DwPropKind } from '@opensinnoh/contracts';
import { DW_PROP_KINDS } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { DistortionFormatError, type DistortionWorld, type DwRoomCommand } from './index.ts';

const prop = (kind: number): DwPropKind => DW_PROP_KINDS[kind] ?? fail(`prop kind ${kind}`);
const fail = (what: string): never => {
  throw new DistortionFormatError(what);
};
const cond = (kind: DwCondition['kind'], value: number): DwCondition => ({ kind, value });

function command(c: DwRoomCommand, where: string): DwCommand {
  switch (c.kind) {
    case 'set-map-object-animation':
      return { kind: c.kind, localId: c.localId, action: c.actionName ?? fail(`${where}: action ${c.action} has no name`) };
    case 'move-platform':
      return { kind: c.kind, platform: c.platform, movePlayer: c.movePlayer, finalOffset: c.finalOffset, step: c.step };
    case 'add-map-object':
      return { kind: c.kind, zone: c.zone ?? fail(`${where}: no zone`), localId: c.localId };
    case 'start-script':
      return { kind: c.kind, label: c.label ?? fail(`${where}: script ${c.script} has no label`) };
    default:
      return c;
  }
}

/** `sprite(gfx)` names an object's sprite record (and makes sure it is imported). */
export function distortionRecords(world: DistortionWorld, sprite: (gfx: number) => Id): { rooms: DistortionRoom[]; tables: Omit<DistortionWorldTables, 'playerSprite' | 'playerSurfSprite' | 'props' | 'sky'> } {
  const rooms = world.rooms.map((r): DistortionRoom => ({
    id: r.zone,
    offset: r.offset,
    previous: r.previous,
    next: r.next,
    supports: r.supports.map((s) => ({ kind: s.kind, box: s.bounds, vertical: s.tilesVertical, horizontal: s.tilesHorizontal, cells: s.cells })),
    jumps: r.jumpPoints.map((j) => ({
      facing: j.facing,
      box: j.bounds,
      displacement: j.displacement,
      spriteRotation: j.spriteRotation,
      steps: j.steps,
      axis: j.axis,
      inverted: j.inverted,
      finalFacing: j.finalFacing,
      to: j.toKind,
      support: j.toSupport,
    })),
    cameraRows: r.cameraRows.map((c) => ({ box: c.bounds, facing: c.facing, angle: c.angle, steps: c.steps })),
    ghosts: r.ghostProps && {
      visible: r.ghostProps.defaultVisible,
      props: r.ghostProps.props.map((p) => ({ group: p.group, prop: prop(p.kind), x: p.x, y: p.y, z: p.z })),
      triggers: r.ghostProps.triggers.map((t) => ({ group: t.group, facing: t.facing, show: t.show, box: t.bounds })),
    },
    movingPlatforms: r.movingPlatforms.map((p) => ({
      index: p.index,
      x: p.x,
      y: p.y,
      z: p.z,
      elevator: p.elevatorPath === null ? null : { path: p.elevatorPath, direction: p.elevatorDirection },
      destination: p.destination,
      prop: prop(p.prop),
      flag: p.flag,
    })),
    events: r.events.map((e, i) => ({ x: e.x, y: e.y, z: e.z, when: cond(e.condition, e.value), commands: e.commands.map((c, k) => command(c, `${r.zone} event ${i} command ${k}`)) })),
    props: r.simpleProps.map((p) => ({ prop: prop(p.prop), x: p.x, y: p.y, z: p.z, when: cond(p.condition, p.value) })),
    objects: r.objects.map((o) => ({
      localId: o.localId,
      sprite: sprite(o.gfx),
      movementType: o.movementType,
      trainerType: o.trainerType,
      ...(o.hideFlag ? { hideFlag: o.hideFlag } : {}),
      ...(o.label ? { label: o.label } : {}),
      facing: o.facing,
      data: o.data,
      range: o.range,
      x: o.x,
      z: o.z,
      y: o.y / 4096,
      when: cond(o.condition, o.value),
      rotation: o.rotated ? o.rotation : null,
    })),
  }));
  const plain = (c: DwRoomCommand, i: number) => command(c, `waterfall command ${i}`);
  return { rooms, tables: { elevatorPaths: world.elevatorPaths, cascadeUp: world.cascadeUp.map(plain), cascadeDown: world.cascadeDown.map(plain) } };
}
