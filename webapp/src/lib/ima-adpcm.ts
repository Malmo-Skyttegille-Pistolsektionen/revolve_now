/**
 * PCM16 to IMA ADPCM WAV, for clips converted in the browser before upload.
 *
 * Mirrored logic: a port of `firmware/tools/wav_to_adpcm.py`, which transcodes
 * the shipped clips, and byte-identical to it (`test/ima-adpcm.test.ts`). An
 * upload converted here is therefore the same kind of file as a shipped clip,
 * and reaches the same `parse_wav_header` and `decode_ima_adpcm_block`.
 */

// The IMA/DVI tables. They are the format, so they are copied, not derived.
const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

export const BLOCK_ALIGN = 256;
export const SAMPLES_PER_BLOCK = 1 + (BLOCK_ALIGN - 4) * 2;

/** RIFF + `fmt ` (20) + `fact` + `data` headers: everything that is not a block. */
export const WAV_HEADER_BYTES = 12 + 8 + 20 + 12 + 8;

export function encodedWavBytes(sampleCount: number): number {
  return WAV_HEADER_BYTES + Math.ceil(sampleCount / SAMPLES_PER_BLOCK) * BLOCK_ALIGN;
}

/** The most samples whose encoding fits in `maxBytes`. */
export function maxSamplesFor(maxBytes: number): number {
  return Math.floor((maxBytes - WAV_HEADER_BYTES) / BLOCK_ALIGN) * SAMPLES_PER_BLOCK;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Mono IMA ADPCM WAV (`wFormatTag = 0x11`), the layout `wav_to_adpcm.py` writes. */
export function encodeImaAdpcmWav(samples: Int16Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  if (samples.length === 0) {
    throw new Error('No samples to encode');
  }

  const blocks = Math.ceil(samples.length / SAMPLES_PER_BLOCK);
  const dataBytes = blocks * BLOCK_ALIGN;
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, out.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 20, true);
  view.setUint16(20, 0x11, true); // IMA ADPCM
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, Math.floor((sampleRate * BLOCK_ALIGN) / SAMPLES_PER_BLOCK), true);
  view.setUint16(32, BLOCK_ALIGN, true);
  view.setUint16(34, 4, true);
  view.setUint16(36, 2, true); // cbSize
  view.setUint16(38, SAMPLES_PER_BLOCK, true);
  // `fact` carries the true length, which is how the player trims the padding
  // in the final block.
  ascii(40, 'fact');
  view.setUint32(44, 4, true);
  view.setUint32(48, samples.length, true);
  ascii(52, 'data');
  view.setUint32(56, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (let start = 0; start < samples.length; start += SAMPLES_PER_BLOCK) {
    const end = Math.min(start + SAMPLES_PER_BLOCK, samples.length);
    let predictor = samples[start];
    let index = 0;
    view.setInt16(offset, predictor, true);
    out[offset + 2] = index;
    out[offset + 3] = 0;
    offset += 4;

    // Padding nibbles stay zero: the buffer starts zeroed, and the last block
    // simply stops writing early.
    for (let i = start + 1, nibble = 0; i < end; i++, nibble++) {
      const step = STEP_TABLE[index];
      let diff = samples[i] - predictor;
      let code = 0;
      if (diff < 0) {
        code = 8;
        diff = -diff;
      }
      if (diff >= step) {
        code |= 4;
        diff -= step;
      }
      if (diff >= step >> 1) {
        code |= 2;
        diff -= step >> 1;
      }
      if (diff >= step >> 2) {
        code |= 1;
      }

      // Move the predictor by what the decoder will reconstruct, not by what
      // was subtracted above - see the matching note in wav_to_adpcm.py.
      const delta = ((2 * (code & 7) + 1) * step) >> 3;
      predictor = clamp(predictor + (code & 8 ? -delta : delta), -32768, 32767);
      index = clamp(index + INDEX_TABLE[code], 0, 88);

      out[offset + (nibble >> 1)] |= nibble & 1 ? code << 4 : code;
    }
    offset += BLOCK_ALIGN - 4;
  }

  return out;
}
