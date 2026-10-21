# Audio: the DS sound system and Platinum's use of it (M4)

Sources: the ROM itself (every claim below about Platinum's data is checked by `packages/audio/src/audio.rom.test.ts`), the decomp (`src/sound*.c`, `field_bgm.c`, `scrcmd_sound.c`, `enc_effects.c`; names and semantics only), and general public knowledge of the NITRO sound formats. No third-party code was read for this work (VGMTrans is permissively licensed and allowed, but was not needed; the decomp's `tools/nitrosfx` is LGPL and was not opened).

## 1. SDAT (`/data/sound/pl_sound_data.sdat`, 7.9 MB)

NITRO header (`SDAT`, BOM, size, header size, 4 blocks), then SYMB, INFO, FAT, FILE. SYMB and INFO each hold 8 list offsets (SEQ, SEQARC, BANK, WAVEARC, PLAYER, GROUP, PLAYER2, STRM); a list is a count and per-entry offsets (0 = empty slot). FAT: per file `{offset, size}` (absolute).

| INFO record | Fields |
|---|---|
| SEQ (12 B) | u16 file, u16 –, u16 bank, u8 volume, u8 channel priority, u8 player priority, u8 player |
| BANK | u16 file, u16 –, u16 wave archive ×4 (0xFFFF none) |
| WAVEARC | u16 file, u16 – |
| PLAYER | u8 max sequences, u16 channel mask, u32 heap |

Platinum: 1,013 sequences (204 loop forever: every BGM), 521 banks, 521 wave archives, 8 players, 17 groups, **no SSAR and no STRM** (sound effects are plain sequences; there are no streams). Players: 0 PV (cries, mask 0xC000), 1 FIELD (0x7FF), 2 ME (fanfares), 3–6 SE_1–4 (0xD800), 7 BGM (0x7FF).

- **SSEQ**: a DATA block whose data offset points at the event bytecode.
- **SBNK**: per program `{u8 type, u16 offset}`; types 1 PCM, 2 PSG (duty 0–7), 3 noise each with `{u16 wave/duty, u16 archive slot, base key, attack, decay, sustain, release, pan}`; 16 drum set (low..high, one sub-instrument per key); 17 key split (8 upper bounds). Platinum uses 7,538 PCM, 277 PSG and 85 noise regions.
- **SWAR/SWAV**: per wave `{format (0 PCM8, 1 PCM16, 2 IMA-ADPCM), loop, rate, timer, loop start (words), loop length (words)}` and samples. Platinum: 494 PCM8, 380 ADPCM waves. ADPCM: 4-byte header (sample, step index), nibbles low first, steps built from shifts, clamped to ±0x7FFF; the loop offset counts the header word.

## 2. The sequencer

- **Sound frame**: the ARM7 sound driver runs every 2728 × 64 cycles of 33.513982 MHz = **5.2095 ms (≈ 191.96 Hz)** (the often-quoted "240 Hz" is the tempo divisor, not the rate). Each frame `tempoCounter += tempo` (× the NNS tempo ratio / 256); every 240 runs one tick; 48 ticks per quarter note, so tempo = BPM.
- **Tracks**: track 0 opens up to 15 others (`0x93`); per tick a track counts its notes' lengths down, then runs commands until a wait. Commands seen in Platinum: notes (key, velocity, varlen length), wait, program, open track, jump, call/return, pan, volume, transpose, pitch bend, bend range, priority, note-wait, modulation depth/speed/range, expression, tempo, sweep pitch, allocate tracks, end. No random, variable or `if` prefixes, ADSR overrides, portamento or ties are used, but the engine implements them (variables: 16 per player + 16 global, initialised to −1; the game never reads or writes them).
- **Note-wait** (`0xC7`) defaults on; every Platinum sequence turns it off (chords are note, note, wait).
- **A note of length 0 plays until its wave ends** (the cry sequence is `tempo, program 0, volume, pan, note 60 len 0, end`).
- **End of a sequence**: a track is done when it has reached `end` *and* its notes have played out; the player stops when all tracks are done. This is what makes `wait_cry` wait for the cry sample. A track's `end` does not release its notes.

## 3. The synth

