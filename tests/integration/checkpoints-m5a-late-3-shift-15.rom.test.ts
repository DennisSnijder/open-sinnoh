/** M5a checkpoints, seed 3, all replay inputs started 15 ticks late: see checkpoints-m5a.ts. */
import { describeChunkLate, M5A } from './checkpoints-m5a.ts';

describeChunkLate(M5A, 3, [15]);
