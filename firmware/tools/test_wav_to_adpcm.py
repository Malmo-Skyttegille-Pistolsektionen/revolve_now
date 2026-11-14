"""wav_to_adpcm.py against the firmware's decoder.

`decode_block` is a port of rt::decode_ima_adpcm_block
(lib/rt_logic/ima_adpcm.cpp). It is proven on the same ffmpeg vector
host_test/test_ima_adpcm pins the C++ against, and then used to check the
property the encoder exists for: its predictor lands exactly where the
decoder's does, sample by sample.
"""

import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

import wav_to_adpcm as codec

TOOL = Path(__file__).with_name("wav_to_adpcm.py")

HEADER_BYTES = 4
MAX_INDEX = 88


def decode_block(block: bytes, out_capacity: int = 1 << 20) -> list[int]:
    if len(block) < HEADER_BYTES or out_capacity == 0:
        return []
    predictor = struct.unpack_from("<h", block, 0)[0]
    index = min(block[2], MAX_INDEX)
    out = [predictor]
    for byte in block[HEADER_BYTES:]:
        for code in (byte & 0x0F, byte >> 4):  # low nibble first
            if len(out) >= out_capacity:
                return out
            step = codec.STEP_TABLE[index]
            delta = ((2 * (code & 7) + 1) * step) >> 3
            predictor = predictor - delta if code & 8 else predictor + delta
            predictor = max(-32768, min(32767, predictor))
            out.append(predictor)
            index = max(0, min(MAX_INDEX, index + codec.INDEX_TABLE[code]))
    return out


def encoder_track(samples: list[int]) -> list[int]:
    """The reconstruction the encoder believes the decoder will produce."""
    track = []
    for start in range(0, len(samples), codec.SAMPLES_PER_BLOCK):
        chunk = samples[start : start + codec.SAMPLES_PER_BLOCK]
        predictor, index = chunk[0], 0
        track.append(predictor)
        for sample in chunk[1:]:
            _, predictor, index = codec.encode_sample(sample, predictor, index)
            track.append(predictor)
    return track


def make_signal() -> list[int]:
    # A rising chirp with a loud burst and a clipped stretch, over several
    # blocks, so the step index has to walk up and down and saturate.
    rate = 24000
    samples = []
    for n in range(3 * codec.SAMPLES_PER_BLOCK + 123):
        t = n / rate
        value = 12000 * math.sin(2 * math.pi * (200 + 1500 * t) * t)
        if 700 <= n < 760:
            value *= 3  # clips at the int16 rails
        samples.append(max(-32768, min(32767, round(value))))
    return samples


# --- the port --------------------------------------------------------------

# host_test/test_ima_adpcm: encoded with these tables, decoded by ffmpeg.
FFMPEG_BLOCK = bytes([0xE8, 0x03, 0x05, 0x00, 0xF7, 0x83, 0x60, 0x1E])
FFMPEG_EXPECTED = [1000, 1022, 976, 1024, 1018, 1023, 1089, 971, 1019]


def test_the_port_decodes_the_ffmpeg_vector():
    assert decode_block(FFMPEG_BLOCK) == FFMPEG_EXPECTED


def test_the_port_clamps_and_bounds_like_the_firmware():
    assert decode_block(FFMPEG_BLOCK[:3]) == []
    assert decode_block(FFMPEG_BLOCK[:4]) == [1000]
    assert decode_block(FFMPEG_BLOCK, out_capacity=4) == FFMPEG_EXPECTED[:4]
    hostile = bytearray(FFMPEG_BLOCK)
    hostile[2] = 200
    assert len(decode_block(bytes(hostile))) == 9


# --- encoder against decoder -----------------------------------------------


def blocks_of(data: bytes) -> list[bytes]:
    assert len(data) % codec.BLOCK_ALIGN == 0
    return [data[i : i + codec.BLOCK_ALIGN] for i in range(0, len(data), codec.BLOCK_ALIGN)]


def test_the_decoder_lands_exactly_where_the_encoder_predicted():
    samples = make_signal()
    data, block_count = codec.encode(samples)
    decoded = [s for block in blocks_of(data) for s in decode_block(block)]

    assert block_count == len(blocks_of(data)) == 4
    # Byte-exact, not approximately: an encoder whose idea of the
    # reconstruction differs from the decoder's drifts over a block.
    assert decoded[: len(samples)] == encoder_track(samples)


def test_the_reconstruction_is_close_to_the_input():
    samples = make_signal()
    data, _ = codec.encode(samples)
    decoded = [s for block in blocks_of(data) for s in decode_block(block)][: len(samples)]

    error = math.sqrt(sum((a - b) ** 2 for a, b in zip(samples, decoded)) / len(samples))
    signal = math.sqrt(sum(a * a for a in samples) / len(samples))
    snr_db = 20 * math.log10(signal / error)
    assert snr_db > 20, f"SNR {snr_db:.1f} dB"

    # The header sample of every block is stored verbatim.
    for start in range(0, len(samples), codec.SAMPLES_PER_BLOCK):
        assert decoded[start] == samples[start]


# --- the file the build stages ---------------------------------------------


def test_a_transcoded_wav_decodes_back_through_its_own_headers(tmp_path):
    samples = make_signal()
    src = tmp_path / "clip.wav"
    with wave.open(str(src), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(22050)
        out.writeframes(struct.pack(f"<{len(samples)}h", *samples))

    staged = tmp_path / "stage"
    # By path, from another directory, the way stage_shipped.cmake runs it.
    subprocess.run(
        [sys.executable, str(TOOL), str(staged), str(src)], check=True, cwd=tmp_path, capture_output=True
    )
    wav = (staged / "clip.wav").read_bytes()

    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert struct.unpack_from("<I", wav, 4)[0] == len(wav) - 8
    chunks = {}
    pos = 12
    while pos < len(wav):
        cid, size = wav[pos : pos + 4], struct.unpack_from("<I", wav, pos + 4)[0]
        chunks[cid] = wav[pos + 8 : pos + 8 + size]
        pos += 8 + size

    tag, channels, rate, _, align, bits, _, per_block = struct.unpack("<HHIIHHHH", chunks[b"fmt "])
    assert (tag, channels, rate, align, bits) == (0x11, 1, 22050, codec.BLOCK_ALIGN, 4)
    assert per_block == codec.SAMPLES_PER_BLOCK
    count = struct.unpack("<I", chunks[b"fact"])[0]
    assert count == len(samples)

    decoded = [s for block in blocks_of(chunks[b"data"]) for s in decode_block(block)][:count]
    assert decoded == encoder_track(samples)
