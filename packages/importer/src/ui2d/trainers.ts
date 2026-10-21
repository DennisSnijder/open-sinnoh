/**
 * Trainer battle sprites (decomp pokemon.c SpriteSystem_NewManagedSpriteTrainer): five members per
 * set (characters, palette, cells, animations, a scanned picture we do not need), trfgra one set per
 * trainer class, trbgra one per class that has its own back picture (in class order), then D/P's rival.
 * The cells use VRAM transfer: each picture of the throw is its own range of the characters.
 */
import type { TrainerSprite } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import type { Sheets } from './sheets.ts';

const TRFGRA = { path: '/poketool/trgra/trfgra.narc', count: 525 };
const TRBGRA = { path: '/poketool/trgra/trbgra.narc', count: 55 };
const SET = 5;

/** The classes with a back picture, in trbgra order (res/trainers/classes: those with back.png, class order). */
const BACK_CLASSES = [
  'TRAINER_CLASS_PLAYER_MALE',
  'TRAINER_CLASS_PLAYER_FEMALE',
  'TRAINER_CLASS_RIVAL',
  'TRAINER_CLASS_TRAINER_CHERYL',
  'TRAINER_CLASS_TRAINER_RILEY',
  'TRAINER_CLASS_TRAINER_MARLEY',
  'TRAINER_CLASS_TRAINER_BUCK',
  'TRAINER_CLASS_TRAINER_MIRA',
  'TRAINER_CLASS_DP_PLAYER_MALE',
  'TRAINER_CLASS_DP_PLAYER_FEMALE',
];

/** `classIds[i]` = the id of trainer class i (`platinum:TRAINER_CLASS_*`). */
export function importTrainerSprites(fs: NitroFs, classIds: Id[], sheets: Sheets): TrainerSprite[] {
  const front = readNarc(fs.file(TRFGRA.path));
  const back = readNarc(fs.file(TRBGRA.path));
  if (front.length !== TRFGRA.count || front.length !== classIds.length * SET) throw new Error(`${TRFGRA.path}: ${front.length} members for ${classIds.length} classes`);
  if (back.length !== TRBGRA.count || back.length !== (BACK_CLASSES.length + 1) * SET) throw new Error(`${TRBGRA.path}: ${back.length} members`);
  const set = (base: number) => ({ ncgr: base, nclr: base + 1, ncer: base + 2, nanr: base + 3 });
  return classIds.map((id, i) => {
    const name = id.replace(/^platinum:TRAINER_CLASS_/, '').toLowerCase();
    const b = BACK_CLASSES.indexOf(id.replace(/^platinum:/, ''));
    return {
      id,
      sourceIndex: i,
      front: sheets.obj(`trainers/${name}/front`, front, set(i * SET)),
      ...(b >= 0 ? { back: sheets.obj(`trainers/${name}/back`, back, set(b * SET)) } : {}),
    };
  });
}
