#!/usr/bin/env python3
"""
Mimico WASAPI Audio Module
Replaces sounddevice/PortAudio for Windows audio capture and playback.
Uses ctypes + Windows Core Audio COM API directly.

Provides:
- list_devices() -> list of device info dicts
- WasapiLoopbackStream  (system audio capture)
- WasapiMicStream       (mic capture)
- WasapiOutputPlayback  (VB-Cable playback)
"""

import sys
import threading
import time
import traceback
from ctypes import (
    POINTER, Structure, c_void_p, c_ulong, c_uint32, c_int32,
    c_float, c_char, c_wchar, c_char_p, c_wchar_p,
    byref, cast, sizeof, memmove, addressof, CFUNCTYPE,
    HRESULT as HRESULT_TYPE,
)
from ctypes import wintypes

import numpy as np

# Use c_int32 for HRESULT (HRESULT may not be available on all Python builds)
import ctypes.wintypes
HRESULT = c_int32
from ctypes import windll

ole32 = windll.ole32
ole32.CoInitialize.restype = HRESULT
ole32.CoInitialize.argtypes = [c_void_p]
ole32.CoCreateInstance.restype = HRESULT
ole32.CoCreateInstance.argtypes = [
    POINTER(wintypes.GUID),  # rclsid
    c_void_p,                # pUnkOuter
    wintypes.DWORD,          # dwClsContext
    POINTER(wintypes.GUID),  # riid
    POINTER(c_void_p),       # ppv
]
ole32.CoTaskMemFree.restype = None
ole32.CoTaskMemFree.argtypes = [c_void_p]
# Actually most Core Audio is via COM, not direct DLL exports

# ---------------------------------------------------------------------------
# COM helpers
# ---------------------------------------------------------------------------

def com_initialize():
    hr = ole32.CoInitialize(None)
    return hr  # 0 = S_OK, 1 = S_FALSE (already initialized)


# ---------------------------------------------------------------------------
# GUID helpers
# ---------------------------------------------------------------------------

def guid_from_string(s: str):
    """Parse '{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}' into a GUID struct."""
    s = s.strip("{}").replace("-", "")
    data = bytes.fromhex(s)
    return wintypes.GUID(
        int.from_bytes(data[0:4], "little"),
        int.from_bytes(data[4:6], "little"),
        int.from_bytes(data[6:8], "little"),
        (wintypes.BYTE * 8)(
            data[8], data[9], data[10], data[11],
            data[12], data[13], data[14], data[15],
        ),
    )


# ---------------------------------------------------------------------------
# GUIDs and CLSIDs
# ---------------------------------------------------------------------------
CLSID_MMDeviceEnumerator = guid_from_string("{BCDE0395-E52F-467C-8E3D-C4579291692E}")
IID_IMMDeviceEnumerator   = guid_from_string("{A95664D2-9614-4F35-A746-DE8DB63617E6}")
IID_IMMDevice             = guid_from_string("{D666063F-1587-4E43-81F1-BB948EFFCF6E}")
IID_IMMDeviceCollection   = guid_from_string("{0BD7A1BE-7A1A-44DB-8397-CC5392387B5E}")
IID_IAudioClient          = guid_from_string("{1CB9AD4C-DBFA-4C32-B178-C2F568A703B2}")
IID_IAudioCaptureClient   = guid_from_string("{C8ADBD64-E71E-48A0-A4DE-185C395CD317}")
IID_IAudioRenderClient    = guid_from_string("{F294ACFC-3146-4483-A7BF-ADDCA7C260E2}")
IID_IPropertyStore        = guid_from_string("{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}")

GUID_NULL = guid_from_string("{00000000-0000-0000-0000-000000000000}")

# ---------------------------------------------------------------------------
# WAVEFORMATEX structure
# ---------------------------------------------------------------------------

class WAVEFORMATEX(Structure):
    _fields_ = [
        ("wFormatTag",      wintypes.WORD),
        ("nChannels",       wintypes.WORD),
        ("nSamplesPerSec",  wintypes.DWORD),
        ("nAvgBytesPerSec", wintypes.DWORD),
        ("nBlockAlign",     wintypes.WORD),
        ("wBitsPerSample",  wintypes.WORD),
        ("cbSize",          wintypes.WORD),
    ]


