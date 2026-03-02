"""
WebSocket Speech-to-Text — Robust Streaming
Install: pip install websockets faster-whisper torch av numpy
Run:     python server.py
"""

import asyncio
import json
import logging
import io
import numpy as np
import av
import websockets
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

import torch
if torch.cuda.is_available():
    DEVICE, COMPUTE_TYPE = "cuda", "float16"
    logging.info(f"✓ GPU: {torch.cuda.get_device_name(0)}")
else:
    DEVICE, COMPUTE_TYPE = "cpu", "int8"
    logging.warning("⚠ No GPU — using CPU")

MODEL_SIZE = "large-v3"
logging.info(f"Loading {MODEL_SIZE} on {DEVICE}...")
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
logging.info("Model ready ✓")

SAMPLE_RATE    = 16000
MAX_BUFFER_SEC = 30


def decode_webm(audio_bytes: bytes) -> np.ndarray:
    try:
        container = av.open(io.BytesIO(audio_bytes))
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
        samples = []
        for frame in container.decode(audio=0):
            for r in resampler.resample(frame):
                samples.append(r.to_ndarray()[0])
        for r in resampler.resample(None):
            samples.append(r.to_ndarray()[0])
        container.close()
        if not samples:
            return np.array([], dtype=np.float32)
        arr = np.concatenate(samples).astype(np.float32)
        logging.info(f"Decoded: {len(arr)/SAMPLE_RATE:.2f}s  rms={float(np.sqrt(np.mean(arr**2))):.4f}")
        return arr
    except Exception as e:
        logging.error(f"Decode error: {e}")
        return np.array([], dtype=np.float32)


def has_speech(audio: np.ndarray, threshold: float = 0.003) -> bool:
    """Quick energy check — skip transcription if audio is just silence."""
    if len(audio) == 0:
        return False
    rms = float(np.sqrt(np.mean(audio ** 2)))
    return rms > threshold


def run_transcribe(audio: np.ndarray, beam: int = 3) -> str:
    if len(audio) < SAMPLE_RATE * 0.8:   # need at least 0.8s
        return ""
    if not has_speech(audio):
        logging.info("Skipping — no speech energy detected")
        return ""
    segments, _ = model.transcribe(
        audio,
        beam_size=beam,
        language="en",
        vad_filter=True,                  # let whisper also filter silence
        vad_parameters=dict(
            min_silence_duration_ms=300,
            speech_pad_ms=200,
            threshold=0.3,                # VAD sensitivity (0-1, lower = more sensitive)
        ),
        temperature=0.0,
        condition_on_previous_text=False,
        without_timestamps=True,
    )
    return " ".join(s.text.strip() for s in segments).strip()


async def handler(websocket):
    logging.info(f"Connected: {websocket.remote_address}")
    loop = asyncio.get_event_loop()

    full_audio      = np.array([], dtype=np.float32)
    last_text       = ""
    pending_task: asyncio.Task | None = None

    async def transcribe_and_send(audio_snapshot: np.ndarray, is_final: bool):
        nonlocal last_text
        beam = 5 if is_final else 3
        text = await loop.run_in_executor(None, run_transcribe, audio_snapshot, beam)

        if not text:
            return

        if text == last_text and not is_final:
            return

        last_text = text
        msg_type  = "transcript" if is_final else "partial"
        logging.info(f"{'FINAL' if is_final else 'partial'}: {text!r}")
        try:
            await websocket.send(json.dumps({"type": msg_type, "text": text}))
        except Exception:
            pass

    try:
        async for message in websocket:

            if isinstance(message, str):
                data     = json.loads(message)
                msg_type = data.get("type")

                if msg_type in ("audio_chunk", "audio_final"):
                    raw   = await websocket.recv()
                    chunk = await loop.run_in_executor(None, decode_webm, raw)

                    if chunk.size == 0:
                        continue

                    # Append to rolling buffer
                    full_audio = np.concatenate([full_audio, chunk])

                    # Cap buffer at MAX_BUFFER_SEC
                    max_samples = SAMPLE_RATE * MAX_BUFFER_SEC
                    if len(full_audio) > max_samples:
                        full_audio = full_audio[-max_samples:]

                    if msg_type == "audio_chunk":
                        # Cancel previous pending transcription — we have newer audio now
                        if pending_task and not pending_task.done():
                            pending_task.cancel()

                        snapshot     = full_audio.copy()
                        pending_task = asyncio.ensure_future(
                            transcribe_and_send(snapshot, False)
                        )

                    else:
                        # Final — cancel any pending, do full accurate pass
                        if pending_task and not pending_task.done():
                            pending_task.cancel()

                        snapshot = full_audio.copy()
                        await transcribe_and_send(snapshot, True)
                        full_audio   = np.array([], dtype=np.float32)
                        last_text    = ""
                        pending_task = None

                elif msg_type == "reset":
                    if pending_task and not pending_task.done():
                        pending_task.cancel()
                    full_audio   = np.array([], dtype=np.float32)
                    last_text    = ""
                    pending_task = None
                    logging.info("Reset")

    except websockets.exceptions.ConnectionClosedOK:
        logging.info(f"Disconnected: {websocket.remote_address}")
    except Exception as e:
        logging.error(f"Error: {e}", exc_info=True)


async def main():
    logging.info("Starting server on ws://localhost:8765")
    async with websockets.serve(
        handler, "localhost", 8765,
        max_size=100 * 1024 * 1024,
        ping_interval=20,
        ping_timeout=60,
    ):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())