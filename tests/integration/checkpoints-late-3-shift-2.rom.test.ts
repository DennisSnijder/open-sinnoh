/** CP4 chain, seed 3, every replay started 2 ticks late: see checkpoints.ts. */
import { describeLateStarts } from './checkpoints.ts';

describeLateStarts(3, [2]);
