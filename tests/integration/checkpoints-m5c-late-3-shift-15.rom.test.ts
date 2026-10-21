/** M5c checkpoints, seed 3, all replay inputs started 15 ticks late: see checkpoints-m5a.ts. */
import { describeChunkLate, M5C } from './checkpoints-m5a.ts';

describeChunkLate(M5C, 3, [15]);
