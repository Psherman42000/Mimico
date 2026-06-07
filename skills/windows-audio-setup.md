---
name: windows-audio-setup
description: "WASAPI loopback capture, VB-Cable virtual mic, audio device management on Windows"
---

# Windows Audio Setup

## WASAPI Loopback (System Audio Capture)
Captures all audio playing through the system speakers (meetings, YouTube, etc.).

**Implementation:** Python `sounddevice` with `loopback=True`
- Sample rate: 16kHz mono (Whisper requirement)
- Format: float32 PCM chunks
- Device discovery: `sd.query_devices()` → filter by `hostapi=WASAPI` + `max_input_channels>0`
- VAD: RMS energy threshold ~0.005 to skip silence

```python
device = sd.query_devices(kind='loopback')
stream = sd.InputStream(
    samplerate=16000, channels=1,
    device=device['index'],
    dtype='float32',
    extra_settings=sd.WasapiSettings(loopback=True)
)
```

## WASAPI Input (Microphone Capture)
Captures the real microphone (user's voice).

**Implementation:** Same `sounddevice` but without loopback flag
- Default input device: `sd.default.device[0]` or `sd.query_devices(kind='input')`
- Same sample rate / format as loopback
- VAD: higher threshold than loopback (mic has less noise)

## VB-Cable Virtual Mic Setup
1. Download FREE from https://vb-audio.com/Cable/
2. Install (next-next-finish, requires reboot or driver restart)
3. Creates two devices:
   - `CABLE Output` — virtual speaker (audio goes IN here)
   - `CABLE Input` — virtual microphone (audio comes OUT here)
4. In meetings, select `CABLE Input` as microphone

**Playback to VB-Cable:**
```python
device = sd.query_devices("CABLE Input", kind='output')
sd.play(wav_data, samplerate, device=device['index'])
```

## Common Issues
- **Device not found:** Run `python -c "import sounddevice as sd; print(sd.query_devices())"` to list
- **Loopback not available:** Some systems disable it; check Windows Sound settings → Advanced
- **VB-Cable not appearing:** Reinstall driver or check Windows Audio services
- **High latency:** Reduce buffer size (blocksize=1024 or lower)
