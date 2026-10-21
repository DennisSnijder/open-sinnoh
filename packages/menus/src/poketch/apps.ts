/** The Pokétch apps by decomp app id (all 25). */
import type { PoketchAppName } from '@opensinnoh/contracts';
import type { AppFactory } from './common.ts';
import { berrySearcher, dowsingMachine, linkSearcher, markingMap, pedometer } from './field.ts';
import { daycareChecker, friendshipChecker, matchupChecker, partyStatus, pokemonHistory, trainerCounter } from './pokemon.ts';
import { calculator, coinToss, colorChanger, counter, dotArtist, memoPad, moveTester, roulette } from './tools.ts';
import { alarmClock, analogWatch, calendar, digitalWatch, kitchenTimer, stopwatch } from './watches.ts';

export const APPS: Record<PoketchAppName, AppFactory> = {
  DIGITALWATCH: digitalWatch,
  CALCULATOR: calculator,
  MEMOPAD: memoPad,
  PEDOMETER: pedometer,
  PARTYSTATUS: partyStatus,
  FRIENDSHIPCHECKER: friendshipChecker,
  DOWSINGMACHINE: dowsingMachine,
  BERRYSEARCHER: berrySearcher,
  DAYCARECHECKER: daycareChecker,
  POKEMONHISTORY: pokemonHistory,
  COUNTER: counter,
  ANALOGWATCH: analogWatch,
  MARKINGMAP: markingMap,
  LINKSEARCHER: linkSearcher,
  COINTOSS: coinToss,
  MOVETESTER: moveTester,
  CALENDAR: calendar,
  DOTART: dotArtist,
  ROULETTE: roulette,
  TRAINERCOUNTER: trainerCounter,
  KITCHENTIMER: kitchenTimer,
  COLORCHANGER: colorChanger,
  MATCHUPCHECKER: matchupChecker,
  STOPWATCH: stopwatch,
  ALARMCLOCK: alarmClock,
};
