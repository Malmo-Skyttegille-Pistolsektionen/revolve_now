/**
 * Turns whatever audio the browser can decode - M4A from a phone, MP3, a PCM
 * WAV - into an IMA ADPCM WAV the device already plays (#273), a quarter the
 * size of PCM.
 *
 * The decoding is the browser's own, so it costs the bundle nothing and the
 * device no flash; an on-device decoder measured 182 KB per app slot.
 */
import type { Messages } from '../i18n/messages';
import { encodeImaAdpcmWav, isDeviceAdpcmWav, maxSamplesFor } from './ima-adpcm';

/** The rate of the shipped clips. Plenty for speech, and a quarter of a 48 kHz recording. */
const CONVERTED_SAMPLE_RATE = 24_000;

/**
 * Refused before decoding, since decoded audio is 32-bit float per channel.
 * For a WAV the size bounds that; 32 MiB still holds 86 s of 24-bit 48 kHz
 * stereo. A compressed file can hold an hour in the same room, so it gets a
 * cap sized for the clip it could become - 86 s even at 320 kbps is 3.4 MB.
 */
export const MAX_WAV_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_COMPRESSED_SOURCE_BYTES = 8 * 1024 * 1024;

/**
 * Above this the duration is read from the file's metadata before decoding,
 * which still leaves a ~17 min compressed file to refuse. Below it decoding is
 * cheap, and a short voice memo is not kept waiting on a probe.
 */
const PROBE_ABOVE_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 2000;

/** Converted clips go up under one short name: the device reads only the extension, and the cap counts the envelope. */
const CONVERTED_FILENAME = 'upload.wav';

export class ConversionError extends Error {
  /** True when the browser could not decode the file at all, as opposed to it being refused. */
  readonly undecodable: boolean;

  constructor(message: string, undecodable = false) {
    super(message);
    this.name = 'ConversionError';
    this.undecodable = undecodable;
  }
}

export function maxConvertedSeconds(maxBytes: number): number {
  return maxSamplesFor(maxBytes) / CONVERTED_SAMPLE_RATE;
}

function isWavName(name: string): boolean {
  return name.toLowerCase().endsWith('.wav');
}

/** Duration from the container's metadata, or null when the browser will not say in time. */
function probeSeconds(source: File): Promise<number | null> {
  if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }
  const url = URL.createObjectURL(source);
  const audio = new Audio();
  return new Promise<number | null>((resolve) => {
    const finish = (seconds: number | null): void => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => finish(null);
    audio.preload = 'metadata';
    audio.src = url;
  });
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

export interface PreparedClip {
  file: File;
  /** False when `file` is the source itself, already in the device's format. */
  converted: boolean;
  /** Known only for a converted clip. */
  seconds: number | null;
}

/** `t` words the refusals: this is not a component, so the caller passes its dictionary in. */
export async function convertToDeviceWav(source: File, maxBytes: number, t: Messages['audios']): Promise<PreparedClip> {
  const maxSeconds = maxConvertedSeconds(maxBytes);
  const tooLong = (seconds: number): ConversionError =>
    new ConversionError(t.convert.tooLong(source.name, seconds, maxSeconds));

  let bytes: ArrayBuffer;
  try {
    // A clip already in the device's format is sent as it is, whether or not
    // this browser could decode it: converting again only loses quality.
    if (isDeviceAdpcmWav(new Uint8Array(await source.slice(0, 4096).arrayBuffer()))) {
      return { file: source, converted: false, seconds: null };
    }
    const cap = isWavName(source.name) ? MAX_WAV_SOURCE_BYTES : MAX_COMPRESSED_SOURCE_BYTES;
    if (source.size > cap) {
      throw new ConversionError(t.convert.tooBig(source.name, source.size, cap));
    }
    if (typeof OfflineAudioContext === 'undefined') {
      throw new ConversionError(t.convert.unsupported, true);
    }
    if (source.size > PROBE_ABOVE_BYTES) {
      // Metadata can be an estimate (VBR MP3 without a header); the margin
      // keeps a borderline clip for the exact check after decoding.
      const probed = await probeSeconds(source);
      if (probed !== null && probed > maxSeconds + 5) throw tooLong(probed);
    }
    bytes = await source.arrayBuffer();
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ConversionError(t.convert.unreadable(source.name));
  }

  let decoded: AudioBuffer;
  try {
    // An offline context decodes straight to its own rate, so this is the
    // resample too, and it needs no user gesture to start. Built in here
    // because an engine refusing the rate is as undecodable as a bad file.
    decoded = await new OfflineAudioContext(1, 1, CONVERTED_SAMPLE_RATE).decodeAudioData(bytes);
  } catch {
    throw new ConversionError(t.convert.undecodable(source.name), true);
  }

  const seconds = decoded.length / decoded.sampleRate;
  if (decoded.length === 0) {
    throw new ConversionError(t.convert.silent(source.name));
  }
  // The encoded size depends on the sample count alone, whatever the rate.
  if (decoded.length > maxSamplesFor(maxBytes)) {
    throw tooLong(seconds);
  }

  const wav = encodeImaAdpcmWav(toMonoPcm16(decoded), decoded.sampleRate);
  return { file: new File([wav], CONVERTED_FILENAME, { type: 'audio/wav' }), converted: true, seconds };
}