WAVE_FORMAT_IEEE_FLOAT = 3

# ---------------------------------------------------------------------------
# COM VTable function types (for calling interface methods)
# ---------------------------------------------------------------------------

# IUnknown methods
QueryInterface = CFUNCTYPE(HRESULT, c_void_p, POINTER(wintypes.GUID), POINTER(c_void_p))
AddRef = CFUNCTYPE(c_ulong, c_void_p)
Release = CFUNCTYPE(c_ulong, c_void_p)

# IMMDeviceEnumerator methods
EnumAudioEndpoints = CFUNCTYPE(
    HRESULT, c_void_p,  # this
    wintypes.DWORD,  # dataFlow (0=render, 1=capture, 2=all)
    wintypes.DWORD,  # dwStateMask
    POINTER(c_void_p),  # ppDevices
)
GetDefaultAudioEndpoint = CFUNCTYPE(
    HRESULT, c_void_p,
    wintypes.DWORD,  # dataFlow
    wintypes.DWORD,  # role (0=console, 1=multimedia, 2=communications)
    POINTER(c_void_p),  # ppDevice
)

# IMMDeviceCollection methods
GetCount = CFUNCTYPE(HRESULT, c_void_p, POINTER(wintypes.UINT))
Item = CFUNCTYPE(HRESULT, c_void_p, wintypes.UINT, POINTER(c_void_p))

# IMMDevice methods
OpenPropertyStore = CFUNCTYPE(
    HRESULT, c_void_p,
    wintypes.DWORD,  # stgmAccess
    POINTER(c_void_p),  # ppProperties
)
GetId = CFUNCTYPE(HRESULT, c_void_p, POINTER(c_wchar_p))
GetState = CFUNCTYPE(HRESULT, c_void_p, POINTER(wintypes.DWORD))
Activate = CFUNCTYPE(
    HRESULT, c_void_p,
    POINTER(wintypes.GUID),  # riid
    wintypes.DWORD,  # dwClsCtx
    c_void_p,  # pActivationParams (NULL)
    POINTER(c_void_p),  # ppInterface
)

# IPropertyStore methods
GetValue = CFUNCTYPE(
    HRESULT, c_void_p,
    POINTER(wintypes.PROPERTYKEY),  # key
    POINTER(wintypes.PROPVARIANT),  # pv
)

# IAudioClient methods
Initialize = CFUNCTYPE(
    HRESULT, c_void_p,
    wintypes.DWORD,    # dwFlags
    wintypes.LONGLONG, # hnsBufferDuration
    wintypes.LONGLONG, # hnsPeriodicity
    POINTER(WAVEFORMATEX),  # pFormat
    POINTER(wintypes.GUID), # AudioSessionGuid (can be NULL)
)
GetBufferSize = CFUNCTYPE(HRESULT, c_void_p, POINTER(wintypes.UINT32))
GetStreamLatency = CFUNCTYPE(HRESULT, c_void_p, POINTER(wintypes.LONGLONG))
GetCurrentPadding = CFUNCTYPE(HRESULT, c_void_p, POINTER(wintypes.UINT32))
GetMixFormat = CFUNCTYPE(HRESULT, c_void_p, POINTER(POINTER(WAVEFORMATEX)))
Start_stream = CFUNCTYPE(HRESULT, c_void_p)  # renamed to avoid name collision
Stop_stream = CFUNCTYPE(HRESULT, c_void_p)  # renamed
Reset = CFUNCTYPE(HRESULT, c_void_p)
SetEventHandle = CFUNCTYPE(HRESULT, c_void_p, c_void_p)
GetService = CFUNCTYPE(
    HRESULT, c_void_p,
    POINTER(wintypes.GUID),  # riid
    POINTER(c_void_p),  # ppv
)

# IAudioCaptureClient methods
GetBuffer_ = CFUNCTYPE(
    HRESULT, c_void_p,
    POINTER(c_void_p),    # ppData
    POINTER(wintypes.UINT32),  # pNumFramesToRead
    POINTER(wintypes.DWORD),   # pdwFlags
    POINTER(c_void_p),   # ppNextPacket (optional, UINT64*)
    POINTER(wintypes.UINT64),  # pQWNextPacketTime
)
ReleaseBuffer = CFUNCTYPE(HRESULT, c_void_p, wintypes.UINT32)
GetNextPacketSize = CFUNCTYPE(HRESULT, c_void_p, POINTER(wintypes.UINT32))

