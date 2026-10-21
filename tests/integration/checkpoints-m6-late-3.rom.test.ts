/** M6 checkpoints from their parents' chain anchors on seed 3, started 1 ticks late: see checkpoints-m5a.ts. */
import { describeChunkLate, M6 } from './checkpoints-m5a.ts';

describeChunkLate(M6, 3, [1]);
