/** Sprite-pipeline companions and the seven single-command moves. Original task choreography. */
import { battler, dirX, task, type Func } from './tasks.ts';
import { PokeCopy, type AnimVm } from './vm.ts';

/** Finite task with an explicit final state; End and WaitForAnimTasks wait for it. */
function timed(vm: AnimVm, frames: number, update: (tick: number) => void, finish: () => void): void {
  let tick = 0;
  task(vm, () => {
    if (tick >= frames) { finish(); return false; }
    update(tick++);
    return true;
  });
}

function suppressCopies(vm: AnimVm, battler: number): () => void {
  const copies = vm.pokemonSprites.flatMap((c) => c?.battler === battler ? [{ c, visible: c.visible }] : []);
  for (const { c } of copies) c.visible = false;
  return () => { for (const { c, visible } of copies) c.visible = visible; };
}

export const SPRITE_COMPANION_FUNCS: Record<string, Func> = {
  BattlerPartialDraw: (vm) => {
    const s = battler(vm, vm.vars[0]!);
    if (!s) return;
    const step = vm.vars[3]!;
    const interval = vm.vars[4]!;
    if (!step) throw new Error('battle anim: BattlerPartialDraw has zero step');
    const y = s.baseY;
    let crop = step > 0 ? 0 : 80;
    let counter = 0;
    s.cropBottom = crop;
    s.y = y + crop;
    s.hide = false;
    task(vm, () => {
      if (counter++ < interval) return true;
      counter = 0;
      crop = Math.max(0, Math.min(80, crop + step));
      s.cropBottom = crop;
      s.y = y + crop;
      return step > 0 ? crop < 80 : crop > 0;
    });
  },
  Mimic: (vm) => {
    const a = vm.sprite(vm.attacker), b = vm.sprite(vm.defender);
    const restore = suppressCopies(vm, vm.defender);
    const copy = new PokeCopy(vm.defender, b.x, b.y);
    // Slot 4 is reserved for the effect's copy; the regular battler copies use 0–3.
    vm.pokemonSprites[4] = copy;
    copy.xlu = true;
    timed(vm, 48, (t) => {
      const p = t / 47;
      copy.x = b.x + (a.x - b.x) * p;
      copy.y = b.y + (a.y - b.y) * p - Math.sin(p * Math.PI) * 20;
      copy.scaleX = copy.scaleY = Math.round(256 - p * 160);
      copy.fade = Math.round(p * 12);
      copy.fadeColor = 0x7fff;
    }, () => { vm.pokemonSprites[4] = null; restore(); });
  },
  Camouflage: (vm) => {
    const s = vm.sprite(vm.attacker);
    const restore = suppressCopies(vm, vm.attacker);
    // Palette-only camouflage: cycle natural hues, then return to the battler's original palette.
    const colors = [0x03e0, 0x02ff, 0x7c00];
    timed(vm, 72, (t) => {
      s.fadeColor = colors[Math.floor(t / 24)]!;
      s.fadeAmount = Math.round(Math.sin((t % 24) / 23 * Math.PI) * 14);
    }, () => { s.fadeAmount = 0; restore(); });
  },
  FaintAttack: (vm) => {
    const s = vm.sprite(vm.attacker);
    const x = s.x, y = s.y;
    const direction = dirX(vm, vm.attacker);
    const restore = suppressCopies(vm, vm.attacker);
    timed(vm, 64, (t) => {
      s.alpha = t < 16 ? Math.round(31 * (1 - t / 16)) : t < 40 ? 0 : Math.round(31 * (t - 40) / 23);
      s.x = t < 32 ? x + t * 2 * direction : x - (64 - t) * direction;
      s.hide = t >= 16 && t < 40;
    }, () => { s.x = x; s.y = y; s.hide = false; s.alpha = 31; restore(); });
  },
  Memento: (vm) => {
    const s = vm.sprite(vm.attacker);
    suppressCopies(vm, vm.attacker);
    const y = s.y;
    timed(vm, 64, (t) => {
      s.fadeAmount = Math.min(16, Math.floor(t / 2)); s.fadeColor = 0;
      s.scaleX = s.scaleY = Math.max(1, Math.round(256 * (1 - t / 64)));
      s.y = y - t / 2;
    }, () => { s.hide = true; s.y = y; s.scaleX = s.scaleY = 256; s.fadeAmount = 0; });
  },
  Snatch: (vm) => {
    const s = battler(vm, vm.vars[0]!);
    if (!s) return;
    const x = s.x, y = s.y;
    timed(vm, 48, (t) => {
      const p = Math.sin(t / 47 * Math.PI);
      s.x = x + p * 48 * dirX(vm, s.battler);
      s.y = y - p * 12;
      s.rotation = Math.round(p * dirX(vm, s.battler) * 4096);
    }, () => { s.x = x; s.y = y; s.rotation = 0; });
  },
  Swagger: (vm) => {
    const s = vm.sprite(vm.attacker);
    const y = s.y;
    timed(vm, 48, (t) => { s.y = y - Math.abs(Math.sin(t * Math.PI / 16)) * 10; s.rotation = Math.round(Math.sin(t / 6) * 1800); }, () => { s.y = y; s.rotation = 0; });
  },
  FakeOutCurtain: (vm) => {
    timed(vm, 64, (t) => {
      const extent = t < 16 ? t * 4 : t < 40 ? 64 : Math.max(0, (64 - t) * 64 / 24);
      vm.curtain = { top: extent, bottom: extent };
    }, () => { vm.curtain = null; });
  },
  FakeOut: (vm) => {
    const s = vm.sprite(vm.defender);
    const x = s.x;
    timed(vm, 32, (t) => { s.x = x + Math.sin(t * Math.PI / 2) * 4; }, () => { s.x = x; });
  },
};

/** The operand is a BATTLE_ANIM_* target mask, not a battler role. */
export function startBattlerSlideIn(vm: AnimVm, targets: number): void {
  const s = battler(vm, targets);
  if (!s) return;
  const x = s.baseX, y = s.baseY;
  const start = x - dirX(vm, s.battler) * 96;
  s.hide = false;
  s.y = y;
  s.cropBottom = 0;
  timed(vm, 16, (t) => { s.x = start + (x - start) * (t + 1) / 16; }, () => { s.x = x; });
}
