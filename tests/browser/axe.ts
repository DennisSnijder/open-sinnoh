/**
 * axe-core (MPL-2.0, a dev dependency) run inside the page against WCAG 2.2 AA: the A and AA rules of 2.0, 2.1
 * and 2.2, except color-contrast: OpenSinnoh's faces are border-image skins, which axe cannot see through, so
 * contrast is computed by tests/browser/contrast.ts instead. A screen passes with no violation of any impact; `incomplete` results (axe could not decide, e.g. a
 * text over a border-image skin) are returned for the caller to look at, never silently dropped.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export interface AxeFinding {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

interface AxeRaw {
  violations: { id: string; impact: string | null; help: string; nodes: { target: unknown[]; failureSummary?: string }[] }[];
  incomplete: AxeRaw['violations'];
}

const flat = (v: AxeRaw['violations']): AxeFinding[] => v.map((r) => ({ id: r.id, impact: r.impact, help: r.help, nodes: r.nodes.map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 220)}`) }));

/** Violations (and what axe could not decide) under `include` (a CSS selector; the whole page by default). */
export async function axe(page: Page, include?: string): Promise<{ violations: AxeFinding[]; incomplete: AxeFinding[] }> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(SOURCE);
  const raw = await page.evaluate(
    ([sel, tags]) => (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<unknown> } }).axe.run(sel ? { include: [[sel]] } : document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'], rules: { 'color-contrast': { enabled: false } } }),
    [include ?? '', TAGS] as const,
  );
  const r = raw as AxeRaw;
  return { violations: flat(r.violations), incomplete: flat(r.incomplete) };
}
