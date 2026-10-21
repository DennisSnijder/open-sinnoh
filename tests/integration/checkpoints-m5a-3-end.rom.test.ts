/** M5a determinism and save round trips, seed 3, second half: see checkpoints-m5a.ts. */
import { describeChunk, M5A } from './checkpoints-m5a.ts';

describeChunk(M5A, 3, M5A.replays.slice(2));
