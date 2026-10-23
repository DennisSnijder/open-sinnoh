import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { addJournalEvent, dayOfYear, journalDate, journalMart, journalMon, journalOpensOnContinue, journalTrainer, journalWarp, JOURNAL_EVENT as E, openJournalPage, type JournalPage, type JournalTables } from './journal.ts';
import type { Zone } from './records.ts';
import type { Registries } from './runtime.ts';
import type { GameState } from './state.ts';

const id = (s: string) => `t:${s}` as Id;
const page = (): JournalPage => ({ date: { year: 9, month: 3, day: 22, weekday: 0 }, zone: id('TOWN'), events: [], mon: null, trainer: null });
const ev = (type: number, value = 0, trainer = 0) => ({ type, value, trainer });

describe('JournalEntry_SaveLocationEvent', () => {
  it('fills four slots, then shifts up; misc events are skipped after one of the same type', () => {
    const p = page();
    addJournalEvent(p, ev(E.pcBox));
    addJournalEvent(p, ev(E.pcBox));
    expect(p.events).toEqual([ev(E.pcBox)]);
    addJournalEvent(p, ev(E.shopped));
    addJournalEvent(p, ev(E.pcBox));
    addJournalEvent(p, ev(E.safari, 7));
    expect(p.events).toEqual([ev(E.pcBox), ev(E.shopped), ev(E.pcBox), ev(E.safari)]);
    addJournalEvent(p, ev(E.gameCorner));
    expect(p.events.map((e) => e.type)).toEqual([E.shopped, E.pcBox, E.safari, E.gameCorner]);
  });

  it('travel, items and field moves are skipped after the same type with the same value only', () => {
    const p = page();
    addJournalEvent(p, ev(E.arrived, 3));
    addJournalEvent(p, ev(E.arrived, 3));
    addJournalEvent(p, ev(E.arrived, 4));
    addJournalEvent(p, ev(E.item, 4));
    addJournalEvent(p, ev(E.item, 4, 9));
    expect(p.events).toEqual([ev(E.arrived, 3), ev(E.arrived, 4), ev(E.item, 4)]);
  });

  it('a gym win drops that gym\'s "too tough", the Elite Four keep one entry, the Champion always goes in', () => {
    const p = page();
    addJournalEvent(p, ev(E.gymTooTough, 2));
    addJournalEvent(p, ev(E.gymTooTough, 3));
    addJournalEvent(p, ev(E.gymLeader, 2, 317));
    expect(p.events).toEqual([ev(E.gymTooTough, 3), ev(E.gymLeader, 2, 317)]);
    addJournalEvent(p, ev(E.eliteFour, 0, 261));
    addJournalEvent(p, ev(E.eliteFour, 0, 262));
    expect(p.events).toEqual([ev(E.gymTooTough, 3), ev(E.gymLeader, 2, 317), ev(E.eliteFour, 0, 262)]);
    addJournalEvent(p, ev(E.champion, 0, 267));
    addJournalEvent(p, ev(E.champion, 0, 267));
    expect(p.events.map((e) => e.type)).toEqual([E.gymLeader, E.eliteFour, E.champion, E.champion]);
  });

  it('types the decomp does not save are ignored', () => {
    const p = page();
    addJournalEvent(p, ev(E.unused, 1));
    addJournalEvent(p, ev(99));
    expect(p.events).toEqual([]);
  });
});

describe('the page roll and the open-on-continue test', () => {
  const state = (journal: JournalPage[]) => ({ journal }) as unknown as GameState;

  it('a page of another day shifts the pages down (the tenth drops); the same day keeps its title', () => {
    const s = state([]);
    openJournalPage(s, { year: 9, month: 3, day: 22, weekday: 0 }, id('A'));
    openJournalPage(s, { year: 9, month: 3, day: 22, weekday: 0 }, id('B'));
    expect(s.journal.map((p) => p.zone)).toEqual([id('A')]);
    for (let d = 23; d < 33; d++) openJournalPage(s, { year: 9, month: 3, day: d, weekday: d % 7 }, id(`D${d}`));
    expect(s.journal).toHaveLength(10);
    expect(s.journal[0]!.zone).toBe(id('D32'));
    expect(s.journal[9]!.zone).toBe(id('D23'));
  });

  it('opens on continue from two days by day of the year, across years, and on a new year eve one year apart', () => {
    const at = (date: string) => journalDate({ date, hour: 12, minute: 0, second: 0 });
    const with_ = (date: string) => state([{ ...page(), date: at(date) }]);
    expect(journalOpensOnContinue(with_('2009-03-22'), at('2009-03-23'))).toBe(false);
    expect(journalOpensOnContinue(with_('2009-03-22'), at('2009-03-24'))).toBe(true);
    expect(journalOpensOnContinue(with_('2009-03-24'), at('2009-03-22'))).toBe(true);
    expect(journalOpensOnContinue(with_('2009-12-31'), at('2010-01-01'))).toBe(false);
    expect(journalOpensOnContinue(with_('2008-12-31'), at('2010-01-01'))).toBe(true);
    expect(journalOpensOnContinue(with_('2009-03-22'), at('2010-03-22'))).toBe(true);
    expect(dayOfYear({ year: 8, month: 3, day: 1 })).toBe(61);
    expect(dayOfYear({ year: 9, month: 3, day: 1 })).toBe(60);
  });
});

