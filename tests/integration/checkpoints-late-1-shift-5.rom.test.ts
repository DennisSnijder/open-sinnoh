/** CP4 chain, seed 1, every replay started 5 ticks late: see checkpoints.ts. */
import { describeLateStarts } from './checkpoints.ts';

describeLateStarts(1, [5]);
