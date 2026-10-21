/** M6 checkpoints from their parents' chain anchors on seed 1, started 5 ticks late: see checkpoints-m5a.ts. */
import { describeChunkLate, M6 } from './checkpoints-m5a.ts';

describeChunkLate(M6, 1, [5]);