describe('the field hooks', () => {
  const tables: JournalTables = {
    flag: id('FLAG_JOURNAL_ACQUIRED'),
    gyms: [{ trainer: id('ROARK'), zone: id('GYM'), badge: id('COAL') }],
    buildings: [{ label: 90, exited: true }],
    caveDeparted: [47],
    eliteFour: [id('AARON')],
    champion: [id('CYNTHIA')],
    home: id('HOME'),
    lab: id('LAB'),
    rivalClass: id('RIVAL'),
    banks: { entries: id('E'), months: id('M'), gyms: id('G'), locations: id('L'), times: id('T') },
    pageTurn: [],
    martExcluded: { label: 101, zones: [id('HERB_SHOP')] },
  };
  const zone = (name: string, mapType: Zone['mapType'], label: number, sourceIndex: number) => ({ id: id(name), mapType, sourceIndex, mapPopup: { label, window: id('W'), onWarp: true } }) as unknown as Zone;
  const zones = [zone('TOWN', 'town', 1, 3), zone('CAVE', 'cave', 47, 4), zone('HOME', 'indoors', 2, 5), zone('LAB', 'indoors', 3, 6), zone('TV', 'indoors', 90, 7), zone('HOUSE', 'indoors', 8, 8), zone('GYM', 'indoors', 9, 9), zone('STORE', 'indoors', 101, 10)];
  const reg = {
    newGame: new Map([[id('NG'), { journal: tables }]]),
    flags: new Map([[tables.flag, { initial: false }]]),
    zones: new Map(zones.map((z) => [z.id, z])),
    trainers: new Map([['ROARK', 246], ['AARON', 261], ['CYNTHIA', 267], ['YOUNGSTER', 1]].map(([n, i]) => [id(n as string), { sourceIndex: i }])),
  } as unknown as Registries;
  const z = (n: string) => reg.zones.get(id(n))!;
  const game = (owned = true) => ({ flags: owned ? { [tables.flag]: true } : {}, badges: [] as Id[], journal: [page()], player: { zone: id('TOWN') }, playTime: { hours: 1, minutes: 55, seconds: 0 } }) as unknown as GameState;

  it('records nothing before the journal is owned', () => {
    const s = game(false);
    journalWarp(reg, s, z('CAVE'), z('TOWN'), false);
    expect(s.journal[0]!.events).toEqual([]);
  });

  it('a warp: an arrival instead of a transition; out of a cave, home, the lab, a listed building; into a gym without its badge', () => {
    const s = game();
    journalWarp(reg, s, z('CAVE'), z('TOWN'), true);
    journalWarp(reg, s, z('CAVE'), z('TOWN'), false);
    journalWarp(reg, s, z('HOME'), z('TOWN'), false);
    journalWarp(reg, s, z('LAB'), z('TOWN'), false);
    expect(s.journal[0]!.events).toEqual([ev(E.arrived, 3), ev(E.leftCave, 47), ev(E.restedAtHome), ev(E.leftLab)]);
    journalWarp(reg, s, z('TV'), z('TOWN'), false);
    journalWarp(reg, s, z('HOUSE'), z('TOWN'), false);
    journalWarp(reg, s, z('TOWN'), z('GYM'), false);
    expect(s.journal[0]!.events.slice(-2)).toEqual([ev(E.leftBuilding, 90), ev(E.gymTooTough, 0)]);
    s.badges.push(id('COAL'));
    journalWarp(reg, s, z('TOWN'), z('HOUSE'), false);
    journalWarp(reg, s, z('TOWN'), z('GYM'), false);
    journalWarp(reg, s, z('HOUSE'), z('CAVE'), false);
    expect(s.journal[0]!.events.slice(-1)).toEqual([ev(E.gymTooTough, 0)]);
  });

  it('trainer wins: the gym leader, the Elite Four and the Champion are events, anyone else the trainer line', () => {
    const s = game();
    journalTrainer(reg, s, id('ROARK'), id('GYM'));
    journalTrainer(reg, s, id('AARON'), id('GYM'));
    journalTrainer(reg, s, id('CYNTHIA'), id('GYM'));
    journalTrainer(reg, s, id('YOUNGSTER'), id('TOWN'));
    expect(s.journal[0]!.events).toEqual([ev(E.gymLeader, 0, 246), ev(E.eliteFour, 0, 261), ev(E.champion, 0, 267)]);
    expect(s.journal[0]!.trainer).toEqual({ trainer: id('YOUNGSTER'), zone: id('TOWN') });
  });

  it('the Pokémon line\'s variant comes from the play time\'s ten minutes', () => {
    const s = game();
    journalMon(reg, s, 'caught', id('BIDOOF'), 1, 2);
    expect(s.journal[0]!.mon).toEqual({ result: 'caught', variant: 2, timeOfDay: 2, gender: 1, species: id('BIDOOF') });
    s.playTime.minutes = 12;
    journalMon(reg, s, 'defeated', id('BIDOOF'), 0, 0);
    expect(s.journal[0]!.mon!.variant).toBe(0);
    s.playTime.minutes = 5;
    journalMon(reg, s, 'defeated', id('BIDOOF'), 0, 0);
    expect(s.journal[0]!.mon!.variant).toBe(2);
  });

  it('mart exits by counts, not in the excluded marts', () => {
    const s = game();
    const last = () => s.journal[0]!.events.at(-1)?.type;
    journalMart(reg, s, 1, 0);
    expect(last()).toBe(E.shopped);
    journalMart(reg, s, 2, 0);
    expect(last()).toBe(E.lotsOfShopping);
    journalMart(reg, s, 0, 1);
    expect(last()).toBe(E.soldALittle);
    journalMart(reg, s, 0, 2);
    expect(last()).toBe(E.soldALot);
    journalMart(reg, s, 1, 1);
    expect(last()).toBe(E.businessAtMart);
    const n = s.journal[0]!.events.length;
    journalMart(reg, s, 0, 0);
    s.player.zone = id('STORE');
    journalMart(reg, s, 1, 0);
    expect(s.journal[0]!.events).toHaveLength(n);
  });
});
