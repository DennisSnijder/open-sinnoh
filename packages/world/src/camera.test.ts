import { describe, expect, it } from 'vitest';
import { LOCALID_PLAYER } from '@opensinnoh/contracts';
import { newState, setup } from './testing.ts';
import { ELEVATOR_LOOP_TICKS } from './camera.ts';

const actor = (g: ReturnType<typeof setup>, id: number) => g.world.view().actors.find((a) => a.localId === id)!;

describe('shake_object (decomp MapObject_Shake, Task_ShakeMapObject)', () => {
  it('offsets the sprite by sin(degrees) × x/z for `times` turns of 360°, then clears; the position is unchanged', () => {
    const g = setup(newState('TOWN', 38, 16));
    const rest = [...actor(g, 0).cur];
    const state = structuredClone(g.state.objects[0]);
    g.world.shakeObject(0, 2, 90, 3, 0);
    expect(g.world.shakeObjectDone()).toBe(false);
    const xs: number[] = [];
    let ticks = 0;
    while (!g.world.shakeObjectDone()) {
      g.tick();
      ticks++;
      xs.push(Math.round((actor(g, 0).cur[0] - rest[0]!) * 1000) / 1000);
    }
    // 0°, 90°, 180°, 270° twice; the last frame clears the offset.
    expect(ticks).toBe(8);
    expect(xs).toEqual([0, 3, 0, -3, 0, 3, 0, 0]);
    expect(actor(g, 0).cur).toEqual(rest);
    expect(g.state.objects[0]).toEqual(state);
  });
});

describe('move_camera (decomp ScrCmd_MoveCamera)', () => {
  it('camera offsets add up; the player sprite takes the last offset; a map load clears both', () => {
    const g = setup(newState('TOWN', 38, 16));
    const rest = [...actor(g, LOCALID_PLAYER).cur];
    g.world.moveCamera(8, 0, 0);
    g.world.moveCamera(8, 0, 4);
    expect(g.world.view().cameraOffset).toEqual([16, 0, 4]);
    expect(actor(g, LOCALID_PLAYER).cur).toEqual([rest[0]! + 8, rest[1], rest[2]! + 4]);
    expect(g.state.player).toMatchObject({ x: 38, z: 16 });
    g.world.warp(g.state.player.zone, 38, 16, 'down');
    g.settle();
    expect(g.world.view().cameraOffset).toEqual([0, 0, 0]);
    expect(actor(g, LOCALID_PLAYER).cur).toEqual(rest);
  });
});

describe('play_elevator_animation (decomp FieldTask_PlayElevatorAnimation)', () => {
  it('waits two setup frames plus `loops` runs of the 31-frame lights', () => {
    const g = setup(newState('TOWN', 38, 16));
    g.world.elevator('up', 4);
    let ticks = 0;
    const lights: (number | undefined)[] = [];
    while (!g.world.elevatorDone()) {
      lights.push(g.world.view().elevatorLights?.tick);
      g.tick();
      ticks++;
    }
    expect(ticks).toBe(2 + 4 * ELEVATOR_LOOP_TICKS);
    // Two loading frames without lights, then the up animation counts its frames over all four loops.
    expect(lights.slice(0, 3)).toEqual([undefined, undefined, 0]);
    expect(lights[lights.length - 1]).toBe(4 * ELEVATOR_LOOP_TICKS - 1);
    expect(g.world.view().elevatorLights).toBeUndefined();
    expect(g.stubs).not.toContain('elevator-lights');
    g.world.elevator('down', 1);
    g.hold([], 2);
    expect(g.world.view().elevatorLights).toEqual({ direction: 'down', tick: 0 });
    expect(() => g.world.elevator('up', 1)).toThrow(/another ride/);
    g.hold([], ELEVATOR_LOOP_TICKS);
    expect(() => g.world.elevator('down', 0)).toThrow(/at least 1/);
  });
});