# IAudioRenderClient methods
GetBuffer = CFUNCTYPE(
    HRESULT, c_void_p,
    wintypes.UINT32,  # NumFramesRequested
    POINTER(c_void_p),  # ppData
)
ReleaseBuffer_render = CFUNCTYPE(
    HRESULT, c_void_p,
    wintypes.UINT32,  # NumFramesWritten
    wintypes.DWORD,   # dwFlags (0=default)
)

# ---------------------------------------------------------------------------
# VTable-based COM wrapper
# ---------------------------------------------------------------------------

class ComPtr:
    """Wrapper around a COM interface pointer for calling vtable methods."""

    def __init__(self, ptr: int):
        self.ptr = ptr

    @property
    def vtable(self) -> c_void_p:
        """First field of the object is a pointer to the vtable."""
        return cast(c_void_p.from_address(self.ptr), POINTER(c_void_p))[0].value

    def query_interface(self, iid) -> "ComPtr | None":
        func = QueryInterface(cast(self.vtable, POINTER(c_void_p))[0])
        ppv = c_void_p()
        hr = func(self.ptr, byref(iid), byref(ppv))
        if hr != 0 or not ppv.value:
            return None
        return ComPtr(ppv.value)

    def release(self):
        func = Release(cast((c_void_p * 2).from_address(self.vtable), POINTER(c_void_p))[1])
        return func(self.ptr)

    def get_method(self, index: int):
        """Get a function pointer for the vtable method at `index`."""
        ptrs = cast(c_void_p.from_address(self.vtable), POINTER(c_void_p * 64))
        return ptrs.contents[index]


class IMMDeviceEnumeratorPtr(ComPtr):
    def enum_audio_endpoints(self, data_flow: int, state_mask: int):
        func = EnumAudioEndpoints(self.get_method(3))
        ppv = c_void_p()
        hr = func(self.ptr, data_flow, state_mask, byref(ppv))
        if hr != 0:
            raise RuntimeError(f"EnumAudioEndpoints failed: HRESULT={hr:#x}")
        return IMMDeviceCollectionPtr(ppv.value)

    def get_default_audio_endpoint(self, data_flow: int, role: int):
        func = GetDefaultAudioEndpoint(self.get_method(4))
        ppv = c_void_p()
        hr = func(self.ptr, data_flow, role, byref(ppv))
        if hr != 0:
            raise RuntimeError(f"GetDefaultAudioEndpoint failed: HRESULT={hr:#x}")
        return IMMDevicePtr(ppv.value)


class IMMDeviceCollectionPtr(ComPtr):
    def get_count(self) -> int:
        func = GetCount(self.get_method(3))
        count = wintypes.UINT()
        hr = func(self.ptr, byref(count))
        if hr != 0:
            return 0
        return count.value

    def item(self, index: int):
        func = Item(self.get_method(4))
        ppv = c_void_p()
        hr = func(self.ptr, index, byref(ppv))
        if hr != 0:
            raise RuntimeError(f"Item({index}) failed: HRESULT={hr:#x}")
        return IMMDevicePtr(ppv.value)


class IMMDevicePtr(ComPtr):
    def get_id(self) -> str:
        func = GetId(self.get_method(5))
        pstr = c_wchar_p()
        hr = func(self.ptr, byref(pstr))
        if hr != 0:
            return ""
        result = pstr.value
        ole32.CoTaskMemFree(pstr)
        return result

    def get_state(self) -> int:
        func = GetState(self.get_method(6))
        state = wintypes.DWORD()
        hr = func(self.ptr, byref(state))
        return state.value

    def open_property_store(self, access: int = 0):
        func = OpenPropertyStore(self.get_method(4))
        ppv = c_void_p()
        hr = func(self.ptr, access, byref(ppv))
        if hr != 0:
            raise RuntimeError(f"OpenPropertyStore failed: HRESULT={hr:#x}")
        return IPropertyStorePtr(ppv.value)

    def activate(self, iid, cls_ctx: int = 23):
        """Activate interface on the device. cls_ctx=23 = CLSCTX_ALL"""
        func = Activate(self.get_method(3))
        ppv = c_void_p()
        hr = func(self.ptr, byref(iid), cls_ctx, None, byref(ppv))
        if hr != 0:
            raise RuntimeError(f"Activate failed: HRESULT={hr:#x}")
        return ComPtr(ppv.value)


