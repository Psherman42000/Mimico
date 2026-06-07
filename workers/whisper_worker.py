"""
Mimico — Whisper Transcription Worker
Transcribes audio chunks using Faster-Whisper with GPU acceleration.

Communication protocol (stdin/stdout JSON):
  Commands:
    {"cmd": "load_model", "size": "tiny", "device": "auto"}
    {"cmd": "transcribe", "data": "<base64_pcm>", "sample_rate": 16000, "language": "en"}
    {"cmd": "set_language", "language": "en"}
    {"cmd": "set_model", "size": "tiny"}
    {"cmd": "shutdown"}

  Events:
    {"event": "ready", "capabilities": {"gpu": true, "model": "tiny"}}
    {"event": "transcription", "text": "...", "segments": [...], "language": "en", "latency_ms": 500}
    {"event": "model_loaded", "size": "tiny", "device": "cuda"}
    {"event": "error", "message": "..."}
"""

import json
import sys
import base64
import time
import os
from typing import Optional

import numpy as np


class WhisperWorker:
    """Manages Faster-Whisper model and transcription."""

    MODEL_SIZES = ['tiny', 'base', 'small', 'medium', 'large-v3']
    DEFAULT_SIZE = 'tiny'

    def __init__(self):
        self.model: Optional = None
        self.model_size: str = self.DEFAULT_SIZE
        self.device: str = 'auto'
        self.compute_type: str = 'float16'
        self.language: Optional[str] = 'en'
        self.is_ready: bool = False

        # Detect GPU capability
        self.gpu_available = self._detect_gpu()
        self._send({
            'event': 'ready',
            'capabilities': {
                'gpu': self.gpu_available,
                'model': self.model_size,
            }
        })

    def _detect_gpu(self) -> bool:
        """Check if CUDA GPU is available."""
        try:
            import torch
            has_cuda = torch.cuda.is_available()
            if has_cuda:
                gpu_name = torch.cuda.get_device_name(0)
                vram = torch.cuda.get_device_properties(0).total_mem / 1024**3
                self._send({
                    'event': 'gpu_info',
                    'name': gpu_name,
                    'vram_gb': round(vram, 1),
                })
            return has_cuda
        except Exception:
            return False

    def load_model(self, size: str = DEFAULT_SIZE, device: Optional[str] = None) -> bool:
        """Load or reload the Whisper model."""
        if size not in self.MODEL_SIZES:
            self._send_error(f"Invalid model size: {size}. Choose from: {self.MODEL_SIZES}")
            return False

        self.model_size = size

        # Determine device
        if device and device != 'auto':
            self.device = device
        elif self.gpu_available:
            self.device = 'cuda'
        else:
            self.device = 'cpu'

        # Determine compute type
        if self.device == 'cuda':
            self.compute_type = 'float16'
        else:
            self.compute_type = 'int8'

        try:
            start = time.time()
            from faster_whisper import WhisperModel
            self.model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
                download_root=self._get_model_path(),
            )
            load_time = int((time.time() - start) * 1000)
            self.is_ready = True
            self._send({
                'event': 'model_loaded',
                'size': self.model_size,
                'device': self.device,
                'compute_type': self.compute_type,
                'load_time_ms': load_time,
            })
            return True
        except Exception as e:
            self._send_error(f"Failed to load model: {e}")
            return False

    def _get_model_path(self) -> str:
        """Get or create model cache directory."""
        model_dir = os.path.join(
            os.environ.get('APPDATA', os.path.expanduser('~')),
            'Mimico', 'models'
        )
        os.makedirs(model_dir, exist_ok=True)
        return model_dir

    def transcribe(self, data_b64: str, sample_rate: int = 16000,
                   language: Optional[str] = None) -> None:
        """Transcribe audio from base64-encoded PCM data."""
        if not self.model:
            self._send_error("Model not loaded. Send load_model first.")
            return

        try:
            # Decode base64 to PCM
            pcm_bytes = base64.b64decode(data_b64)
            audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32767.0

            # Use provided language or fallback to configured
            lang = language or self.language

            start = time.time()
            segments, info = self.model.transcribe(
                audio,
                language=lang,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(
                    threshold=0.5,
                    min_speech_duration_ms=250,
                    min_silence_duration_ms=100,
                ),
            )

            # Collect all segments
            segment_list = []
            full_text = ''
            for segment in segments:
                segment_list.append({
                    'start': round(segment.start, 2),
                    'end': round(segment.end, 2),
                    'text': segment.text.strip(),
                })
                full_text += segment.text + ' '

            elapsed = int((time.time() - start) * 1000)

            self._send({
                'event': 'transcription',
                'text': full_text.strip(),
                'segments': segment_list,
                'language': info.language,
                'language_probability': round(info.language_probability, 3),
                'duration_audio': round(info.duration, 2),
                'latency_ms': elapsed,
            })

        except Exception as e:
            self._send_error(f"Transcription failed: {e}")

    def set_language(self, language: Optional[str]) -> None:
        """Set default language for transcription. None = auto-detect."""
        self.language = language
        self._send({'event': 'language_set', 'language': language or 'auto'})

    def _send(self, message: dict) -> None:
        """Send JSON message to stdout."""
        try:
            sys.stdout.write(json.dumps(message) + '\n')
            sys.stdout.flush()
        except Exception:
            pass

    def _send_error(self, message: str) -> None:
        self._send({'event': 'error', 'message': message})

    def shutdown(self) -> None:
        """Cleanup and exit."""
        self.model = None
        self._send({'event': 'shutdown'})


def main():
    """Main entry point - reads commands from stdin."""
    worker = WhisperWorker()
    auto_loaded = False

    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            action = command.get('cmd')

            # Auto-load model on first transcribe if not loaded
            if action == 'transcribe' and not worker.is_ready and not auto_loaded:
                worker.load_model()
                auto_loaded = True

            if action == 'load_model':
                worker.load_model(
                    size=command.get('size', worker.DEFAULT_SIZE),
                    device=command.get('device'),
                )
            elif action == 'transcribe':
                worker.transcribe(
                    data_b64=command['data'],
                    sample_rate=command.get('sample_rate', 16000),
                    language=command.get('language'),
                )
            elif action == 'set_language':
                worker.set_language(command.get('language'))
            elif action == 'set_model':
                worker.load_model(size=command.get('size', worker.DEFAULT_SIZE))
            elif action == 'shutdown':
                worker.shutdown()
                break
            else:
                worker._send_error(f"Unknown command: {action}")

        except json.JSONDecodeError as e:
            worker._send_error(f"Invalid JSON: {e}")
        except Exception as e:
            worker._send_error(f"Command error: {e}")

    worker.shutdown()


if __name__ == '__main__':
    main()
