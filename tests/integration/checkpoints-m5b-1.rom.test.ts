/** M5b determinism and save round trips, seed 1, first half: see checkpoints-m5a.ts. */
import { describeChunk, M5B } from './checkpoints-m5a.ts';

describeChunk(M5B, 1, M5B.replays.slice(0, 2));
