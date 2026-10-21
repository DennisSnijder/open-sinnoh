/**
 * arealight.narc member: an ASCII list of light templates, one per time-of-day slot, ended by a line
 * starting with `EOF`. Lines end in CR (an LF after it is ignored). Each template is 10 lines:
 *
 *   endTime,                       (seconds since midnight / 2; the template is active until then)
 *   valid,r,g,b,x,y,z,             × 4 lights (valid 1 = on; colour 0..31; direction fx16, clamped to ±1)
 *   r,g,b,                         × 4: diffuse, ambient, specular, emission (0..31)
 *   (separator line)
 */

export interface RawLightTemplate {
  endTime: number;
  /** null = light off. Colour components 0..31, direction in fx16 (4096 = 1). */
  lights: ({ color: [number, number, number]; direction: [number, number, number] } | null)[];
  diffuse: [number, number, number];
  ambient: [number, number, number];
  specular: [number, number, number];
  emission: [number, number, number];
}

const LINES_PER_TEMPLATE = 10;
const FX16_ONE = 4096;

function ints(line: string, count: number, what: string): number[] {
  const parts = line.split(',').slice(0, count).map((p) => Number.parseInt(p.trim(), 10));
  if (parts.length < count || parts.some((n) => !Number.isFinite(n))) throw new Error(`area light: bad ${what} line ${JSON.stringify(line)}`);
  return parts;
}

const rgb = (line: string, what: string) => ints(line, 3, what) as [number, number, number];
const clamp = (n: number) => Math.max(-FX16_ONE, Math.min(FX16_ONE, n));

export function readAreaLight(bytes: Uint8Array): RawLightTemplate[] {
  const lines = new TextDecoder('latin1').decode(bytes).split('\r').map((l) => l.replace(/^\n/, ''));
  const templates: RawLightTemplate[] = [];
  let i = 0;
  for (;;) {
    const head = lines[i];
    if (head === undefined) throw new Error('area light: no EOF line');
    if (head.startsWith('EOF')) break;
    if (i + LINES_PER_TEMPLATE > lines.length) throw new Error('area light: truncated template');
    const endTime = ints(head, 1, 'end time')[0] as number;
    const lights = [1, 2, 3, 4].map((k) => {
      const line = lines[i + k] as string;
      if (ints(line, 1, 'light')[0] !== 1) return null;
      const [, r, g, b, x, y, z] = ints(line, 7, 'light') as [number, number, number, number, number, number, number];
      return { color: [r, g, b] as [number, number, number], direction: [clamp(x), clamp(y), clamp(z)] as [number, number, number] };
    });
    templates.push({
      endTime,
      lights,
      diffuse: rgb(lines[i + 5] as string, 'diffuse'),
      ambient: rgb(lines[i + 6] as string, 'ambient'),
      specular: rgb(lines[i + 7] as string, 'specular'),
      emission: rgb(lines[i + 8] as string, 'emission'),
    });
    i += LINES_PER_TEMPLATE;
  }
  if (templates.length === 0) throw new Error('area light: no templates');
  return templates;
}

/** The template active at `secondsSinceMidnight`: the first whose end time is later, else the first (as the field does). */
export function templateAt(templates: readonly RawLightTemplate[], secondsSinceMidnight: number): RawLightTemplate {
  const t = secondsSinceMidnight / 2;
  return templates.find((x) => x.endTime > t) ?? (templates[0] as RawLightTemplate);
}
