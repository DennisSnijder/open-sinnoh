import { asId, type Id } from '@opensinnoh/core';

/**
 * The battle animation script format (decomp include/data/scripts/btlanimcmd.h, asm/macros/btlanimcmd.inc,
 * btlanimfunc.inc): 32-bit words, an opcode and its operands. Three opcodes are variable: CallFunc
 * (function, count, count arguments), SetExtraParams (count, count words; read by the emitter callback of
 * the CreateEmitter before it) and AddSpriteWithFunc (eight words, count, count arguments). Jump operands
 * are word offsets from the operand that holds them.
 */

/** Opcode names (BTLANIMCMD_* order) and their fixed operand counts (−1: variable). */
export const OPCODES: readonly (readonly [name: string, operands: number])[] = [
  ['Delay', 1],
  ['WaitForAnimTasks', 0],
  ['BeginLoop', 1],
  ['EndLoop', 0],
  ['End', 0],
  ['PlaySoundEffect', 1],
  ['Nop0', 0],
  ['Nop1', 0],
  ['SetBg0Bg1AlphaBlending', 2],
  ['SetDefaultAlphaBlending', 0],
  ['Call', 1],
  ['Return', 0],
  ['SetVar', 2],
  ['JumpIfEffectChanceOdd', 2],
  ['JumpIfEffectChance', 2],
  ['Jump', 1],
  ['SwitchBg', 2],
  ['SetBgSwitchVar', 2],
  ['RestoreBg', 2],
  ['WaitForPartialBgSwitch', 0],
  ['WaitForBgSwitch', 0],
  ['SetBg', 1],
  ['PlayPannedSoundEffect', 2],
  ['PanSoundEffects', 1],
  ['PlayMovingSoundEffectAtkDef', 5],
  ['PlayLoopedSoundEffect', 4],
  ['PlayDelayedSoundEffect', 3],
  ['Nop2', 0],
  ['Nop3', 0],
  ['WaitForSoundEffects', 0],
  ['JumpIfEqual', 3],
  ['LoadPokemonSpriteIntoBg', 2],
  ['RemovePokemonSpriteFromBg', 1],
  ['JumpIfUnk_01', 1],
  ['SwitchBgEx', 3],
  ['PlayMovingSoundEffectNoCorrection', 5],
  ['PlayMovingSoundEffectAtkDef2', 5],
  ['Nop4', 0],
  ['Nop5', 0],
  ['Nop6', 0],
  ['Nop7', 0],
  ['Nop8', 0],
  ['Nop9', 0],
  ['Nop10', 0],
  ['StopSoundEffect', 1],
  ['CallFunc', -1],
  ['CreateEmitter', 3],
  ['CreateEmitterEx', 4],
  ['CreateEmitterForMove', 8],
  ['CreateEmitterForFriendlyFire', 6],
  ['WaitForAllEmitters', 0],
  ['LoadParticleSystem', 2],
  ['LoadDebugParticleSystem', 3],
  ['UnloadParticleSystem', 1],
  ['Nop11', 0],
  ['SetExtraParams', -1],
  ['InitPokemonSpriteManager', 0],
  ['LoadPokemonSpriteDummyResources', 1],
  ['AddPokemonSprite', 4],
  ['FreePokemonSpriteManager', 0],
  ['RemovePokemonSprite', 1],
  ['CancelTrackingTask', 1],
  ['SetCameraProjection', 2],
  ['SetCameraFlip', 2],
  ['JumpIfBattlerSide', 3],
  ['PlayPokemonCry', 3],
  ['WaitForPokemonCries', 1],
  ['ResetVars', 0],
  ['StartBattlerSlideIn', 1],
  ['StartBattlerSlideOut', 1],
  ['JumpIfWeather', 5],
  ['JumpIfContest', 1],
  ['JumpIfFriendlyFire', 1],
  ['InitSpriteManager', 8],
  ['LoadCharResObj', 2],
  ['LoadPlttRes', 3],
  ['LoadCellResObj', 2],
  ['LoadAnimResObj', 2],
  ['AddSpriteWithFunc', -1],
  ['AddSprite', 8],
  ['FreeSpriteManager', 1],
  ['SetPokemonSpriteVisible', 2],
  ['StartPokemonSpriteDrawTask', 3],
  ['StopPokemonSpriteDrawTask', 1],
  ['WaitForLRX', 0],
];
export const OP = Object.fromEntries(OPCODES.map(([name], i) => [name, i])) as Record<string, number>;

