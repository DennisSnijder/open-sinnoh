/** M5b checkpoints, seed 3, all replay inputs started 2 ticks late: see checkpoints-m5a.ts. */
import { describeChunkLate, M5B } from './checkpoints-m5a.ts';

describeChunkLate(M5B, 3, [2]);
