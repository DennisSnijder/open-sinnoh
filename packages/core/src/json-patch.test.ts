import { describe, expect, it } from 'vitest';
import { applyPatch, PatchError } from './json-patch.ts';

describe('applyPatch', () => {
  const doc = { name: 'A', stats: [1, 2, 3], nested: { x: 1 } };

  it('applies add/replace/remove/move/copy/test without mutating input', () => {
    const out = applyPatch(doc, [
      { op: 'replace', path: '/name', value: 'B' },
      { op: 'add', path: '/stats/1', value: 9 },
      { op: 'add', path: '/stats/-', value: 4 },
      { op: 'remove', path: '/stats/0' },
      { op: 'copy', from: '/nested/x', path: '/y' },
      { op: 'move', from: '/nested', path: '/moved' },
      { op: 'test', path: '/moved', value: { x: 1 } },
    ]);
    expect(out).toEqual({ name: 'B', stats: [9, 2, 3, 4], y: 1, moved: { x: 1 } });
    expect(doc).toEqual({ name: 'A', stats: [1, 2, 3], nested: { x: 1 } });
  });

  it('escapes ~0 and ~1', () => {
    expect(applyPatch({ 'a/b': 1, 'c~d': 2 }, [{ op: 'replace', path: '/a~1b', value: 3 }, { op: 'remove', path: '/c~0d' }])).toEqual({ 'a/b': 3 });
  });

  it('fails loudly on missing paths and failed tests', () => {
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/nope', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'remove', path: '/stats/5' }])).toThrow(/op #0/);
    expect(() => applyPatch(doc, [{ op: 'test', path: '/name', value: 'Z' }])).toThrow(/test failed/);
  });
});
