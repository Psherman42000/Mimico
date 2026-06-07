"""
Mimico — Voice Synthesis Worker
Generates speech audio from text using configurable backends.

Backends (ordered by preference):
  1. openvoice  - Local voice cloning (GPU, requires setup)
  2. edge-tts   - Microsoft Edge TTS (free, always works, no cloning)
  3. api        - External API (Cartesia, Fish, OpenAI)

Communication protocol (stdin/stdout JSON):
  Commands:
    {"cmd": "synthesize", "text": "Hello", "voice": "default", "language": "EN"}
    {"cmd": "clone_voice", "audio": "<base64_pcm>", "name": "user"}
    {"cmd": "set_backend", "backend": "edge-tts"}
    {"cmd": "set_voice", "voice": "en-US-JennyNeural"}
    {"cmd": "list_voices"}
    {"cmd": "shutdown"}

  Events:
    {"event": "ready", "backends": ["edge-tts"]}
    {"event": "synthesized", "audio": "<base64_wav>", "sample_rate": 24000, "latency_ms": 500}
    {"event": "voice_list", "voices": [...]}
    {"event": "voice_cloned", "name": "user", "status": "ok"}
    {"event": "error", "message": "..."}
"""

import json
import sys
import base64
import time
import asyncio
from typing import Optional


