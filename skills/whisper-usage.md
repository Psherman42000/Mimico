---
name: whisper-python
description: "Faster-Whisper usage: model loading, GPU/CPU, language detection, VAD"
---

# Faster-Whisper

## Installation
```bash
pip install faster-whisper
# GPU support (CUDA 12.x):
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
```

## Model Loading
```python
from faster_whisper import WhisperModel

# GPU (CUDA) — INT8 quantization
model = WhisperModel("tiny", device="cuda", compute_type="int8_float16")

# CPU — INT8
model = WhisperModel("tiny", device="cpu", compute_type="int8")
```

## Models
| Model | Params | VRAM | GPU Latency | CPU Latency |
|-------|--------|------|-------------|-------------|
| tiny | 39M | ~1GB | ~200ms | ~1-2s |
| base | 74M | ~1.5GB | ~500ms | ~2-3s |
| small | 244M | ~2.5GB | ~1s | ~5-8s |

## Transcribing
```python
segments, info = model.transcribe(
    audio_chunk,
    language="en",          # Force language (None = auto-detect)
    beam_size=5,
    vad_filter=True,        # Built-in VAD
    vad_parameters=dict(min_silence_duration_ms=500),
)

for segment in segments:
    print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
```

## Multilingual Support
Whisper supports 99 languages. For PT (Portuguese):
```python
# Auto-detect
segments, info = model.transcribe(audio)
print(info.language)  # 'pt'

# Force PT
segments, _ = model.transcribe(audio, language="pt")
```

## Worker Protocol (JSON stdin/stdout)
```python
# Receive
{"command": "load_model", "size": "tiny"}
{"command": "transcribe", "data": "<base64_audio>", "language": "en"}

# Send
{"type": "ready", "worker": "whisper"}
{"type": "transcription", "text": "Hello world", "language": "en", "duration": 1.5}
```

## Common Issues
- **CUDA out of memory:** Use smaller model (tiny instead of base) or CPU fallback
- **Model download fails:** Check internet; models cached at `~/.cache/huggingface/hub/`
- **High latency on CPU:** Set `compute_type="int8"` and model="tiny"
- **Empty transcription:** Audio too quiet; check VAD threshold or pre-amplify
