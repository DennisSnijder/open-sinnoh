/**
 * The lobby's photo frames (decomp ScrCmd_0A8 → sub_0203DB24 → ov22_0225B660.c): a contest winner photo in its frame
 * with its backdrop, and the banner of its contest type with two lines (bank 385 messages 43, "{type} {rank}", and
 * 44, "{trainer}'s {Pokémon}"). It fades in, waits for A or B (or a tap), and fades out.
 */
import type { ContestPhotoView } from '@opensinnoh/contracts';
import type { MenuContext } from '../context.ts';
import type { Screen, Step } from '../stack.ts';
import { contestPicture } from './picture.ts';

/** TEXT_BANK_CONTEST_TEXT names: COOL CONTEST …, NORMAL RANK …; bank 385's banner lines. */
const TYPE_NAMES = ['Contest_Text_CoolContest', 'Contest_Text_BeautyContest', 'Contest_Text_CuteContest', 'Contest_Text_SmartContest', 'Contest_Text_ToughContest'];
const RANK_NAMES = ['Contest_Text_NormalRank', 'Contest_Text_GreatRank', 'Contest_Text_UltraRank', 'Contest_Text_MasterRank'];
const BANNER = { contest: 'pl_msg_00000385_00043', winner: 'pl_msg_00000385_00044' } as const;
/** The photo's frame on this screen (ov22_0225B660: the photo at (72, 16)); the photo's own frame is at (72, 56). */
const FRAME_DY = 16 - 56;

export function contestPhotoScreen(ctx: MenuContext, slot: number): Screen {
  const photo = ctx.state.contestPhotos[slot];
  if (!photo) throw new Error(`contest photo: no photo in slot ${slot}`);
  const t = ctx.text;
  const missing = [...TYPE_NAMES, ...RANK_NAMES, ...Object.values(BANNER)].filter((n) => !ctx.registries.texts.has(t.id(n)));
  if (missing.length) throw new Error(`contest photo: the pack has no text ${missing.join(', ')}`);
  const mon = photo.mon.nickname ?? ctx.registries.species.get(photo.mon.species)!.name;
  const lines: [string, string] = [
    t.message(BANNER.contest, t.message(TYPE_NAMES[slot]!), t.message(RANK_NAMES[photo.rank]!)),
    t.message(BANNER.winner, '', '', '', photo.trainerName, mon),
  ];
  const picture = contestPicture(ctx.registries, photo.mon, photo.dressUp, 0, FRAME_DY, true);
  const close = (): Step => ({ close: { app: 'contest-photo' } });
  return {
    input(i): Step {
      if ('button' in i) return i.button === 'a' || i.button === 'b' ? close() : undefined;
      return i.tap === 'next' || i.tap === 'back' ? close() : undefined;
    },
    view: (): ContestPhotoView => ({ app: 'contest-photo', type: slot, picture, lines }),
  };
}
