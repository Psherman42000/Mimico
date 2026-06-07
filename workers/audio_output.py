#!/usr/bin/env python3
"""
Mimico Audio Output Worker
Plays WAV audio files on the VB-Cable output device using sounddevice.
Receives file paths via stdin JSON, streams playback, reports status.
"""

import json
import sys
import os
import traceback
import time
import threading

import numpy as np
import sounddevice as sd
import soundfile as sf


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
VB_CABLE_NAME_SUBSTRINGS = ["CABLE Input", "VB-Cable", "VB-Audio Cable"]
SAMPLE_RATE = 16000  # fallback if WAV header differs


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    """Write log messages to stderr (never stdout)."""
    print(f"[audio_output] {msg}", file=sys.stderr, flush=True)


def send_json(obj: dict) -> None:
    """Print a JSON message to stdout, followed by a newline."""
    print(json.dumps(obj), flush=True)


# ---------------------------------------------------------------------------
# Device detection
# ---------------------------------------------------------------------------
def find_vb_cable_device() -> int | None:
    """
    Find the VB-Cable output (playback) device index.
    The device name typically contains 'CABLE Input' (the input side of VB-Cable
    appears as an output device in WASAPI for playback to it).
    """
    try:
        devices = sd.query_devices()

        # First, find WASAPI host API
        hostapis = sd.query_hostapis()
        wasapi_idx = None
        for i, ha in enumerate(hostapis):
            if "wasapi" in ha['name'].lower():
                wasapi_idx = i
                break

        candidates = []
        for idx, dev in enumerate(devices):
            # Look for VB-Cable by name
            name_lower = dev['name'].lower()
            is_cable = any(substr.lower() in name_lower for substr in VB_CABLE_NAME_SUBSTRINGS)

            if is_cable and dev['max_output_channels'] > 0:
                candidates.append((idx, dev))
                log(f"Candidate: idx={idx}, name={dev['name']}, out_channels={dev['max_output_channels']}")

        if not candidates:
            # Fallback: search all devices more broadly
            log("No VB-Cable device found by name, scanning all WASAPI output devices...")
            for idx, dev in enumerate(devices):
                if wasapi_idx is not None and dev['hostapi'] == wasapi_idx:
                    if dev['max_output_channels'] > 0:
                        candidates.append((idx, dev))

        if not candidates:
            log("No suitable output device found")
            return None

        # Pick the best match: prefer exact 'CABLE Input' match
        for idx, dev in candidates:
            if "cable input" in dev['name'].lower():
                log(f"Selected VB-Cable device: {dev['name']} (idx {idx})")
                return idx

        # Fall back to first candidate
        idx, dev = candidates[0]
        log(f"Selected device: {dev['name']} (idx {idx})")
        return idx

    except Exception as exc:
        log(f"Error finding VB-Cable device: {exc}")
        traceback.print_exc(file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Playback engine
# ---------------------------------------------------------------------------
class AudioOutput:
    def __init__(self):
        self.device_index: int | None = None
        self._stop_event = threading.Event()
        self._play_thread: threading.Thread | None = None
        self._current_file: str | None = None

    def initialize(self) -> bool:
        """Find the VB-Cable device. Returns True if found."""
        self.device_index = find_vb_cable_device()
        if self.device_index is None:
            send_json({"type": "error", "message": "VB-Cable device not found. "
                       "Please install VB-Cable and ensure it is enabled."})
            return False

        log(f"Audio output initialized with device idx {self.device_index}")
        return True

    def play(self, filepath: str) -> None:
        """Play a WAV file on the VB-Cable device (non-blocking)."""
        if self.device_index is None:
            if not self.initialize():
                return

        if not os.path.isfile(filepath):
            send_json({"type": "error", "message": f"File not found: {filepath}"})
            return

        # If already playing, stop current playback
        if self._play_thread and self._play_thread.is_alive():
            self.stop()

        self._stop_event.clear()
        self._current_file = filepath

        # Start playback in background thread
        self._play_thread = threading.Thread(
            target=self._playback_worker,
            args=(filepath,),
            daemon=True,
        )
        self._play_thread.start()

        send_json({
            "type": "status",
            "status": "playing",
            "file": filepath,
        })

    def stop(self) -> None:
        """Stop current playback."""
        self._stop_event.set()
        if self._play_thread and self._play_thread.is_alive():
            self._play_thread.join(timeout=2.0)
        self._play_thread = None
        log("Playback stopped")
        send_json({"type": "status", "status": "stopped"})

    def _playback_worker(self, filepath: str) -> None:
        """Background thread: read WAV and stream to VB-Cable."""
        try:
            log(f"Starting playback: {filepath}")

            # Read audio file
            data, samplerate = sf.read(filepath, dtype='float32')

            # Ensure mono if needed
            if data.ndim > 1 and data.shape[1] > 1:
                # Convert to mono by averaging channels
                data = np.mean(data, axis=1, dtype=np.float32)

            log(f"Audio: {len(data)} samples @ {samplerate}Hz, "
                f"duration={len(data) / samplerate:.2f}s")

            # Stream to output device
            # Use a callback-based OutputStream for responsive stop
            chunk_size = 1024
            total_frames = len(data)
            frames_played = 0

            def callback(outdata, frames, time_info, status):
                nonlocal frames_played
                if status:
                    log(f"Output status: {status}")

                if self._stop_event.is_set():
                    # Fill with silence and stop
                    outdata.fill(0)
                    return

                remaining = total_frames - frames_played
                if remaining <= 0:
                    outdata.fill(0)
                    return

                frames_to_write = min(frames, remaining)
                start = frames_played
                end = frames_played + frames_to_write
                outdata[:frames_to_write, 0] = data[start:end]

                # Pad remaining with silence
                if frames_to_write < frames:
                    outdata[frames_to_write:, 0] = 0.0

                frames_played += frames_to_write

            with sd.OutputStream(
                device=self.device_index,
                samplerate=samplerate,
                channels=1,
                dtype='float32',
                blocksize=chunk_size,
                callback=callback,
            ):
                # Wait until playback completes or stop is requested
                while frames_played < total_frames and not self._stop_event.is_set():
                    time.sleep(0.05)

            log(f"Playback finished: {filepath}")

            if not self._stop_event.is_set():
                send_json({
                    "type": "status",
                    "status": "finished",
                    "file": filepath,
                })

        except Exception as exc:
            log(f"Playback error: {exc}")
            traceback.print_exc(file=sys.stderr)
            send_json({
                "type": "error",
                "message": f"Playback failed: {exc}",
                "file": filepath,
            })

    def shutdown(self) -> None:
        """Clean stop on exit."""
        self.stop()
        log("Audio output shutdown complete")


# ---------------------------------------------------------------------------
# Main loop — read commands from stdin
# ---------------------------------------------------------------------------
def main() -> None:
    log("Audio Output Worker starting")
    output = AudioOutput()

    # Attempt initialization (non-fatal if VB-Cable not found yet;
    # play command will try again if device_index is None)
    output.initialize()

    send_json({"type": "ready", "worker": "audio_output"})

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
            if command == "play":
                filepath = msg.get("path", "")
                if not filepath:
                    send_json({"type": "error", "message": "No 'path' field provided"})
                    continue
                output.play(filepath)

            elif command == "stop":
                output.stop()

            elif command == "list_devices":
                # Utility command: list all audio devices (for debugging)
                devices = sd.query_devices()
                device_list = []
                for idx, dev in enumerate(devices):
                    device_list.append({
                        "index": idx,
                        "name": dev['name'],
                        "inputs": dev['max_input_channels'],
                        "outputs": dev['max_output_channels'],
                    })
                send_json({"type": "devices", "devices": device_list})

            elif command == "exit":
                output.shutdown()
                send_json({"type": "status", "status": "exiting"})
                break

            else:
                send_json({"type": "error", "message": f"Unknown command: {command}"})

        except Exception as exc:
            log(f"Error handling command '{command}': {exc}")
            traceback.print_exc(file=sys.stderr)
            send_json({"type": "error", "message": str(exc)})

    log("Audio Output Worker shutting down")
    output.shutdown()


if __name__ == "__main__":
    main()
