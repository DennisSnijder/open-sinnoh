import type { AudioHost, Registries, StubLog } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/** Native field tasks address SDAT sequence numbers; the existing AudioHost owns players and waits. */
export class FieldSound {
  private readonly sequences: Map<number, Id>;
  constructor(readonly audio: AudioHost, private readonly reg: Registries, private readonly log: StubLog) {
    this.sequences = new Map([...reg.sequences.values()].flatMap((s) => s.sourceIndex === undefined ? [] : [[s.sourceIndex, s.id] as const]));
  }
  /** A sequence by its decomp name (`SEQ_SE_PL_SYUWA3`), or undefined (logged) when the packs have none. */
  private named(name: string): Id | undefined {
    for (const s of this.reg.sequences.values()) if (s.id.endsWith(`:${name}`)) return s.id;
    this.log.stub('audio:sequence-missing', `no sequence ${name} in the packs: not played`);
    return undefined;
  }
  /** Sound_PlayEffect by name; `ifIdle`: unless it plays already (the Distortion World's PlaySoundIfNotActive). */
  playNamed(name: string, ifIdle = false): void {
    const id = this.named(name);
    if (id && !(ifIdle && this.audio.sePlaying(id))) this.audio.playSe(id);
  }
  /** Sound_PlayFanfare by name. */
  fanfareNamed(name: string): void {
    const id = this.named(name);
    if (id) this.audio.playFanfare(id);
  }
  stopNamed(name: string): void {
    const id = this.named(name);
    if (id) this.audio.stopSe(id);
  }
  /** Sound_PlayPokemonCry(species, 0) by the species' decomp name. */
  cry(species: string): void {
    const sp = [...this.reg.species.values()].find((s) => s.id.endsWith(`:${species}`));
    if (!sp) throw new Error(`world: no species ${species} for its cry`);
    this.audio.playCry(sp.id);
  }
  private sequence(source: number): Id | undefined {
    if (source === 0) return;
    const id = this.sequences.get(source);
    if (!id) this.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${source} in the packs: not played`);
    return id;
  }
  play(source: number): void {
    const id = this.sequence(source);
    if (id) this.audio.playSe(id);
  }
  stop(source: number): void {
    const id = this.sequence(source);
    if (id) this.audio.stopSe(id);
  }
  playing(source: number): boolean {
    const id = this.sequence(source);
    return id !== undefined && this.audio.sePlaying(id);
  }
}
