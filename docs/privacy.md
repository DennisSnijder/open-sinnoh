# Privacy

Your ROM, its files and your saves never leave your device. The ROM is read once by the importer in your
browser; the imported data and your saves live in the browser's storage (IndexedDB).

## Error reports

The deployed game can send an anonymous report to Sentry when an uncaught error happens. You choose during
the setup before the first main menu; nothing is sent before you answer, and you can change it at any time
in Options › Privacy (it applies at once).

A report holds the error, where in our code it happened, the app release, the importer and contracts
versions, the ROM's SHA-1 (the public hash of the supported dump), the zone id, the game mode, the script and
command ids when the script engine failed, the loop's speed, and the browser, viewport and device pixel
ratio.

It never holds ROM bytes, save data, the names or paths of your files, screenshots, your player's, rival's or
Pokémon's names, or game text: these are scrubbed before sending (`packages/app/src/telemetry/scrub.ts`), the
page URL keeps only debug flags, and only our own breadcrumbs are kept. No cookies, no session replay, no
tracing. When the game stops on an error, the crash screen can copy the same scrubbed report for you to send
yourself.

## Visit counting

Visits are counted anonymously, without cookies (PostHog EU Cloud in cookieless mode,
`packages/app/src/telemetry/analytics.ts` and `site/src/analytics.ts`): a few events (the game opened, a ROM
import started and finished with a coarse duration, new game or continue, the HeartGold/SoulSilver add-on
added, a heartbeat per 5 minutes of play, badge and Hall of Fame counts) with the site, the app version, the
device class, whether the app is installed and a coarse viewport size. Nothing is stored in your browser for
it, nothing about your ROM or save is sent, and nothing at all with Do Not Track or Global Privacy Control on.
Error reports are separate and follow their own setting.
