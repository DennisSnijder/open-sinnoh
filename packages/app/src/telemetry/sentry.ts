/**
 * The Sentry adapter (a lazy chunk: never in the initial bundle). Errors only: no default integrations (so
 * no console/click/fetch breadcrumbs, no session tracking, no global handlers of its own: index.ts reports
 * those), no tracing, no replay, no client reports, no PII. `beforeSend` drops the event when reports are
 * off and scrubs it last (scrub.ts); attachments are never sent.
 */
import { captureException, captureMessage, dedupeIntegration, httpContextIntegration, init, linkedErrorsIntegration, withScope } from '@sentry/browser';
import type { AdapterConfig, TelemetryAdapter } from './index.ts';
import { BREADCRUMB_PREFIX, scrubEvent } from './scrub.ts';

export function createSentryAdapter(config: AdapterConfig): TelemetryAdapter {
  init({
    dsn: config.dsn,
    release: config.release,
    environment: config.environment,
    defaultIntegrations: false,
    integrations: [dedupeIntegration(), linkedErrorsIntegration(), httpContextIntegration()],
    sendDefaultPii: false,
    sendClientReports: false,
    maxBreadcrumbs: 30,
    beforeBreadcrumb: (b) => (b.category?.startsWith(BREADCRUMB_PREFIX) ? b : null),
    beforeSend(event, hint) {
      if (!config.enabled()) return null;
      hint.attachments = [];
      return scrubEvent(event, config.secrets());
    },
  });
  return {
    capture(error, report) {
      withScope((scope) => {
        scope.setTags(report.tags);
        scope.setLevel(report.fatal ? 'fatal' : 'error');
        scope.setContext('app', report.context);
        for (const c of report.breadcrumbs) scope.addBreadcrumb(c);
        captureException(error);
      });
    },
    summary(name, data, tags) {
      withScope((scope) => {
        scope.setTags({ ...tags, summary: name });
        scope.setLevel('info');
        scope.setContext(name, data);
        captureMessage(`${name} summary`);
      });
    },
  };
}
