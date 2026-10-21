/**
 * The event-only branches through the dev-only event flag (replay `event <name>`; m6-legendaries.ts), and the
 * Member Card through Mystery Gift (m6-event-darkrai-gift-mart, m6-event-darkrai-gift).
 */
import { describeM6 } from './m6-legendaries.ts';

describeM6('event branches', [
  'm6-event-rotom.replay',
  'm6-event-regi-iron.replay',
  'm6-event-regi-rock.replay',
  'm6-event-regi-ice.replay',
  'm6-event-regigigas.replay',
  'm6-event-darkrai.replay',
  'm6-event-darkrai-gift-mart.replay',
  'm6-event-darkrai-gift.replay',
  'm6-event-shaymin.replay',
  'm6-event-shaymin-caught.replay',
  'm6-event-gracidea.replay',
  'm6-event-arceus.replay',
]);
