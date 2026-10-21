/** M5c checkpoints, seed 1, all replay inputs started 5 ticks late: see checkpoints-m5a.ts. */
import { describeChunkLate, M5C } from './checkpoints-m5a.ts';

describeChunkLate(M5C, 1, [5]);
