/** M5c determinism and save round trips, seed 2, second half: see checkpoints-m5a.ts. */
import { describeChunk, M5C } from './checkpoints-m5a.ts';

describeChunk(M5C, 2, M5C.replays.slice(3));
