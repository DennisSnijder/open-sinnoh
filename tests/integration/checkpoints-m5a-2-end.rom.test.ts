/** M5a determinism and save round trips, seed 2, second half: see checkpoints-m5a.ts. */
import { describeChunk, M5A } from './checkpoints-m5a.ts';

describeChunk(M5A, 2, M5A.replays.slice(2));
