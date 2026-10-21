/** Conservative folder mapping. Keep docs/browser-tests.md in sync; unknown runtime files run everything. */
// Only folders no other spec reaches: title/, starter/, battle/, telemetry/ and audio run in every ROM spec that
// loads a save or plays a battle, so they run the full suite like any other runtime code.
const FOLDERS: readonly [string, readonly string[]][] = [
  // The debug panel mounts only with ?debug=1, the perf HUD only with ?perf (no spec opens it).
  ['packages/app/src/debug/', ['debug.spec.ts']],
  // The landing page is its own build; the app never imports site/.
  ['site/', ['site.spec.ts']],
];

export interface BrowserSelection {
  full: boolean;
  specs: string[];
  reason: string;
}

export function selectBrowserSpecs(changed: readonly string[], specs: readonly string[]): BrowserSelection {
  const selected = new Set<string>();
  for (const file of changed) {
    // Specs changed directly run in every configured project. Deleted specs no longer exist.
    if (file.startsWith('tests/browser/') && file.endsWith('.spec.ts')) {
      if (specs.includes(file)) selected.add(file);
      continue;
    }
    // Documentation, unit tests and reference material cannot change the browser app.
    if (file.endsWith('.md') || file.endsWith('.test.ts') || file.startsWith('docs/') || file.startsWith('.claude/') || file.startsWith('reference-projects/') || file === 'LICENSE') continue;
    const folder = FOLDERS.find(([prefix]) => file.startsWith(prefix));
    if (!folder) return { full: true, specs: [...specs].sort(), reason: `shared or unmapped file: ${file}` };
    for (const pattern of folder[1]) {
      const regex = new RegExp(`^tests/browser/${pattern.replaceAll('.', '\\.').replaceAll('*', '.*')}$`);
      const matches = specs.filter((spec) => regex.test(spec));
      if (!matches.length) return { full: true, specs: [...specs].sort(), reason: `mapping has no existing spec: ${pattern}` };
      matches.forEach((spec) => selected.add(spec));
    }
  }
  return { full: false, specs: [...selected].sort(), reason: selected.size ? 'folder mapping and directly changed specs' : 'no browser-affecting changes' };
}
