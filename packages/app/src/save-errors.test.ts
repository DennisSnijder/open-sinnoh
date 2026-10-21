import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NewerSaveError, NotASaveError, PackMismatchError, SaveError } from '@opensinnoh/game';
import { describe, expect, it } from 'vitest';
import { saveImportMessage } from './save-errors.ts';

describe('what the player reads when a save file cannot be used', () => {
  it('names each kind of problem', () => {
    expect(saveImportMessage(new NotASaveError('This file is not an OpenSinnoh save.'))).toBe('This file is not an OpenSinnoh save.');
    expect(saveImportMessage(new NewerSaveError('This save was made by a newer version of OpenSinnoh. Update the app, then import it again.'))).toMatch(/newer version/);
    expect(saveImportMessage(new SaveError('invalid save: state.party: expected array'))).toBe('This save file is damaged or incomplete (state.party: expected array). Your current save was not changed.');
  });

  it('a mismatch says which mod to turn on or off, or which version differs', () => {
    expect(saveImportMessage(new PackMismatchError('x', ['demo-mod@1.0.0'], []))).toMatch(/needs demo-mod@1\.0\.0, which is not loaded: turn that mod on/);
    expect(saveImportMessage(new PackMismatchError('x', [], ['demo-mod@1.0.0']))).toMatch(/made without demo-mod@1\.0\.0: turn that mod off/);
    expect(saveImportMessage(new PackMismatchError('x', ['platinum@2.0.0'], ['platinum@3.0.0']))).toMatch(/another version of platinum \(the save has platinum@2\.0\.0\)/);
  });

  it('errors that are not about the file are not hidden', () => {
    expect(() => saveImportMessage(new TypeError('boom'))).toThrow('boom');
  });
});

describe('the app is not tied to one host', () => {
  const root = join(import.meta.dirname, '../../..');
  // Link previews and the canonical link are the exceptions: they need absolute URLs (index.html's og:/twitter: meta, rel=canonical).
  it('names no production domain in the code, the page or the manifest (everything is relative to the origin)', () => {
    const files = [join(root, 'index.html'), join(root, 'public/manifest.webmanifest'), join(root, 'public/sw.js'), join(root, 'vite.config.ts'), join(root, 'vercel.json')];
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []));
    for (const file of [...files, ...walk(join(root, 'packages/app/src'))]) expect(readFileSync(file, 'utf8').replace(/^ *<(meta (property="og:|name="twitter:)|link rel="canonical").*$/gm, ''), file).not.toMatch(/opensinnoh\.(com|app)/);
  });

  it('the manifest id, start URL and scope are origin-relative', () => {
    const m = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8')) as Record<string, unknown>;
    expect([m.id, m.start_url, m.scope]).toEqual(['/', '/', '/']);
  });
});
