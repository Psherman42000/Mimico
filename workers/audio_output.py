"""
Mimico — Audio Output Worker
Plays audio to VB-Cable (or any output device) for virtual microphone injection.

Communication protocol (stdin/stdout JSON):
  Commands:
    {"cmd": "play", "audio": "<base64_data>", "format": "mp3", "device": null}
    {"cmd": "list_devices"}
    {"cmd": "set_volume", "volume": 0.8}
    {"cmd": "stop"}
    {"cmd": "shutdown"}

  Events:
    {"event": "ready", "vb_cable_installed": true}
    {"event": "device_list", "devices": [...], "recommended": "CABLE Input"}
    {"event": "playing", "status": "start", "latency_ms": 50}
    {"event": "playing", "status": "done", "duration_ms": 2000}
    {"event": "error", "message": "..."}
"""

import json
import sys
import base64
import io
import time
import wave
import tempfile
import os
from typing import Optional


class AudioOutput:
    """Plays audio to output devices (VB-Cable, speakers, etc.)."""

    def __init__(self):
        self.volume: float = 0.8
        self.device: Optional[int] = None
        self.device_name: Optional[str] = None
        self.vb_cable_installed: bool = False
        self.is_playing: bool = False
        self.has_sounddevice = False

        # Detect capabilities
        self._detect_devices()

        self._send({
            'event': 'ready',
            'vb_cable_installed': self.vb_cable_installed,
            'device': self.device_name or 'default',
        })

    def _detect_devices(self):
        """Detect available output devices and find VB-Cable."""
        try:
            import sounddevice as sd
            self.has_sounddevice = True
            devices = sd.query_devices()

            # Find VB-Cable
            for i, dev in enumerate(devices):
                name = dev['name'].lower()
                if dev['max_output_channels'] > 0:
                    if 'cable input' in name:
                        self.vb_cable_installed = True
                        if self.device is None:
                            self.device = i
                            self.device_name = dev['name']
                    elif 'cable' in name and self.device is None:
                        self.device = i
                        self.device_name = dev['name']

            # Default to first output device if no VB-Cable
            if self.device is None:
                for i, dev in enumerate(devices):
                    if dev['max_output_channels'] > 0:
                        self.device = i
                        self.device_name = dev['name']
                        break

        except Exception as e:
            self._send_error(f"Device detection failed: {e}")

    def list_devices(self):
        """List all available output devices."""
        if not self.has_sounddevice:
            self._send_error("sounddevice not available")
            return

        try:
            import sounddevice as sd
            devices = sd.query_devices()
            output_devices = []
            for i, dev in enumerate(devices):
                if dev['max_output_channels'] > 0:
                    output_devices.append({
                        'index': i,
                        'name': dev['name'],
                        'channels': dev['max_output_channels'],
                        'sample_rate': dev['default_samplerate'],
                    })

            # Find recommended (VB-Cable)
            recommended = None
            for dev in output_devices:
                if 'cable input' in dev['name'].lower():
                    recommended = dev['name']
                    break

            self._send({
                'event': 'device_list',
                'devices': output_devices,
                'recommended': recommended or 'Default',
            })
        except Exception as e:
            self._send_error(f"Failed to list devices: {e}")

    def set_volume(self, volume: float):
        """Set playback volume (0.0 to 1.0)."""
        self.volume = max(0.0, min(1.0, volume))
        self._send({'event': 'volume_set', 'volume': self.volume})

    def set_device(self, device: int):
        """Select output device by index."""
        self.device = device
        try:
            import sounddevice as sd
            dev_info = sd.query_devices(device)
            self.device_name = dev_info['name']
            self._send({'event': 'device_set', 'device': dev_info['name']})
        except Exception as e:
            self._send_error(f"Invalid device: {e}")

    def play(self, audio_b64: str, audio_format: str = 'mp3', device: Optional[int] = None):
        """Play audio data to the output device."""
        if not self.has_sounddevice:
            self._send_error("sounddevice not available for playback")
            return

        if self.is_playing:
            self._send_warning("Already playing, stopping previous...")
            self.stop()

        try:
            audio_bytes = base64.b64decode(audio_b64)
            target_device = device if device is not None else self.device

            start = time.time()
            self.is_playing = True

            self._send({
                'event': 'playing',
                'status': 'start',
                'device': self.device_name or str(target_device),
                'format': audio_format,
                'size_bytes': len(audio_bytes),
            })

            # Decode and play based on format
            if audio_format == 'mp3':
                self._play_mp3(audio_bytes, target_device)
            elif audio_format == 'wav':
                self._play_wav(audio_bytes, target_device)
            else:
                self._send_error(f"Unsupported format: {audio_format}")
                self.is_playing = False
                return

            elapsed = int((time.time() - start) * 1000)
            self.is_playing = False

            self._send({
                'event': 'playing',
                'status': 'done',
                'latency_ms': elapsed,
            })

        except Exception as e:
            self.is_playing = False
            self._send_error(f"Playback failed: {e}")

    def _play_mp3(self, audio_bytes: bytes, device: Optional[int]):
        """Decode MP3 and play. Falls back to temp file + ffplay if needed."""
        try:
            import soundfile as sf
            import numpy as np

            # Use pydub or ffmpeg to decode MP3
            try:
                from pydub import AudioSegment
                import tempfile

                # Save to temp file and read with soundfile
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
                    tmp_path = tmp.name
                    audio = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
                    audio.export(tmp_path, format='wav')

                data, sr = sf.read(tmp_path)
                os.unlink(tmp_path)

            except ImportError:
                # Fallback: try soundfile directly with ffmpeg
                import subprocess
                import tempfile

                with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
                    tmp.write(audio_bytes)
                    tmp_path = tmp.name

                wav_path = tmp_path + '.wav'
                subprocess.run([
                    'ffmpeg', '-y', '-i', tmp_path, '-f', 'wav', wav_path
                ], capture_output=True)

                data, sr = sf.read(wav_path)
                os.unlink(tmp_path)
                if os.path.exists(wav_path):
                    os.unlink(wav_path)

            # Apply volume
            data = data * self.volume

            # Play
            import sounddevice as sd
            sd.play(data, sr, device=device)
            sd.wait()

        except ImportError:
            self._send_warning("pydub not available, trying ffplay fallback")
            self._play_with_ffplay(audio_bytes)

    def _play_wav(self, audio_bytes: bytes, device: Optional[int]):
        """Play WAV audio."""
        import sounddevice as sd
        import soundfile as sf
        import numpy as np

        data, sr = sf.read(io.BytesIO(audio_bytes))
        data = data * self.volume
        sd.play(data, sr, device=device)
        sd.wait()

    def _play_with_ffplay(self, audio_bytes: bytes):
        """Fallback: play using ffplay via subprocess."""
        import subprocess
        import tempfile

        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            subprocess.run([
                'ffplay', '-nodisp', '-autoexit', '-volume', str(int(self.volume * 100)),
                tmp_path
            ], capture_output=True, timeout=30)
        except subprocess.TimeoutExpired:
            pass
        finally:
            os.unlink(tmp_path)

    def stop(self):
        """Stop current playback."""
        if self.has_sounddevice:
            try:
                import sounddevice as sd
                sd.stop()
            except Exception:
                pass
        self.is_playing = False
        self._send({'event': 'playing', 'status': 'stopped'})

    def _send(self, message: dict):
        try:
            sys.stdout.write(json.dumps(message) + '\n')
            sys.stdout.flush()
        except Exception:
            pass

    def _send_error(self, message: str):
        self._send({'event': 'error', 'message': message})

    def _send_warning(self, message: str):
        self._send({'event': 'warning', 'message': message})

    def shutdown(self):
        self.stop()
        self._send({'event': 'shutdown'})


def main():
    output = AudioOutput()

    for line in sys.stdin:
        try:
            cmd = json.loads(line.strip())
            action = cmd.get('cmd')

            if action == 'play':
                output.play(
                    audio_b64=cmd.get('audio', ''),
                    audio_format=cmd.get('format', 'mp3'),
                    device=cmd.get('device'),
                )
            elif action == 'list_devices':
                output.list_devices()
            elif action == 'set_volume':
                output.set_volume(cmd.get('volume', 0.8))
            elif action == 'set_device':
                output.set_device(cmd.get('device', 0))
            elif action == 'stop':
                output.stop()
            elif action == 'shutdown':
                output.shutdown()
                break
            else:
                output._send_error(f"Unknown command: {action}")

        except json.JSONDecodeError as e:
            output._send_error(f"Invalid JSON: {e}")
        except Exception as e:
            output._send_error(f"Command error: {e}")

    output.shutdown()


if __name__ == '__main__':
    main()
