import { printTextMarkup, type TextToken } from '@opensinnoh/contracts';

/** Gen 4 control codes (decomp include/constants/charcode.h, tools/msgenc/charmap.txt). */
export const CHAR_CR = 0xe000;
export const CHAR_CLEAR = 0x25bc;
export const CHAR_SCROLL = 0x25bd;
export const CHAR_COMPRESSED = 0xf100;
export const CHAR_COMMAND = 0xfffe;
export const CHAR_EOS = 0xffff;

const NUMERIC_COMMANDS: Record<number, 'color' | 'size' | 'pause' | 'wait' | 'cursor_x' | 'cursor_y' | 'indicator'> = {
  0xff00: 'color',
  0xff01: 'size',
  0x0200: 'indicator',
  0x0201: 'pause',
  0x0202: 'wait',
  0x0203: 'cursor_x',
  0x0204: 'cursor_y',
};

/**
 * Unpacks a 0xF100 trainer-name string: 9-bit chars packed into the low 15 bits of each u16 (low bits
 * first), ended by 0x1FF.
 */
export function unpackCompressed(codes: ArrayLike<number>, start: number): number[] {
  const out: number[] = [];
  let bits = 0;
  let nbits = 0;
  for (let i = start; i < codes.length; i++) {
    let w = codes[i] as number;
    // The string's 0xFFFF end code doubles as the terminator when the packed data ends on a unit boundary.
    if (w === CHAR_EOS) w = 0x7fff;
    else if (w & 0x8000) throw new Error(`compressed string: unit 0x${w.toString(16)} has bit 15 set`);
    bits |= w << nbits;
    nbits += 15;
    while (nbits >= 9) {
      const c = bits & 0x1ff;
      if (c === 0x1ff) return out;
      out.push(c);
      bits >>>= 9;
      nbits -= 9;
    }
  }
  throw new Error('compressed string: missing 0x1FF terminator');
}

/** Inverse of unpackCompressed, for original test fixtures. */
export function packCompressed(chars: readonly number[]): number[] {
  const out = [CHAR_COMPRESSED];
  let bits = 0;
  let nbits = 0;
  for (const c of [...chars, 0x1ff]) {
    if (c > 0x1ff) throw new Error(`compressed string: char 0x${c.toString(16)} does not fit in 9 bits`);
    bits |= c << nbits;
    nbits += 9;
    while (nbits >= 15) {
      out.push(bits & 0x7fff);
      bits >>>= 15;
      nbits -= 15;
    }
  }
  if (nbits > 0) out.push(bits);
  return out;
}

export interface TextDecodeStats {
  unknownChars: Map<number, number>;
}

/**
 * Decodes one message (raw char codes, as from decodeMessageBank) into OpenSinnoh markup.
 * Unmapped char codes become `{raw HHHH}` (counted in stats); malformed commands throw.
 */
export function decodeText(codes: ArrayLike<number>, chars: ReadonlyMap<number, string>, stats?: TextDecodeStats): string {
  const tokens: TextToken[] = [];
  let run = '';
  const flush = () => {
    if (run) tokens.push({ kind: 'chars', value: run });
    run = '';
  };
  const char = (c: number) => {
    const ch = chars.get(c);
    if (ch !== undefined) {
      run += ch;
      return;
    }
    flush();
    tokens.push({ kind: 'raw', type: c, args: [] });
    if (stats) stats.unknownChars.set(c, (stats.unknownChars.get(c) ?? 0) + 1);
  };
  let ended = false;
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i] as number;
    if (c === CHAR_EOS) {
      ended = true;
      if (i !== codes.length - 1) throw new Error(`text: ${codes.length - 1 - i} codes after end of string`);
      break;
    }
    if (c === CHAR_CR) {
      flush();
      tokens.push({ kind: 'newline' });
    } else if (c === CHAR_CLEAR || c === CHAR_SCROLL) {
      flush();
      tokens.push({ kind: c === CHAR_CLEAR ? 'clear' : 'scroll' });
    } else if (c === CHAR_COMPRESSED) {
      unpackCompressed(codes, i + 1).forEach(char);
      ended = true;
      break;
    } else if (c === CHAR_COMMAND) {
      if (i + 2 >= codes.length) throw new Error('text: truncated command');
      const type = codes[i + 1] as number;
      const nargs = codes[i + 2] as number;
      if (i + 3 + nargs > codes.length) throw new Error(`text: command 0x${type.toString(16)} has ${nargs} args past the end`);
      const args = Array.from({ length: nargs }, (_, k) => codes[i + 3 + k] as number);
      i += 2 + nargs;
      flush();
      const hi = type >> 8;
      const numeric = NUMERIC_COMMANDS[type];
      if ((hi === 0x01 || hi === 0x05 || hi === 0x06) && nargs >= 1) tokens.push({ kind: 'var', slot: args[0] as number });
      else if (numeric && nargs === 1) tokens.push({ kind: numeric, value: args[0] as number });
      else tokens.push({ kind: 'raw', type, args });
    } else char(c);
  }
  if (!ended) throw new Error('text: missing end of string (0xFFFF)');
  flush();
  return printTextMarkup(tokens);
}