PROPERTYKEY_FORMAT = "{A45C254E-DF1C-4EFD-8020-67D146A850E0} 14"  # PKEY_Device_FriendlyName


class IPropertyStorePtr(ComPtr):
    def get_value(self, key_str: str):
        # Parse "GUID pid"
        guid_str, _, pid_str = key_str.partition(" ")
        guid = guid_from_string(guid_str)
        pid = int(pid_str) if pid_str else 0
        pkey = wintypes.PROPERTYKEY()
        pkey.fmtid = guid
        pkey.pid = pid

        func = GetValue(self.get_method(4))
        pv = wintypes.PROPVARIANT()
        hr = func(self.ptr, byref(pkey), byref(pv))
        if hr != 0:
            return None
        return pv  # raw PROPVARIANT


class IAudioClientPtr(ComPtr):
    def initialize(self, flags: int, hns_buffer: int, hns_period: int,
                   fmt_ptr):
        func = Initialize(self.get_method(3))
        hr = func(self.ptr, flags, hns_buffer, hns_period, fmt_ptr, None)
        if hr != 0:
            raise RuntimeError(f"IAudioClient.Initialize failed: HRESULT={hr:#x}")

    def get_buffer_size(self) -> int:
        func = GetBufferSize(self.get_method(4))
        size = wintypes.UINT32()
        hr = func(self.ptr, byref(size))
        if hr != 0:
            return 0
        return size.value

    def get_mix_format(self):
        func = GetMixFormat(self.get_method(7))
        ppwfex = POINTER(WAVEFORMATEX)()
        hr = func(self.ptr, byref(ppwfex))
        if hr != 0:
            return None
        return ppwfex

    def get_current_padding(self) -> int:
        func = GetCurrentPadding(self.get_method(10))
        padding = wintypes.UINT32()
        hr = func(self.ptr, byref(padding))
        return padding.value

    def start(self):
        func = Start_stream(self.get_method(11))
        hr = func(self.ptr)
        if hr != 0:
            raise RuntimeError(f"IAudioClient.Start failed: HRESULT={hr:#x}")

    def stop(self):
        func = Stop_stream(self.get_method(12))
        func(self.ptr)

    def get_service(self, iid):
        func = GetService(self.get_method(20))
        ppv = c_void_p()
        hr = func(self.ptr, byref(iid), byref(ppv))
        if hr != 0:
            raise RuntimeError(f"GetService failed: HRESULT={hr:#x}")
        return ComPtr(ppv.value)


class IAudioCaptureClientPtr(ComPtr):
    def get_buffer(self):
        func = GetBuffer_(self.get_method(3))
        pdata = c_void_p()
        frames = wintypes.UINT32()
        flags = wintypes.DWORD()
        pnext = c_void_p()
        qtime = wintypes.UINT64()
        hr = func(self.ptr, byref(pdata), byref(frames), byref(flags),
                  byref(pnext), byref(qtime))
        if hr != 0:
            return None, 0, 0
        return pdata.value, frames.value, flags.value

    def release_buffer(self, frames: int):
        func = ReleaseBuffer(self.get_method(4))
        func(self.ptr, frames)

    def get_next_packet_size(self) -> int:
        func = GetNextPacketSize(self.get_method(5))
        size = wintypes.UINT32()
        hr = func(self.ptr, byref(size))
        return size.value


class IAudioRenderClientPtr(ComPtr):
    def get_buffer(self, frames: int):
        func = GetBuffer(self.get_method(3))
        pdata = c_void_p()
        hr = func(self.ptr, frames, byref(pdata))
        if hr != 0:
            return None
        return pdata.value

    def release_buffer(self, frames: int, flags: int = 0):
        func = ReleaseBuffer_render(self.get_method(4))
        func(self.ptr, frames, flags)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_device_enumerator() -> IMMDeviceEnumeratorPtr | None:
    com_initialize()
    ppv = c_void_p()
    hr = ole32.CoCreateInstance(
        byref(CLSID_MMDeviceEnumerator),
        None,
        23,  # CLSCTX_ALL
        byref(IID_IMMDeviceEnumerator),
        byref(ppv),
    )
    if hr != 0 or not ppv.value:
        return None
    return IMMDeviceEnumeratorPtr(ppv.value)