class VoiceSynthesizer:
    """Synthesizes speech from text using available backends."""

    def __init__(self):
        self.backend: str = 'edge-tts'
        self.current_voice: str = 'en-US-JennyNeural'
        self.voice_clone_data: Optional[bytes] = None
        self.available_backends: list = []
        self.openvoice_available = False
        self.openvoice_model = None

        # Detect available backends
        self._detect_backends()

        self._send({
            'event': 'ready',
            'backends': self.available_backends,
            'default_voice': self.current_voice,
        })

    def _detect_backends(self):
        """Check which TTS backends are available."""
        # edge-tts is always available
        self.available_backends.append('edge-tts')

        # Try to detect OpenVoice
        try:
            import torch
            if torch.cuda.is_available():
                # Check if OpenVoice is installed
                try:
                    from openvoice import OpenVoice
                    self.openvoice_available = True
                    self.available_backends.append('openvoice')
                    gpu_name = torch.cuda.get_device_name(0)
                    self._send({
                        'event': 'backend_info',
                        'backend': 'openvoice',
                        'gpu': gpu_name,
                    })
                except ImportError:
                    pass
        except ImportError:
            pass

    def set_backend(self, backend: str):
        """Switch TTS backend."""
        if backend in self.available_backends:
            self.backend = backend
            self._send({'event': 'backend_set', 'backend': backend})
        else:
            self._send_error(f"Backend '{backend}' not available. Options: {self.available_backends}")

    def set_voice(self, voice: str):
        """Set voice for synthesis."""
        self.current_voice = voice
        self._send({'event': 'voice_set', 'voice': voice})

    def list_voices(self):
        """List available voices for the current backend."""
        try:
            if self.backend == 'edge-tts':
                self._list_edge_voices()
        except Exception as e:
            self._send_error(f"Failed to list voices: {e}")

    def _list_edge_voices(self):
        """Fetch available Edge TTS voices."""
        try:
            import edge_tts
            voices = asyncio.run(edge_tts.list_voices())
            simplified = [
                {
                    'name': v['ShortName'],
                    'locale': v['Locale'],
                    'gender': v['Gender'],
                    'friendly': v['FriendlyName'],
                }
                for v in voices
                if v['Locale'].startswith('en') or v['Locale'].startswith('pt')
            ]
            self._send({'event': 'voice_list', 'voices': simplified, 'backend': 'edge-tts'})
        except Exception as e:
            self._send_error(f"Failed to list edge voices: {e}")

    def synthesize(self, text: str, voice: Optional[str] = None, language: str = 'EN'):
        """Synthesize speech from text using the current backend."""
        if not text or not text.strip():
            self._send_error("Empty text")
            return

        use_voice = voice or self.current_voice

        if self.backend == 'edge-tts':
            self._synthesize_edge(text, use_voice)
        elif self.backend == 'openvoice':
            self._synthesize_openvoice(text, use_voice, language)
        else:
            self._send_error(f"Backend '{self.backend}' not implemented")

    def _synthesize_edge(self, text: str, voice: str):
        """Synthesize using Microsoft Edge TTS (free, no GPU)."""
        try:
            import edge_tts
            start = time.time()

            communicate = edge_tts.Communicate(text, voice)

            # Collect all audio chunks from the async generator
            all_audio = b''
            stream_gen = communicate.stream()
            async def collect():
                nonlocal all_audio
                async for chunk in stream_gen:
                    if chunk['type'] == 'audio':
                        all_audio += chunk['data']
            asyncio.run(collect())

            if not all_audio:
                self._send_error("No audio generated")
                return

            elapsed = int((time.time() - start) * 1000)

            self._send({
                'event': 'synthesized',
                'audio': base64.b64encode(all_audio).decode('utf-8'),
                'sample_rate': 24000,
                'format': 'mp3',
                'latency_ms': elapsed,
                'backend': 'edge-tts',
                'voice': voice,
            })

        except Exception as e:
            self._send_error(f"Edge TTS failed: {e}")

    def _synthesize_openvoice(self, text: str, voice: str, language: str):
        """Synthesize using OpenVoice (local, GPU, voice cloning)."""
        try:
            start = time.time()

            # Lazy load OpenVoice model
            if self.openvoice_model is None:
                self._load_openvoice_model()

            # Synthesize
            audio = self.openvoice_model.synthesize(
                text=text,
                voice=voice,
                language=language,
            )

            # Convert to WAV bytes
            import io
            import soundfile as sf
            buffer = io.BytesIO()
            sf.write(buffer, audio, 22050, format='WAV')
            wav_bytes = buffer.getvalue()

            elapsed = int((time.time() - start) * 1000)

            self._send({
                'event': 'synthesized',
                'audio': base64.b64encode(wav_bytes).decode('utf-8'),
                'sample_rate': 22050,
                'format': 'wav',
                'latency_ms': elapsed,
                'backend': 'openvoice',
                'voice': voice,
            })

        except Exception as e:
            self._send_error(f"OpenVoice synthesis failed: {e}")

    def _load_openvoice_model(self):
        """Lazy load OpenVoice model (first call downloads checkpoints)."""
        try:
            from openvoice import OpenVoice
            self.openvoice_model = OpenVoice.load('checkpoints/v2')
            self._send({'event': 'model_loaded', 'backend': 'openvoice'})
        except ImportError:
            self._send_error("OpenVoice not installed. Install with: pip install openvoice")
            raise
        except Exception as e:
            self._send_error(f"Failed to load OpenVoice model: {e}")
            raise

    def clone_voice(self, audio_b64: str, name: str = 'user'):
        """Clone a voice from audio sample."""
        if self.backend != 'openvoice':
            self._send_error("Voice cloning requires 'openvoice' backend")
            return

        try:
            audio_bytes = base64.b64decode(audio_b64)
            self.voice_clone_data = audio_bytes
            self._send({
                'event': 'voice_cloned',
                'name': name,
                'status': 'ok',
                'backend': 'openvoice',
            })
        except Exception as e:
            self._send_error(f"Voice cloning failed: {e}")

    def _send(self, message: dict):
        """Send JSON message to stdout."""
        try:
            sys.stdout.write(json.dumps(message) + '\n')
            sys.stdout.flush()
        except Exception:
            pass

    def _send_error(self, message: str):
        self._send({'event': 'error', 'message': message})

    def shutdown(self):
        """Cleanup and exit."""
        self.openvoice_model = None
        self._send({'event': 'shutdown'})


def main():
    """Main entry point - reads commands from stdin."""
    synthesizer = VoiceSynthesizer()

    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            action = command.get('cmd')

            if action == 'synthesize':
                synthesizer.synthesize(
                    text=command.get('text', ''),
                    voice=command.get('voice'),
                    language=command.get('language', 'EN'),
                )
            elif action == 'set_backend':
                synthesizer.set_backend(command.get('backend', 'edge-tts'))
            elif action == 'set_voice':
                synthesizer.set_voice(command.get('voice', 'en-US-JennyNeural'))
            elif action == 'list_voices':
                synthesizer.list_voices()
            elif action == 'clone_voice':
                synthesizer.clone_voice(
                    audio_b64=command.get('audio', ''),
                    name=command.get('name', 'user'),
                )
            elif action == 'shutdown':
                synthesizer.shutdown()
                break
            else:
                synthesizer._send_error(f"Unknown command: {action}")

        except json.JSONDecodeError as e:
            synthesizer._send_error(f"Invalid JSON: {e}")
        except Exception as e:
            synthesizer._send_error(f"Command error: {e}")

    synthesizer.shutdown()


if __name__ == '__main__':
    main()
