"""
Mimico — Audio Capture Worker
Captures system audio via WASAPI loopback (Windows) using sounddevice.

Communication protocol (stdin/stdout):
  - Receives commands (JSON, one per line):
    {"cmd": "start", "device": null | int, "sample_rate": 16000}
    {"cmd": "stop"}
    {"cmd": "list_devices"}
    {"cmd": "set_vad", "enabled": true, "threshold": 0.01}
  
  - Sends events (JSON, one per line):
    {"event": "audio_chunk", "data": "<base64_pcm>", "sample_rate": 16000, "duration": 5.0}
    {"event": "device_list", "devices": [...]}
    {"event": "vad_active", "active": true}
    {"event": "status", "state": "listening" | "idle"}
    {"event": "error", "message": "..."}
"""

import json
import sys
import base64
import struct
import threading
import time
from typing import Optional

import numpy as np

try:
    import sounddevice as sd
    HAS_SOUNDDEVICE = True
except Exception as e:
    HAS_SOUNDDEVICE = False
    SD_ERROR = str(e)


class AudioCapture:
    """Captures system audio via WASAPI loopback."""
    
    def __init__(self):
        self.stream: Optional[sd.InputStream] = None
        self.running = False
        self.sample_rate = 16000
        self.channels = 1
        self.blocksize = 1024
        self.buffer_duration = 30  # seconds
        self.ring_buffer: Optional[np.ndarray] = None
        self.buffer_index = 0
        
        # VAD settings
        self.vad_enabled = True
        self.vad_threshold = 0.01  # RMS threshold
        self.vad_active = False
        self.vad_cooldown = 0.5  # seconds
        self.vad_last_active = 0.0
        
        # Callback
        self.on_audio_chunk = None
    
    def list_devices(self):
        """List available audio input devices (loopback-compatible)."""
        if not HAS_SOUNDDEVICE:
            self._send_error(f"sounddevice not available: {SD_ERROR}")
            return []
        
        try:
            devices = sd.query_devices()
            result = []
            for i, dev in enumerate(devices):
                if dev['max_input_channels'] > 0:
                    result.append({
                        'index': i,
                        'name': dev['name'],
                        'channels': dev['max_input_channels'],
                        'sample_rate': dev['default_samplerate'],
                        'is_loopback': 'loopback' in dev['name'].lower() or 'cable' in dev['name'].lower(),
                    })
            
            self._send({
                'event': 'device_list',
                'devices': result
            })
            return result
        except Exception as e:
            self._send_error(f"Failed to list devices: {e}")
            return []
    
    def start(self, device: Optional[int] = None):
        """Start capturing audio from the specified device (or default)."""
        if not HAS_SOUNDDEVICE:
            self._send_error(f"sounddevice not available: {SD_ERROR}")
            return
        
        if self.running:
            self._send_warning("Already capturing")
            return
        
        try:
            # Find WASAPI loopback device if none specified
            if device is None:
                device = self._find_loopback_device()
            
            if device is None:
                self._send_error("No loopback device found. Install VB-Cable?")
                return
            
            dev_info = sd.query_devices(device)
            self.sample_rate = int(dev_info['default_samplerate'])
            
            # Initialize ring buffer
            buffer_samples = int(self.sample_rate * self.buffer_duration)
            self.ring_buffer = np.zeros(buffer_samples, dtype=np.float32)
            self.buffer_index = 0
            
            # WASAPI loopback works with input streams on output devices
            self.stream = sd.InputStream(
                device=device,
                channels=self.channels,
                samplerate=self.sample_rate,
                blocksize=self.blocksize,
                callback=self._audio_callback,
                extra_settings=sd.WasapiSettings(loopback=True) if hasattr(sd, 'WasapiSettings') else None,
            )
            
            self.stream.start()
            self.running = True
            self._send({'event': 'status', 'state': 'listening'})
            
        except Exception as e:
            self._send_error(f"Failed to start capture: {e}")
    
    def stop(self):
        """Stop capturing."""
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None
        self.running = False
        self._send({'event': 'status', 'state': 'idle'})
    
    def _find_loopback_device(self) -> Optional[int]:
        """Find the best WASAPI loopback device."""
        try:
            devices = sd.query_devices()
            
            # First, try to find CABLE Output (VB-Cable)
            for i, dev in enumerate(devices):
                if dev['max_input_channels'] > 0 and 'cable' in dev['name'].lower():
                    return i
            
            # Fallback: default output device as loopback
            default_output = sd.default.device[1]  # output device
            if default_output is not None:
                # WASAPI loopback uses the output device as an input
                dev_info = sd.query_devices(default_output)
                if dev_info['max_input_channels'] > 0:
                    return default_output
            
            # Last resort: any device with input channels
            for i, dev in enumerate(devices):
                if dev['max_input_channels'] > 0:
                    return i
                    
        except Exception as e:
            self._send_error(f"Error finding loopback device: {e}")
        
        return None
    
    def _audio_callback(self, indata: np.ndarray, frames: int, time_info, status):
        """Callback for audio stream - called from sounddevice thread."""
        if status:
            self._send_warning(f"Audio status: {status}")
        
        # Get mono channel
        if indata.shape[1] > 1:
            audio = np.mean(indata, axis=1)
        else:
            audio = indata.flatten()
        
        # Store in ring buffer
        if self.ring_buffer is not None:
            n = len(audio)
            end = self.buffer_index + n
            if end <= len(self.ring_buffer):
                self.ring_buffer[self.buffer_index:end] = audio
            else:
                # Wrap around
                first_part = len(self.ring_buffer) - self.buffer_index
                self.ring_buffer[self.buffer_index:] = audio[:first_part]
                self.ring_buffer[:end - len(self.ring_buffer)] = audio[first_part:]
            self.buffer_index = end % len(self.ring_buffer)
        
        # VAD check
        if self.vad_enabled:
            rms = np.sqrt(np.mean(audio ** 2))
            now = time.time()
            
            if rms > self.vad_threshold:
                if not self.vad_active:
                    self.vad_active = True
                    self._send({'event': 'vad_active', 'active': True})
                self.vad_last_active = now
            elif self.vad_active and (now - self.vad_last_active) > self.vad_cooldown:
                self.vad_active = False
                self._send({'event': 'vad_active', 'active': False})
        
        # Send audio chunk periodically (every ~5 seconds)
        # Each callback receives blocksize samples
        # Accumulate and send when we have enough
        self._accumulate_and_send(audio)
    
    def _accumulate_and_send(self, audio: np.ndarray):
        """Accumulate audio and send chunks every ~5 seconds."""
        if not hasattr(self, '_chunk_buffer'):
            self._chunk_buffer = np.array([], dtype=np.float32)
            self._chunk_duration = 5.0
        
        self._chunk_buffer = np.append(self._chunk_buffer, audio)
        chunk_samples = int(self.sample_rate * self._chunk_duration)
        
        if len(self._chunk_buffer) >= chunk_samples:
            chunk = self._chunk_buffer[:chunk_samples]
            self._chunk_buffer = self._chunk_buffer[chunk_samples:]
            
            # Convert to 16-bit PCM
            pcm = (chunk * 32767).astype(np.int16)
            pcm_bytes = pcm.tobytes()
            
            self._send({
                'event': 'audio_chunk',
                'data': base64.b64encode(pcm_bytes).decode('utf-8'),
                'sample_rate': self.sample_rate,
                'duration': self._chunk_duration,
            })
    
    def get_ring_buffer(self, duration: float) -> Optional[np.ndarray]:
        """Get the last N seconds from the ring buffer."""
        if self.ring_buffer is None:
            return None
        n_samples = int(self.sample_rate * duration)
        if n_samples > len(self.ring_buffer):
            n_samples = len(self.ring_buffer)
        
        end = self.buffer_index
        start = end - n_samples
        if start >= 0:
            return self.ring_buffer[start:end].copy()
        else:
            # Wrapped around
            return np.concatenate([
                self.ring_buffer[start:],
                self.ring_buffer[:end]
            ])
    
    def set_vad(self, enabled: bool, threshold: float = 0.01):
        """Configure VAD settings."""
        self.vad_enabled = enabled
        self.vad_threshold = threshold
    
    def _send(self, msg: dict):
        """Send a JSON message to stdout."""
        try:
            line = json.dumps(msg)
            sys.stdout.write(line + '\n')
            sys.stdout.flush()
        except Exception:
            pass
    
    def _send_error(self, message: str):
        self._send({'event': 'error', 'message': message})
    
    def _send_warning(self, message: str):
        self._send({'event': 'warning', 'message': message})


