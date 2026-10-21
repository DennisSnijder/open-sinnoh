/** The prop manager's two independent channels; task checks precede animation advancement. */
export class ContainmentUnits {
  loop = 0;
  opening = 0;
  private paused: boolean;
  private openRunning = false;
  private phase: 'loop' | 'start' | 'open' | null = null;

  constructor(
    readonly loopFrames: number,
    readonly openingFrames: number,
    freed: boolean,
  ) {
    this.paused = freed;
    if (freed) this.opening = openingFrames - 1;
  }

  deactivate(): void {
    if (this.phase) throw new Error('containment: shutdown already running');
    this.phase = 'loop';
  }
  done(): boolean {
    return this.phase === null;
  }
  step(): void {
    switch (this.phase) {
      case 'loop':
        if (this.loop === this.loopFrames - 1) {
          this.paused = true;
          this.phase = 'start';
        }
        break;
      case 'start':
        this.openRunning = true;
        this.phase = 'open';
        break;
      case 'open':
        if (!this.openRunning) this.phase = null;
        break;
    }
    if (!this.paused) this.loop = (this.loop + 1) % this.loopFrames;
    if (this.openRunning && ++this.opening >= this.openingFrames - 1) {
      this.opening = this.openingFrames - 1;
      this.openRunning = false;
    }
  }
}
