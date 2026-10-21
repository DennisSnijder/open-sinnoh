/** M5a determinism and save round trips, seed 1, first half: see checkpoints-m5a.ts. */
import { describeChunk, M5A } from './checkpoints-m5a.ts';

describeChunk(M5A, 1, M5A.replays.slice(0, 2));