/** Native functions (decomp script_func_tables.c sBattleAnimScriptFuncs order). */
export const FUNCS: readonly string[] = [
  'Nop',
  'AnimExample',
  'SoundExample',
  'GenericExample',
  'RotateMon',
  'Strength',
  'BulkUp',
  'DoubleTeam',
  'QuickAttack',
  'DrillPeck',
  'Submission',
  'Confusion',
  'AcidArmor',
  'Growth',
  'Meditate',
  'Teleport',
  'Flash',
  'NightShadeAttacker',
  'NightShadeDefender',
  'Splash',
  'Spite',
  'Harden',
  'Minimize',
  'FaintAttack',
  'Earthquake',
  'PlayfulHops',
  'Nightmare',
  'Flail',
  'Magnitude',
  'Return',
  'VitalThrow',
  'Swagger',
  'Memento',
  'FadeBg',
  'FadeBattlerSprite',
  'ScalePokemonSprite',
  'Shake',
  'Extrasensory',
  'AlphaFadePokemonSprite',
  'OdorSleuth',
  'HideBattler',
  'FakeOutCurtain',
  'ScaleBattlerSprite',
  'FakeOut',
  'ScrollCustomBg',
  'MuddyWater',
  'Megahorn',
  'MegahornAttacker',
  'MegahornDefender',
  'Surf',
  'BlinkAttacker',
  'MoveBattlerX',
  'MoveBattlerX2',
  'ShakeAndScaleAttacker',
  'ShakeAndScaleAttacker2',
  'Camouflage',
  'Superpower',
  'MoveBattler',
  'Mimic',
  'ShadowPunch',
  'RevolveBattler',
  'MoveBattlerOffScreen',
  'MoveBattlerToDefaultPos',
  'FadePokemonSprite',
  'BattlerPartialDrawTest',
  'MoveEmitterA2BLinear',
  'MoveEmitterA2BParabolic',
  'BattlerPartialDraw',
  'ShakeBg',
  'PixelatePokemonSprite',
  'RolePlay',
  'Snatch',
  'RevolveEmitter',
  'MoveEmitterViewportTop',
  'SetBgGrayscale',
  'SetPokemonSpritePriority',
  'ScrollSwitchedBg',
  'MoveBattlerOnOrOffScreen',
  'RenderPokemonSprites',
  'Sketch',
  'StatChangeUp',
  'StatChangeDown',
  'StatChangeHeal',
  'StatChangeMetal',
];

/** Sprite callbacks of AddSpriteWithFunc (sBattleAnimSpriteFuncs order). */
export const SPRITE_FUNCS: readonly string[] = [
  'SpriteExample',
  'StringShot',
  'Kinesis',
  'Trick',
  'Metronome',
  'Constrict',
  'Bonemerang',
  'ScaryFace',
  'Foresight',
  'LockOn',
  'Swagger',
  'MeanLook',
  'Torment',
  'BatonPass',
  'Unused',
  'Grudge',
  'GrassWhistle',
  'IcicleSpear',
  'FakeOut',
  'Taunt',
  'HelpingHand',
  'Assist',
  'MetalClaw',
  'Ingrain',
  'FrenzyPlant',
  'OffsetAndAnimate',
  'FollowMe',
  'Fissure',
  'EscapeItem',
  'Sleep',
  'Burn',
  'Freeze',
  'ConfusionStatus',
];

/** The instruction's length in words at `pc` (opcode included); throws on an unknown opcode or a cut-off operand. */
export function instructionLength(code: readonly number[], pc: number): number {
  const op = code[pc];
  const entry = op === undefined ? undefined : OPCODES[op];
  if (!entry) throw new Error(`battle anim: unknown opcode ${op} at word ${pc}`);
  let n = entry[1];
  if (op === OP.CallFunc) n = 2 + word(code, pc + 2);
  else if (op === OP.SetExtraParams) n = 1 + word(code, pc + 1);
  else if (op === OP.AddSpriteWithFunc) n = 9 + word(code, pc + 9);
  if (pc + n >= code.length) throw new Error(`battle anim: ${entry[0]} at word ${pc} runs past the script's ${code.length} words`);
  return 1 + n;
}

