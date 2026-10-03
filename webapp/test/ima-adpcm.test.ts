import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
  BLOCK_ALIGN,
  encodedWavBytes,
  encodeImaAdpcmWav,
  isDeviceAdpcmWav,
  maxSamplesFor,
  SAMPLES_PER_BLOCK,
} from '../src/lib/ima-adpcm';

// chirp-adpcm.wav is `firmware/tools/wav_to_adpcm.py` run over chirp-pcm16.wav:
// 1200 samples at 24 kHz, so two full blocks and a padded third, with a
// full-scale square burst that drives the step index to its ceiling and back.
// After changing the tool, regenerate it from the webapp directory:
//   python3 ../firmware/tools/wav_to_adpcm.py /tmp/out test/data/adpcm/chirp-pcm16.wav
//   cp /tmp/out/chirp-pcm16.wav test/data/adpcm/chirp-adpcm.wav
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

describe('isDeviceAdpcmWav', () => {
  const bytes = (wav: Buffer): Uint8Array => new Uint8Array(wav);

  it('knows the tool output as the device format, and PCM as not', () => {
    expect(isDeviceAdpcmWav(bytes(adpcmWav))).toBe(true);
    expect(isDeviceAdpcmWav(bytes(pcmWav))).toBe(false);
  });

  it('walks to a `fmt ` that is not the first chunk, as the firmware does', () => {
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([5, 0, 0, 0]), Buffer.alloc(6)]);
    const moved = Buffer.concat([adpcmWav.subarray(0, 12), list, adpcmWav.subarray(12)]);
    expect(isDeviceAdpcmWav(bytes(moved))).toBe(true);
  });

  it('refuses what parse_wav_header refuses: stereo, and a block outside 5..512', () => {
    const variant = (offset: number, value: number): Uint8Array => {
      const copy = Buffer.from(adpcmWav);
      copy.writeUInt16LE(value, offset);
      return bytes(copy);
    };
    expect(isDeviceAdpcmWav(variant(22, 2))).toBe(false);
    expect(isDeviceAdpcmWav(variant(32, 4))).toBe(false);
    expect(isDeviceAdpcmWav(variant(32, 513))).toBe(false);
    expect(isDeviceAdpcmWav(variant(32, 512))).toBe(true);
  });
});
