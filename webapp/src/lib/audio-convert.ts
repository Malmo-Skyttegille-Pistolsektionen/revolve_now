/**
 * Turns whatever audio the browser can decode - M4A from a phone, MP3 - into
 * an IMA ADPCM WAV the device already plays (#273).
 *
 * The decoding is the browser's own, so it costs the bundle nothing and the
 * device no flash; an on-device decoder measured 182 KB per app slot.
 */
import { encodeImaAdpcmWav, maxSamplesFor } from './ima-adpcm';

/** The rate of the shipped clips. Plenty for speech, and a quarter of a 48 kHz recording. */
export const CONVERTED_SAMPLE_RATE = 24_000;

/**
 * Refused before decoding. Decoded audio is held as 32-bit float per channel,
 * so a long recording costs a phone far more memory than its file size; this
 * is generous for anything that fits the upload cap once converted.
 */
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionError';
  }
}

export function maxConvertedSeconds(maxBytes: number): number {
  return maxSamplesFor(maxBytes) / CONVERTED_SAMPLE_RATE;
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

function wavName(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return `${lastDot > 0 ? name.slice(0, lastDot) : name}.wav`;
}

/** Mixes down to mono and rounds to 16-bit, clipping rather than wrapping. */
function toMonoPcm16(buffer: AudioBuffer): Int16Array {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    out[i] = Math.max(-32768, Math.min(32767, Math.round((sum / channels.length) * 32768)));
  }
  return out;
}

export interface ConvertedClip {
  file: File;
  seconds: number;
}

export async function convertToDeviceWav(source: File, maxBytes: number): Promise<ConvertedClip> {
  if (source.size > MAX_SOURCE_BYTES) {
    throw new ConversionError(
      `"${source.name}" is ${source.size} bytes. Files to convert can be at most ${MAX_SOURCE_BYTES} bytes.`,
    );
  }
  if (typeof OfflineAudioContext === 'undefined') {
    throw new ConversionError('This browser cannot convert audio. Upload a 16-bit PCM WAV instead.');
  }

  // An offline context decodes straight to its own rate, so this is the
  // resample too, and it needs no user gesture to start.
  const context = new OfflineAudioContext(1, 1, CONVERTED_SAMPLE_RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await source.arrayBuffer());
  } catch {
    throw new ConversionError(`This browser could not read "${source.name}" as audio. Try a WAV, M4A or MP3 file.`);
  }

  const seconds = decoded.length / CONVERTED_SAMPLE_RATE;
  if (decoded.length === 0) {
    throw new ConversionError(`"${source.name}" holds no audio.`);
  }
  if (decoded.length > maxSamplesFor(maxBytes)) {
    throw new ConversionError(
      `"${source.name}" is ${formatSeconds(seconds)} long. A converted clip can be at most ` +
        `${formatSeconds(maxConvertedSeconds(maxBytes))}.`,
    );
  }

  const wav = encodeImaAdpcmWav(toMonoPcm16(decoded), CONVERTED_SAMPLE_RATE);
  return { file: new File([wav], wavName(source.name), { type: 'audio/wav' }), seconds };
}