# ---------------------------------------------------------------------------
# Device name helper (via IPropertyStore)
# ---------------------------------------------------------------------------

def _get_device_friendly_name(device: IMMDevicePtr) -> str:
    try:
        ps = device.open_property_store(0)  # STGM_READ = 0
        pkey = wintypes.PROPERTYKEY()
        pkey.fmtid = guid_from_string("{A45C254E-DF1C-4EFD-8020-67D146A850E0}")
        pkey.pid = 14  # PKEY_Device_FriendlyName
        pv = wintypes.PROPVARIANT()
        func = GetValue(ps.get_method(4))
        hr = func(ps.ptr, byref(pkey), byref(pv))
        if hr == 0 and pv.vt == 31:  # VT_LPWSTR
            val = cast(pv.data, c_wchar_p).value
            return val or "Unknown"
        return "Unknown"
    except Exception:
        return "Unknown"


def _get_device_desc(device: IMMDevicePtr) -> str:
    try:
        ps = device.open_property_store(0)
        pkey = wintypes.PROPERTYKEY()
        pkey.fmtid = guid_from_string("{A45C254E-DF1C-4EFD-8020-67D146A850E0}")
        pkey.pid = 2  # PKEY_Device_DeviceDesc
        pv = wintypes.PROPVARIANT()
        func = GetValue(ps.get_method(4))
        hr = func(ps.ptr, byref(pkey), byref(pv))
        if hr == 0 and pv.vt == 31:
            val = cast(pv.data, c_wchar_p).value
            return val or ""
        return ""
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# WAVEFORMATEX factory
# ---------------------------------------------------------------------------

