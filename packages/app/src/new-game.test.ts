import { describe, expect, it } from 'vitest';
import { checkNewGame } from './new-game.ts';

const font = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz é';
const form = (player: unknown, rival: unknown, gender: unknown = 'female') => ({ names: { player, rival }, gender });

describe('new-game settings', () => {
  it('accepts 1–7 font characters per name and a gender', () => {
    expect(checkNewGame(form('Lucas', 'Barry é', 'male'), font)).toEqual({ names: { player: 'Lucas', rival: 'Barry é' }, gender: 'male' });
    expect(checkNewGame(form('A', 'B'), font).gender).toBe('female');
  });

  it('rejects empty, long, unknown-character names and bad genders with a message', () => {
    expect(() => checkNewGame(form('', 'B'), font)).toThrow('Your name must be 1 to 7 characters.');
    expect(() => checkNewGame(form('Abcdefgh', 'B'), font)).toThrow('Your name must be 1 to 7 characters.');
    expect(() => checkNewGame(form('A', 'B{1}'), font)).toThrow("Your rival's name uses characters the game cannot show: { 1 }");
    expect(() => checkNewGame(form('A', 7), font)).toThrow("Your rival's name is missing.");
    expect(() => checkNewGame(form('A', 'B', 'other'), font)).toThrow('Pick a gender.');
    expect(() => checkNewGame(null, font)).toThrow('Your name is missing.');
  });
});
