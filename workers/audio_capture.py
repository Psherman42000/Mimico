#!/usr/bin/env python3
"""
Mimico Audio Capture Worker
Captures WASAPI loopback audio on Windows at 16kHz mono float32.
Sends base64-encoded audio chunks via stdout JSON.
VAD using energy threshold to skip silence.
"""

import json
import sys
import base64
import struct
import io
import traceback
import threading

import numpy as np
import sounddevice as sd


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = 'float32'
BLOCK_SIZE = 1024  # samples per chunk
ENERGY_THRESHOLD = 0.005  # RMS threshold for VAD (tune as needed)
WASAPI_HOST_NAME = 'Windows WASAPI'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    """Write log messages to stderr (never stdout)."""
    print(f"[audio_capture] {msg}", file=sys.stderr, flush=True)


def send_json(obj: dict) -> None:
    """Print a JSON message to stdout, followed by a newline."""
    print(json.dumps(obj), flush=True)


def compute_rms(audio_block: np.ndarray) -> float:
    """Compute RMS energy of a float32 audio block."""
    return float(np.sqrt(np.mean(audio_block ** 2)))


def find_wasapi_loopback_device() -> int | None:
    """
    Find an audio capture device.
    Prefers 'Stereo Mix' / 'Mixagem estéreo' devices,
    then falls back to default input device (microphone).
    Returns the device index or None.
    """
    try:
        devices = sd.query_devices()

        # 1. Prefer Stereo Mix / Mixagem estéreo (loopback built-in)
        for idx, dev in enumerate(devices):
            name_lower = str(dev.get("name", "")).lower()
            if "mixagem" in name_lower or "stereo mix" in name_lower or "what u hear" in name_lower:
                if dev["max_input_channels"] > 0 and dev["hostapi"] in (0, 1, 2):  # MME, DirectSound, WASAPI only
                    log(f"Using stereo mix device: {dev['name']} (idx {idx})")
                    return idx

        # 2. Fall back to default input device (microphone)
        default_device = sd.default.device[0]
        if default_device is not None and default_device >= 0:
            dev = devices[default_device]
            if dev["max_input_channels"] > 0:
                log(f"Using default input device: {dev['name']} (idx {default_device})")
                return default_device

        # 3. Last resort: any input device on MME/DirectSound/WASAPI
        for idx, dev in enumerate(devices):
            if dev["max_input_channels"] > 0 and dev["hostapi"] in (0, 1, 2):
                log(f"Using input device: {dev['name']} (idx {idx})")
                return idx

        log("No input device found")
        return None

    except Exception as exc:
        log(f"Error finding loopback device: {exc}")
        return None


# ---------------------------------------------------------------------------
# Audio capture state
# ---------------------------------------------------------------------------
class AudioCapture:
    def __init__(self):
        self.stream: sd.RawInputStream | None = None
        self.running = False
        self.device_index: int | None = None
        self._audio_buffer: list[np.ndarray] = []
        self._buffer_lock = threading.Lock()

    def start(self) -> bool:
        """Start the audio capture stream."""
        self.device_index = find_wasapi_loopback_device()
        if self.device_index is None:
            send_json({"type": "error", "message": "No audio capture device found"})
            return False

        try:
            # Usar RawInputStream com callback (non-blocking) para compatibilidade WDM-KS
            self.stream = sd.RawInputStream(
                device=self.device_index,
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype=DTYPE,
                blocksize=BLOCK_SIZE,
                callback=self._audio_callback,
            )
            self.stream.start()
            self.running = True
            log("Audio capture started")
            send_json({"type": "status", "status": "started"})
            return True
        except Exception as exc:
            log(f"Failed to start audio stream: {exc}")
            traceback.print_exc(file=sys.stderr)
            send_json({"type": "error", "message": f"Failed to start capture: {exc}"})
            return False

    def stop(self) -> None:
        """Stop the audio capture stream."""
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception as exc:
                log(f"Error stopping stream: {exc}")
        self.stream = None
        self.running = False
        self._audio_buffer.clear()
        log("Audio capture stopped")
        send_json({"type": "status", "status": "stopped"})

    def _audio_callback(self, indata: np.ndarray, frames: int, time_info, status) -> None:
        """Callback invoked by sounddevice with new audio data."""
        if status:
            log(f"Stream status: {status}")

        # VAD: skip if energy below threshold
        rms = compute_rms(indata)
        if rms < ENERGY_THRESHOLD:
            return  # silence — skip sending

        # Store in buffer for processing thread
        with self._buffer_lock:
            self._audio_buffer.append(indata.copy())

        # Encode as base64
        audio_bytes = indata.tobytes()
        b64_data = base64.b64encode(audio_bytes).decode('ascii')

        send_json({
            "type": "audio",
            "data": b64_data,
            "sample_rate": SAMPLE_RATE,
            "channels": CHANNELS,
            "dtype": DTYPE,
            "rms": rms,
        })


# ---------------------------------------------------------------------------
# Main loop — read commands from stdin
# ---------------------------------------------------------------------------
def main() -> None:
    log("Audio Capture Worker starting")
    capture = AudioCapture()

    send_json({"type": "ready", "worker": "audio_capture"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            log(f"Invalid JSON received: {exc}")
            send_json({"type": "error", "message": f"Invalid JSON: {exc}"})
            continue

        command = msg.get("command", "")

        try:
            if command == "start":
                if capture.running:
                    send_json({"type": "status", "status": "already_running"})
                else:
                    capture.start()

            elif command == "stop":
                if capture.running:
                    capture.stop()
                else:
                    send_json({"type": "status", "status": "not_running"})

            elif command == "exit":
                if capture.running:
                    capture.stop()
                send_json({"type": "status", "status": "exiting"})
                break

            else:
                send_json({"type": "error", "message": f"Unknown command: {command}"})

        except Exception as exc:
            log(f"Error handling command '{command}': {exc}")
            traceback.print_exc(file=sys.stderr)
            send_json({"type": "error", "message": str(exc)})

    log("Audio Capture Worker shutting down")
    if capture.running:
        capture.stop()


if __name__ == "__main__":
    main()