def _make_wave_format(sample_rate: int = 16000, channels: int = 1):
    """Create a WAVEFORMATEX struct for IEEE float mono."""
    fmt = WAVEFORMATEX()
    fmt.wFormatTag = WAVE_FORMAT_IEEE_FLOAT
    fmt.nChannels = channels
    fmt.nSamplesPerSec = sample_rate
    fmt.wBitsPerSample = 32
    fmt.nBlockAlign = channels * 4  # 4 bytes per float
    fmt.nAvgBytesPerSec = sample_rate * fmt.nBlockAlign
    fmt.cbSize = 0
    return fmt


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
def log(msg: str):
    print(f"[wasapi] {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Public: list_devices()
# ---------------------------------------------------------------------------

def list_devices() -> list[dict]:
    """List active audio devices."""
    com_initialize()
    devices = []
    try:
        enum = create_device_enumerator()
        if not enum:
            return devices

        # Get all devices
        collection = enum.enum_audio_endpoints(2, 1)  # eAll, DEVICE_STATE_ACTIVE
        count = collection.get_count()

        for i in range(count):
            try:
                dev = collection.item(i)
                name = _get_device_friendly_name(dev)
                desc = _get_device_desc(dev)
                dev_id = dev.get_id()
                state = dev.get_state()
                # We can't easily determine input/output without activating
                # Let's try to figure out from description
                is_input = "capture" in desc.lower() or "microphone" in desc.lower() or "input" in desc.lower() or "mic" in desc.lower()
                is_output = "render" in desc.lower() or "speaker" in desc.lower() or "headphone" in desc.lower() or "output" in desc.lower() or "cable input" in name.lower()

                devices.append({
                    "name": name,
                    "id": dev_id,
                    "desc": desc,
                    "state": state,
                })
            except Exception:
                continue

    except Exception as e:
        log(f"list_devices error: {e}")
        traceback.print_exc(file=sys.stderr)

    return devices


# ---------------------------------------------------------------------------
# WASAPI Capture Streams
# ---------------------------------------------------------------------------

class WasapiCaptureStream:
    """
    Capture stream using WASAPI.
    loopback=True -> system audio (what speakers play)
    loopback=False -> mic input
    """

    def __init__(self, loopback: bool = False,
                 samplerate: int = 16000, channels: int = 1,
                 blocksize: int = 1024):
        self.loopback = loopback
        self.samplerate = samplerate
        self.channels = channels
        self.blocksize = blocksize
        self.callback = None  # fn(indata, frames, time_info, status)
        self._ac = None       # IAudioClientPtr
        self._cc = None       # IAudioCaptureClientPtr
        self._running = False
        self._thread = None
        self._stop_event = threading.Event()

    def _run(self):
        com_initialize()
        thread_name = "loopback" if self.loopback else "mic"
        try:
            enum = create_device_enumerator()
            if not enum:
                raise RuntimeError("Cannot create device enumerator")

            data_flow = 0 if self.loopback else 1  # eRender for loopback, eCapture for mic
            role = 0  # eConsole
            device = enum.get_default_audio_endpoint(data_flow, role)

            log(f"[{thread_name}] Using device: {_get_device_friendly_name(device)}")

            # Activate IAudioClient
            ac_ptr = device.activate(IID_IAudioClient)
            self._ac = IAudioClientPtr(ac_ptr.ptr)

            # Build our target format
            fmt = _make_wave_format(self.samplerate, self.channels)

            # Initialize
            flags = 0x00080000  # AUDCLNT_STREAMFLAGS_NOPERSIST
            flags |= 0x80000000  # AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            if self.loopback:
                flags |= 0x00020000  # AUDCLNT_STREAMFLAGS_LOOPBACK

            hns_buffer = int(0.2 * 10_000_000)  # 200ms

            self._ac.initialize(flags, hns_buffer, hns_buffer, byref(fmt))

            buffer_frames = self._ac.get_buffer_size()
            log(f"[{thread_name}] Buffer: {buffer_frames} frames (~{buffer_frames * 1000 // self.samplerate}ms)")

            # Get IAudioCaptureClient
            cc_ptr = self._ac.get_service(IID_IAudioCaptureClient)
            self._cc = IAudioCaptureClientPtr(cc_ptr.ptr)

            # Start
            self._ac.start()
            self._running = True

            sleep_ms = max(10, int(self.blocksize * 1000 / self.samplerate * 0.5))

            while not self._stop_event.is_set():
                try:
                    packet_size = self._cc.get_next_packet_size()
                    if packet_size == 0:
                        time.sleep(sleep_ms / 1000.0)
                        continue

                    # Read buffer
                    data_ptr, frames_avail, flags = self._cc.get_buffer()
                    if data_ptr is None or frames_avail == 0:
                        self._cc.release_buffer(0)
                        time.sleep(0.01)
                        continue

                    # Process in blocksize chunks
                    processed = 0
                    while processed < frames_avail:
                        chunk_frames = min(self.blocksize, frames_avail - processed)
                        byte_offset = processed * 4  # float32 = 4 bytes
                        raw_ptr = data_ptr + byte_offset
                        chunk = np.frombuffer(
                            (c_float * chunk_frames).from_address(raw_ptr),
                            dtype=np.float32,
                        ).copy()

                        if chunk.size > 0 and self.callback:
                            outdata = chunk.reshape(-1, 1)
                            try:
                                self.callback(outdata, chunk_frames,
                                              {"input_latency": 0, "output_latency": 0},
                                              None)
                            except Exception as cb_err:
                                log(f"[{thread_name}] Callback error: {cb_err}")

                        processed += chunk_frames

                    self._cc.release_buffer(frames_avail)

                except pywintypes.com_error:
                    # COM error on read - could be device disconnected
                    break
                except Exception as e:
                    log(f"[{thread_name}] Loop error: {e}")
                    traceback.print_exc(file=sys.stderr)
                    time.sleep(0.1)

        except Exception as e:
            log(f"[{thread_name}] Fatal: {e}")
            traceback.print_exc(file=sys.stderr)
        finally:
            self._running = False
            try:
                if self._ac:
                    self._ac.stop()
            except Exception:
                pass
            log(f"[{thread_name}] Thread ended")

    def start(self):
        if self._running:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3.0)
        self._running = False
        try:
            if self._ac:
                self._ac.stop()
        except Exception:
            pass

    def close(self):
        self.stop()
        self._ac = None
        self._cc = None