- 16 channels; PSG square only on 8–13, noise only on 14–15, PCM anywhere. Allocation: in SND's order (4,5,6,7,2,0,3,1,8–11,14,12,15,13) the lowest priority (then quietest) allowed channel is taken unless it outranks the new note (priority = track priority + the sequence's channel priority). A released channel drops to priority 1.
- **Pitch**: timer = base timer × 2^(−pitch/768) (1/64 semitones). PCM base = the SWAV timer (16,756,991 / rate); PSG and noise base 8006 = C4 (16,756,991 / 8006 / 8 = 261.6 Hz).
- **Volume** in 1/10 dB: decibel-square(velocity, track volume, expression, sequence volume, NNS volume) + envelope + LFO, then the hardware's 7-bit volume and divider (1, 2, 4, 16). decibel-square(i) = max(−722, round(400·log10(i/127))); both decibel tables match the ARM7 copies exactly.
- **Envelope** (per frame): level −92,544..0. Attack: level = −((−level × rate) >> 8), rate = 255 − attack below 109, else a 19-entry table (in ARM7, checked). Decay/release: subtract 2v+1 (v < 50), 0x1E00/(126−v), 0x3C00 (126), 0xFFFF (127). Sustain = decibel-square(s) << 7.
- **LFO**: after `delay` frames, counter += speed << 6 (period 0x8000); value = sin(counter >> 8) × depth × range; pitch += value × 64 >> 14, volume += value × 60 >> 14, pan likewise. Sine = round(127 sin(iπ/64)), checked against ARM7.
- **Sweep / portamento**: start offset (key difference << 6 + sweep pitch) decays to 0 over the note (time 0) or (time² × |offset|) >> 11 frames.
- **Output**: our mixer samples each channel with hold (no interpolation, as the DS) at the AudioContext rate, pans linearly, sums and clips. The DS mixes at 32,728 Hz; we do not resample through that rate (a small aliasing difference).

## 4. Platinum's sound usage (decomp)

- **The sound system** (`sound_system.c`) ticks once per main-loop pass (30 Hz in the field): fade counter, the state machine (play, fade in/out, fade-out-then-play, fade-out-then-fade-in) and delayed cries. NNS fades count the same ticks.
- **Field BGM** (`field_bgm.c`): zone header day/night music (night = 20:00–3:59, `IsNight`); a special override (bike, `set_special_bgm`, saved on the DS); surfing plays SEQ_NAMINORI; the Poké Radar SEQ_KUSAGASA; Cycling Road gates an alt. A map load plays the zone BGM (a playing, identical BGM continues). Crossing a zone connection: if the BGM differs, fade out 60 ticks, then play (on the bike, fade in 30). A warp fades out over 40 ticks at its start and **the map change waits for the fade** (FieldTask_ChangeMap state 2).
- **Script ops** (`scrcmd_sound.c`): play/stop music, default music, special BGM, fade out (waits), fade in (waits), pause a BGM player, set BGM, fixed BGM, play/stop/wait SE (waits on the SE player), play/wait cry, play/wait fanfare, current BGM, sequence playing, initial volume. `wait_fanfare` is `Sound_IsBGMPausedByFanfare`: true while the ME player plays and then for **15 checks** (the delay counts only when checked), then it stops the fanfare and unpauses the BGM.
- **Cries** (`sound_playback.c`): SEQ_PV001 played with bank = species number (banks 1–493; Shaymin Sky 494). Variations by `PokemonCryMod`: pitch (faint −3.5 semitones, pinch −1.5, field event +1 …), forced lengths (half: 20 ticks with a 10-tick fade), and an echo (chorus) on a second handle at volume − 30. Reversed waveout cries (Hyper Voice 1, Uproar 1) are not modelled.
- **Battles** (`enc_effects.c`): the battle BGM by encounter (normal wild SEQ_BA_POKE, normal trainer SEQ_BA_TRAIN, gym leaders, rival, Galactic, legendaries by species); the field BGM is paused and resumes with a 40-tick fade in.
- **Fanfares** inside field tasks: the Pokémon Center heal plays SEQ_ASA (72 ticks) and waits for `Sound_IsBGMPausedByFanfare` (+15).

## 5. Determinism

The game's sound system is deterministic and headless: sequence lengths are measured at import by running the sequencer (`Sequence.frames`, `Cry.frames`) and converted to ticks (frames × 174,592 / 1,120,260 cycles, rounded up). The AudioWorklet is output only. The opening replay sends the same audio commands at the same ticks on every run (tests/integration/audio.rom.test.ts).