def main():
    """Main entry point - reads commands from stdin."""
    capture = AudioCapture()
    
    # Send ready signal
    capture._send({'event': 'ready', 'version': '0.1.0'})
    
    for line in sys.stdin:
        try:
            cmd = json.loads(line.strip())
            action = cmd.get('cmd')
            
            if action == 'start':
                capture.start(device=cmd.get('device'))
            elif action == 'stop':
                capture.stop()
            elif action == 'list_devices':
                capture.list_devices()
            elif action == 'set_vad':
                capture.set_vad(
                    enabled=cmd.get('enabled', True),
                    threshold=cmd.get('threshold', 0.01)
                )
            elif action == 'get_buffer':
                duration = cmd.get('duration', 5.0)
                buffer_data = capture.get_ring_buffer(duration)
                if buffer_data is not None:
                    pcm = (buffer_data * 32767).astype(np.int16)
                    capture._send({
                        'event': 'buffer_data',
                        'data': base64.b64encode(pcm.tobytes()).decode('utf-8'),
                        'sample_rate': capture.sample_rate,
                        'duration': duration,
                    })
            elif action == 'shutdown':
                capture.stop()
                break
            else:
                capture._send_error(f"Unknown command: {action}")
                
        except json.JSONDecodeError as e:
            capture._send_error(f"Invalid JSON: {e}")
        except Exception as e:
            capture._send_error(f"Command error: {e}")
    
    capture.stop()


if __name__ == '__main__':
    main()