class WasapiOutputPlayback:
    """
    Playback audio to a WASAPI output device (e.g., VB-Cable).
    Uses callback pattern similar to WasapiCaptureStream.
    """

    def __init__(self, device_name: str = "",
                 samplerate: int = 16000, channels: int = 1,
                 blocksize: int = 1024):
        self.device_name = device_name
        self.samplerate = samplerate
        self.channels = channels
        self.blocksize = blocksize
        self.callback = None  # fn(outdata, frames, time_info, status)
        self._ac = None       # IAudioClientPtr
        self._rc = None       # IAudioRenderClientPtr
        self._running = False
        self._thread = None
        self._stop_event = threading.Event()

    def _run(self):
        com_initialize()
        try:
            enum = create_device_enumerator()
            if not enum:
                raise RuntimeError("Cannot create device enumerator")

            # Find target device by name
            if self.device_name:
                collection = enum.enum_audio_endpoints(2, 1)  # eAll, active
                count = collection.get_count()
                device = None
                for i in range(count):
                    dev = collection.item(i)
                    name = _get_device_friendly_name(dev)
                    if self.device_name.lower() in name.lower():
                        device = dev
                        log(f"Found target device: {name}")
                        break
                if not device:
                    log(f"Device '{self.device_name}' not found, using default render")
                    device = enum.get_default_audio_endpoint(0, 0)  # eRender, console
            else:
                device = enum.get_default_audio_endpoint(0, 0)  # eRender, console

            log(f"Output device: {_get_device_friendly_name(device)}")

            # Activate IAudioClient
            ac_ptr = device.activate(IID_IAudioClient)
            self._ac = IAudioClientPtr(ac_ptr.ptr)

            fmt = _make_wave_format(self.samplerate, self.channels)
            flags = 0x00080000 | 0x80000000  # NOPERSIST | AUTOCONVERTPCM
            hns_buffer = int(0.3 * 10_000_000)  # 300ms

            self._ac.initialize(flags, hns_buffer, hns_buffer, byref(fmt))
            buffer_frames = self._ac.get_buffer_size()
            log(f"Output buffer: {buffer_frames} frames")

            # Get IAudioRenderClient
            rc_ptr = self._ac.get_service(IID_IAudioRenderClient)
            self._rc = IAudioRenderClientPtr(rc_ptr.ptr)

            self._ac.start()
            self._running = True

            chunk_size = self.blocksize

            while not self._stop_event.is_set():
                try:
                    padding = self._ac.get_current_padding()
                    available = buffer_frames - padding
                    if available < chunk_size:
                        time.sleep(0.01)
                        continue

                    write_frames = min(available, chunk_size * 4)
                    buf_addr = self._rc.get_buffer(write_frames)

                    if buf_addr is None:
                        time.sleep(0.01)
                        continue

                    outdata = np.zeros((write_frames, 1), dtype=np.float32)
                    if self.callback:
                        try:
                            self.callback(
                                outdata, write_frames,
                                {"input_latency": 0, "output_latency": 0},
                                None,
                            )
                        except Exception as cb_err:
                            log(f"Output callback error: {cb_err}")
                            outdata.fill(0)

                    raw = outdata.astype(np.float32).tobytes()
                    memmove(buf_addr, raw, len(raw))
                    self._rc.release_buffer(write_frames)

                except pywintypes.com_error as ce:
                    log(f"COM render error: {ce}")
                    time.sleep(0.1)
                except Exception as e:
                    log(f"Render loop error: {e}")
                    traceback.print_exc(file=sys.stderr)
                    time.sleep(0.1)

        except Exception as e:
            log(f"Output thread fatal: {e}")
            traceback.print_exc(file=sys.stderr)
        finally:
            self._running = False
            try:
                if self._ac:
                    self._ac.stop()
            except Exception:
                pass
            log("Output thread ended")

    def start(self):
        if self._running:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3.0)
        self._running = False
        try:
            if self._ac:
                self._ac.stop()
        except Exception:
            pass

    def close(self):
        self.stop()
        self._ac = None
        self._rc = None


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("WASAPI Device List:")
    try:
        devs = list_devices()
        for i, d in enumerate(devs):
            print(f"  {i}: {d['name']}  [{d['desc']}]  state={d['state']}  id={d['id'][:60]}...")
        print(f"\nTotal: {len(devs)} devices")
    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
