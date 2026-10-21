/** Writes packages/vm/src/data/op-classification.json (the `coverage` verb reads it; a unit test keeps it current). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classificationReport } from '../src/coverage.ts';

const out = join(import.meta.dirname, '../src/data/op-classification.json');
writeFileSync(out, classificationReport());
console.log(`wrote ${out}`);