function word(code: readonly number[], i: number): number {
  const v = code[i];
  if (v === undefined) throw new Error(`battle anim: operand ${i} past the script's end`);
  return v;
}

/** What a script uses on the paths a singles battle can take (contest and friendly-fire arms skipped): opcodes, functions, sprite callbacks. */
export interface ScriptUse {
  opcodes: Set<string>;
  funcs: Set<string>;
  spriteFuncs: Set<string>;
  /** Particle system members it loads. */
  particles: Set<number>;
  /** Distinct generic OBJ resource combinations requested on these paths. */
  spriteResources: Map<string, AnimSpriteResource>;
}

/**
 * Walks every instruction reachable from word 0 (both arms of each branch, except the arm of JumpIfContest, which a
 * battle never takes, and of JumpIfFriendlyFire only the one `friendlyFire` picks: the jump for a move at the user's
 * side, else on), decoding as it goes. JumpIfEqual and JumpIfUnk_01 hold absolute pointers in the decomp (never valid
 * in a file): their targets are not walked. 0.36.0: `contest` walks a contest's run instead: JumpIfContest's jump, and
 * of JumpIfBattlerSide only the arm of the performer (the player's side) and its target (the enemy's).
 */
export function scriptUse(code: readonly number[], friendlyFire = false, contest = false): ScriptUse {
  const use: ScriptUse = {
    opcodes: new Set(),
    funcs: new Set(),
    spriteFuncs: new Set(),
    particles: new Set(),
    spriteResources: new Map(),
  };
  const seen = new Set<number>();
  const todo = [0];
  while (todo.length) {
    let pc = todo.pop()!;
    while (!seen.has(pc)) {
      seen.add(pc);
      const op = code[pc]!;
      const len = instructionLength(code, pc);
      const name = OPCODES[op]![0];
      use.opcodes.add(name);
      const rel = (i: number) => pc + i + code[pc + i]!;
      if (op === OP.CallFunc) {
        const f = FUNCS[code[pc + 1]!];
        if (!f) throw new Error(`battle anim: unknown function ${code[pc + 1]} at word ${pc}`);
        use.funcs.add(f);
      } else if (op === OP.AddSpriteWithFunc) {
        const f = SPRITE_FUNCS[code[pc + 2]!];
        if (!f) throw new Error(`battle anim: unknown sprite function ${code[pc + 2]} at word ${pc}`);
        use.spriteFuncs.add(f);
      } else if (op === OP.LoadParticleSystem) use.particles.add(code[pc + 2]!);
      if (op === OP.AddSpriteWithFunc || op === OP.AddSprite) {
        const r = { chars: code[pc + 3]!, palette: code[pc + 4]!, cells: code[pc + 5]!, animation: code[pc + 6]! };
        use.spriteResources.set(animSpriteKey(r), r);
      }
      if (op === OP.End || op === OP.Return || op === OP.WaitForLRX) break;
      if (op === OP.Jump || (op === OP.JumpIfFriendlyFire && friendlyFire) || (op === OP.JumpIfContest && contest)) {
        pc = rel(1);
        continue;
      }
      if (op === OP.JumpIfBattlerSide && contest) {
        pc = rel(code[pc + 1] === 0 ? 2 : 3);
        continue;
      }
      if (op === OP.Call) todo.push(rel(1));
      if (op === OP.JumpIfEffectChanceOdd) todo.push(rel(1), rel(2));
      if (op === OP.JumpIfBattlerSide) todo.push(rel(2), rel(3));
      if (op === OP.JumpIfWeather) todo.push(rel(1), rel(2), rel(3), rel(4), rel(5));
      if (op === OP.JumpIfEffectChance) todo.push(rel(2));
      if (op === OP.JumpIfEffectChanceOdd || op === OP.JumpIfBattlerSide || op === OP.JumpIfWeather) break;
      pc += len;
    }
  }
  return use;
}

/** Members in wechar, wepltt, wecell and wecellanm, respectively. */
export interface AnimSpriteResource {
  chars: number;
  palette: number;
  cells: number;
  animation: number;
}
export const animSpriteKey = (r: AnimSpriteResource): string => `${r.chars}/${r.palette}/${r.cells}/${r.animation}`;
export const animSpriteSheetId = (r: AnimSpriteResource): Id => asId(`platinum:ui2d/battle/objects/${animSpriteKey(r)}`);
