/**
 * The journal's and the diplomas' script commands (docs/research/villa-journal.md §2.3, §3; decomp scrcmd.c
 * ScrCmd_GiveJournal, ScrCmd_CreateJournalEvent, ScrCmd_ShowDiplomaSinnoh, ScrCmd_ShowDiplomaNationalDex). The journal's
 * rules are contracts `journal.ts`; its other entries come from the field (world, game).
 */
import { JOURNAL_EVENT, journalDate, journalEvent, journalTables, newGameRecord, openJournalPage } from '@opensinnoh/contracts';
import type { Handler, Runner } from './runner.ts';

/** The event types `create_journal_event` makes (every other type is a no-op on the DS). */
const SCRIPT_EVENTS = new Set<number>([
  JOURNAL_EVENT.gameCorner, JOURNAL_EVENT.safari, JOURNAL_EVENT.item,
  JOURNAL_EVENT.cut, JOURNAL_EVENT.surf, JOURNAL_EVENT.strength, JOURNAL_EVENT.defog, JOURNAL_EVENT.rockSmash, JOURNAL_EVENT.waterfall, JOURNAL_EVENT.rockClimb,
  JOURNAL_EVENT.battleTower, JOURNAL_EVENT.battleFactory, JOURNAL_EVENT.battleCastle, JOURNAL_EVENT.battleHall, JOURNAL_EVENT.battleArcade,
]);

export function journalHandlers(r: Runner): Record<string, Handler> {
  return {
    /** Set FLAG_JOURNAL_ACQUIRED, open today's page (Journal_GetSavedPage) and write its title (sub_02053494). */
    give_journal: () => {
      const t = journalTables(r.registries);
      if (!t) throw new Error('give_journal: the pack has no journal (NewGame.journal)');
      r.setFlag(t.flag, true);
      openJournalPage(r.state, journalDate(r.clock()), r.state.player.zone);
      return 'continue';
    },
    /**
     * Game Corner, Safari Game, an item (param), the HM field moves Cut … Rock Climb (param: the map) and the five
     * facilities; any other type does nothing. The handler returns TRUE on the DS: the script yields a frame.
     */
    create_journal_event: (t, _c, a) => {
      const type = r.val(t, a[0]);
      const param = r.val(t, a[1]);
      if (SCRIPT_EVENTS.has(type)) journalEvent(r.registries, r.state, type, param);
      return 'yield';
    },
    show_diploma_sinnoh: (_t, c) => (diploma(r), r.openApp(c, { app: 'diploma', national: false }, () => {})),
    show_diploma_national_dex: (_t, c) => (diploma(r), r.openApp(c, { app: 'diploma', national: true }, () => {})),
  };
}

function diploma(r: Runner): void {
  if (!newGameRecord(r.registries).diploma) throw new Error('the diploma needs NewGame.diploma (the import draws /demo/syoujyou)');
}
