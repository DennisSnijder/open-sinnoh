/**
 * OpenSinnoh text markup (contracts v0.1). Message records store this; the importer converts Gen 4
 * char codes into it and the text renderer parses it. Grammar:
 *
 *   plain characters      Unicode text
 *   "\n"                  line break (Gen 4 0xE000)
 *   {clear}               wait for a key, then clear the box (0x25BC)
 *   {scroll}              wait for a key, then scroll one line (0x25BD)
 *   {var N}               string template slot N (0xFFFE 0x01xx/0x05xx/0x06xx)
 *   {color N} {size N} {pause N} {wait N} {cursor_x N} {cursor_y N} {indicator N}
 *   {raw HHHH a,b,...}    any other 0xFFFE command, hex type + decimal args, passed through
 *   {{  }}                literal braces
 */
export type TextToken =
  | { kind: 'chars'; value: string }
  | { kind: 'newline' }
  | { kind: 'clear' }
  | { kind: 'scroll' }
  | { kind: 'var'; slot: number }
  | { kind: 'color' | 'size' | 'pause' | 'wait' | 'cursor_x' | 'cursor_y' | 'indicator'; value: number }
  | { kind: 'raw'; type: number; args: number[] };

const NUMERIC = ['color', 'size', 'pause', 'wait', 'cursor_x', 'cursor_y', 'indicator'] as const;

export function parseTextMarkup(text: string): TextToken[] {
  const out: TextToken[] = [];
  let chars = '';
  const flush = () => {
    if (chars) out.push({ kind: 'chars', value: chars });
    chars = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '{' && text[i + 1] === '{') {
      chars += '{';
      i++;
    } else if (c === '}' && text[i + 1] === '}') {
      chars += '}';
      i++;
    } else if (c === '\n') {
      flush();
      out.push({ kind: 'newline' });
    } else if (c === '{') {
      const end = text.indexOf('}', i);
      if (end < 0) throw new Error(`text markup: unclosed "{" at ${i}`);
      flush();
      const [name, arg] = text.slice(i + 1, end).split(' ', 2) as [string, string | undefined];
      if (name === 'clear' || name === 'scroll') out.push({ kind: name });
      else if (name === 'var') out.push({ kind: 'var', slot: num(arg, text) });
      else if ((NUMERIC as readonly string[]).includes(name)) out.push({ kind: name as (typeof NUMERIC)[number], value: num(arg, text) });
      else if (name === 'raw') {
        const rest = text.slice(i + 5, end).trim();
        const [type, args = ''] = rest.split(' ', 2) as [string, string?];
        out.push({ kind: 'raw', type: parseInt(type, 16), args: args ? args.split(',').map((a) => num(a, text)) : [] });
      } else throw new Error(`text markup: unknown tag {${name}} in "${text}"`);
      i = end;
    } else if (c === '}') {
      throw new Error(`text markup: stray "}" in "${text}"`);
    } else chars += c;
  }
  flush();
  return out;
}

function num(s: string | undefined, text: string): number {
  if (s === undefined || !/^\d+$/.test(s.trim())) throw new Error(`text markup: bad number in "${text}"`);
  return Number(s);
}

export function printTextMarkup(tokens: readonly TextToken[]): string {
  return tokens
    .map((t) => {
      switch (t.kind) {
        case 'chars':
          return t.value.replace(/\{/g, '{{').replace(/\}/g, '}}');
        case 'newline':
          return '\n';
        case 'clear':
        case 'scroll':
          return `{${t.kind}}`;
        case 'var':
          return `{var ${t.slot}}`;
        case 'raw':
          return `{raw ${t.type.toString(16).toUpperCase().padStart(4, '0')}${t.args.length ? ' ' + t.args.join(',') : ''}}`;
        default:
          return `{${t.kind} ${t.value}}`;
      }
    })
    .join('');
}
