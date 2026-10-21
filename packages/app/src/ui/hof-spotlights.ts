/** The induction's six untextured quads, projected through its fixed camera (hall_of_fame.c).
 * VBlank tasks advance twice per game tick. Each sweep reverses on crossing 10°/170°.
 */
export function spotlightAngle(start: number, speed: number, steps: number): number {
  const first = Math.ceil((170 - start) / speed);
  if (steps <= first) return start + speed * steps;
  const high = start + speed * first;
  const leg = Math.ceil((high - 10) / speed);
  const t = (steps - first) % (leg * 2);
  return high - speed * (t <= leg ? t : leg * 2 - t);
}

export function drawSpotlights(g: CanvasRenderingContext2D, tick: number): void {
  const scale = 96 / (5 * Math.tan(4004 * Math.PI * 2 / 65536));
  const origins = [-0.714, -0.429, -0.143, 0.143, 0.429, 0.714];
  const starts = [20, 60, 40, 140, 120, 160];
  const speeds = [0.75, 0.6875, 0.625];
  const colors = ['rgb(255 255 99)', 'rgb(255 255 132)', 'rgb(255 230 66)'];
  g.save();
  g.globalAlpha = 16 / 31;
  for (let i = 0; i < origins.length; i++) {
    const x = Math.round(origins[i]! * 4096) / 4096;
    const angle = Math.floor(spotlightAngle(starts[i]!, speeds[i % 3]!, tick * 2)) * Math.PI / 180;
    const tipX = x + Math.cos(angle) * 2.5;
    const tipY = Math.sin(angle) * 2.5 - 1;
    g.fillStyle = colors[i % 3]!;
    g.beginPath();
    g.moveTo(128 + (x - 80 / 4096) * scale, 96 + scale);
    g.lineTo(128 + (x + 80 / 4096) * scale, 96 + scale);
    g.lineTo(128 + (tipX + 576 / 4096) * scale, 96 - tipY * scale);
    g.lineTo(128 + (tipX - 576 / 4096) * scale, 96 - tipY * scale);
    g.closePath();
    g.fill();
  }
  g.restore();
}
