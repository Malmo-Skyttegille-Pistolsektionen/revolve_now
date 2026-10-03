import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
  BLOCK_ALIGN,
  encodedWavBytes,
  encodeImaAdpcmWav,
  maxSamplesFor,
  SAMPLES_PER_BLOCK,
} from '../src/lib/ima-adpcm';

// chirp-adpcm.wav is `firmware/tools/wav_to_adpcm.py` run over chirp-pcm16.wav:
// 1200 samples at 24 kHz, so two full blocks and a padded third, with a
// full-scale square burst that drives the step index to its ceiling and back.
const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data/adpcm');
const pcmWav = readFileSync(path.join(DATA, 'chirp-pcm16.wav'));
const adpcmWav = readFileSync(path.join(DATA, 'chirp-adpcm.wav'));

/** Python's `wave` writes the canonical 44-byte header. */
function pcmSamples(wav: Buffer): Int16Array {
  const samples = new Int16Array((wav.length - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(44 + i * 2);
  return samples;
}

describe('encodeImaAdpcmWav', () => {
  it('is byte-identical to the build tool that transcodes the shipped clips', () => {
    const encoded = encodeImaAdpcmWav(pcmSamples(pcmWav), 24_000);
    expect(Buffer.from(encoded).equals(adpcmWav)).toBe(true);
  });

  it('refuses an empty clip rather than writing a WAV with no blocks', () => {
    expect(() => encodeImaAdpcmWav(new Int16Array(0), 24_000)).toThrow();
  });
});

describe('size arithmetic', () => {
  it('predicts the encoded size exactly', () => {
    expect(encodedWavBytes(pcmSamples(pcmWav).length)).toBe(adpcmWav.length);
  });

  it('fits the longest clip it allows, and one sample more does not', () => {
    const max = maxSamplesFor(1024 * 1024 - 1024);
    expect(max % SAMPLES_PER_BLOCK).toBe(0);
    expect(encodedWavBytes(max)).toBeLessThanOrEqual(1024 * 1024 - 1024);
    expect(encodedWavBytes(max + 1)).toBe(encodedWavBytes(max) + BLOCK_ALIGN);
    expect(encodedWavBytes(max + 1)).toBeGreaterThan(1024 * 1024 - 1024);
  });
});
