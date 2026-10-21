/** M6 checkpoints headless, each twice from its parent's chain anchor on seed 3 with a save round trip, second half: see checkpoints-m5a.ts. */
import { describeChunk, M6 } from './checkpoints-m5a.ts';

describeChunk(M6, 3, M6.replays.slice(6));
