#!/usr/bin/env python3
"""
Worker: Capture microfono real (WASAPI input).
Protocolo: JSON lines no stdin/stdout.
Logs vão para stderr.
"""

import json
import sys
import threading
import time
import base64
import struct
import traceback

try:
    import numpy as np
    import sounddevice as sd
except ImportError as e:
    err = {"type": "error", "message": f"Missing dependency: {e}"}
    print(json.dumps(err), flush=True)
    sys.exit(1)

# ---------------------------------------------------------------------------
# configuração
# ---------------------------------------------------------------------------
SAMPLE_RATE = 16000          # 16 kHz
CHANNELS = 1                 # mono
DTYPE = "float32"
CHUNK_FRAMES = SAMPLE_RATE * 3   # ~3 seconds = 48000 samples
ENERGY_THRESHOLD = 0.008     # RMS mínimo para considerar voz
POLL_INTERVAL = 0.1          # segundos entre verificações de comandos

# ---------------------------------------------------------------------------
# estado global
# ---------------------------------------------------------------------------
_capturing = False           # flag para iniciar/parar captura
_running = True              # flag de execução do worker
_stream = None
_audio_buffer = []           # acumula blocos até chunk completo

# ---------------------------------------------------------------------------
# helpers de logging (stdout só JSON, stderr para humanos)
# ---------------------------------------------------------------------------
def log_info(msg: str):
    print(f"[audio_mic] {msg}", file=sys.stderr, flush=True)

def log_error(msg: str):
    print(f"[audio_mic] ERROR: {msg}", file=sys.stderr, flush=True)

def log_debug(msg: str):
    print(f"[audio_mic] DEBUG: {msg}", file=sys.stderr, flush=True)

def send_json(obj: dict):
    """Envia mensagem JSON para stdout (único canal de dados)."""
    try:
        print(json.dumps(obj), flush=True)
    except Exception as e:
        log_error(f"Falha ao enviar JSON: {e}")

# ---------------------------------------------------------------------------
# detecção de dispositivo de entrada
# ---------------------------------------------------------------------------
def find_input_device():
    """
    Retorna o device_id do primeiro dispositivo de entrada WASAPI válido.
    Prefere sd.default.device[0] se for entrada; senão varre sd.query_devices().
    """
    # tenta o default device
    try:
        default_in = sd.default.device[0]
        if default_in is not None and default_in >= 0:
            info = sd.query_devices(default_in)
            if info["max_input_channels"] > 0:
                log_info(f"Usando dispositivo de entrada padrão: {info['name']} (id={default_in})")
                return default_in
    except Exception as e:
        log_debug(f"Default device não disponível: {e}")

    # varre todos os dispositivos procurando WASAPI / MME / Windows input
    try:
        devices = sd.query_devices()
        for i, dev in enumerate(devices):
            name = str(dev.get("name", "")).lower()
            if dev["max_input_channels"] > 0:
                log_info(f"Dispositivo de entrada encontrado: {dev['name']} (id={i})")
                return i
    except Exception as e:
        log_error(f"Falha ao listar dispositivos: {e}")

    return None

# ---------------------------------------------------------------------------
# VAD por energy threshold
# ---------------------------------------------------------------------------
def compute_rms(audio: np.ndarray) -> float:
    """Retorna RMS de um array float32."""
    try:
        return float(np.sqrt(np.mean(audio ** 2)))
    except Exception:
        return 0.0

def has_voice(audio: np.ndarray) -> bool:
    """Retorna True se o RMS do áudio for maior que o threshold."""
    try:
        rms = compute_rms(audio)
        return rms > ENERGY_THRESHOLD
    except Exception as e:
        log_error(f"Erro no VAD: {e}")
        return False

# ---------------------------------------------------------------------------
# processamento e envio de chunks
# ---------------------------------------------------------------------------
def send_audio_chunk(chunk: np.ndarray):
    """Codifica chunk em base64 e envia via stdout."""
    try:
        raw_bytes = struct.pack(f"{len(chunk)}f", *chunk.tolist())
        b64_data = base64.b64encode(raw_bytes).decode("ascii")
        msg = {
            "type": "audio",
            "data": b64_data,
            "sample_rate": SAMPLE_RATE,
            "channels": CHANNELS,
            "dtype": DTYPE,
            "frames": len(chunk),
            "rms": round(compute_rms(chunk), 6),
            "voice": bool(has_voice(chunk)),
        }
        send_json(msg)
        log_debug(f"Chunk enviado: {len(chunk)} frames, voice={msg['voice']}, rms={msg['rms']}")
    except Exception as e:
        log_error(f"Falha ao codificar/enviar chunk: {e}\n{traceback.format_exc()}")

def process_buffer():
    """Consolida o buffer atual e envia se tamanho mínimo atingido."""
    global _audio_buffer
    if not _audio_buffer:
        return
    try:
        full = np.concatenate(_audio_buffer, axis=0)
        # envia chunks de CHUNK_FRAMES
        while len(full) >= CHUNK_FRAMES:
            chunk = full[:CHUNK_FRAMES]
            send_audio_chunk(chunk)
            full = full[CHUNK_FRAMES:]
        # guarda o restante
        _audio_buffer = [full] if len(full) > 0 else []
    except Exception as e:
        log_error(f"Erro no process_buffer: {e}\n{traceback.format_exc()}")
        _audio_buffer = []

# ---------------------------------------------------------------------------
# callback do sounddevice (chamado em thread separada)
# ---------------------------------------------------------------------------
def audio_callback(indata: np.ndarray, frames: int, time_info, status):
    """Callback do stream de áudio - recebe blocos do microfone."""
    global _audio_buffer
    if status:
        log_debug(f"Status do stream: {status}")
    if not _capturing:
        return
    try:
        # indata shape: (frames, channels) -> achatar para mono
        if indata.shape[1] > 1:
            audio_block = np.mean(indata, axis=1, dtype=DTYPE)
        else:
            audio_block = indata.flatten().astype(DTYPE)
        _audio_buffer.append(audio_block)
    except Exception as e:
        log_error(f"Erro no audio_callback: {e}")

# ---------------------------------------------------------------------------
# controle do stream
# ---------------------------------------------------------------------------
def start_stream(device_id: int):
    """Inicia o InputStream do sounddevice."""
    global _stream
    try:
        if _stream is not None:
            try:
                _stream.close()
            except Exception:
                pass
        _stream = sd.InputStream(
            device=device_id,
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            callback=audio_callback,
            blocksize=1024,
        )
        _stream.start()
        log_info(f"Stream de áudio iniciado no device {device_id}")
    except Exception as e:
        log_error(f"Falha ao iniciar stream: {e}\n{traceback.format_exc()}")
        raise

def stop_stream():
    """Para e fecha o stream atual."""
    global _stream
    try:
        if _stream is not None:
            _stream.stop()
            _stream.close()
            _stream = None
            log_info("Stream de áudio parado")
    except Exception as e:
        log_error(f"Erro ao parar stream: {e}")

# ---------------------------------------------------------------------------
# thread de processamento periódico
# ---------------------------------------------------------------------------
def processing_loop():
    """Thread que periodicamente processa o buffer acumulado."""
    while _running:
        try:
            if _capturing:
                process_buffer()
        except Exception as e:
            log_error(f"Erro no processing_loop: {e}")
        time.sleep(POLL_INTERVAL)

# ---------------------------------------------------------------------------
# heartbeat / ready
# ---------------------------------------------------------------------------
def send_ready():
    send_json({"type": "ready", "worker": "audio_mic"})
    log_info("Worker audio_mic pronto")

# ---------------------------------------------------------------------------
# loop principal de comandos (stdin)
# ---------------------------------------------------------------------------
def command_loop():
    global _capturing, _running

    send_ready()
    log_info("Aguardando comandos...")

    # device_id pode ser None se não achou dispositivo
    device_id = None

    # inicia thread de processamento
    proc_thread = threading.Thread(target=processing_loop, daemon=True)
    proc_thread.start()

    while _running:
        try:
            line = sys.stdin.readline()
            if not line:
                log_info("stdin fechado, encerrando...")
                _running = False
                break

            line = line.strip()
            if not line:
                continue

            cmd = json.loads(line)
            command = cmd.get("command", "").lower()
            log_debug(f"Comando recebido: {command}")

            if command == "exit":
                log_info("Comando exit recebido")
                _capturing = False
                _running = False
                break

            elif command == "start":
                if _capturing:
                    log_info("Já está capturando, ignorando start")
                    send_json({"type": "status", "status": "already_capturing"})
                    continue

                # tenta encontrar dispositivo se ainda não temos
                if device_id is None:
                    device_id = find_input_device()

                if device_id is None:
                    log_error("Nenhum dispositivo de entrada disponível")
                    send_json({"type": "error", "message": "No input device found"})
                    continue

                try:
                    _capturing = True
                    _audio_buffer.clear()
                    start_stream(device_id)
                    send_json({"type": "status", "status": "capturing"})
                    log_info("Captura iniciada")
                except Exception as e:
                    _capturing = False
                    log_error(f"Falha ao iniciar captura: {e}")
                    send_json({"type": "error", "message": f"Failed to start capture: {e}"})

            elif command == "stop":
                if not _capturing:
                    log_info("Não está capturando, ignorando stop")
                    send_json({"type": "status", "status": "not_capturing"})
                    continue

                _capturing = False
                # processa o que sobrou no buffer
                try:
                    process_buffer()
                except Exception:
                    pass
                stop_stream()
                send_json({"type": "status", "status": "stopped"})
                log_info("Captura parada")

            else:
                log_debug(f"Comando desconhecido: {command}")
                send_json({"type": "error", "message": f"Unknown command: {command}"})

        except json.JSONDecodeError as e:
            log_error(f"JSON inválido no stdin: {e}")
            send_json({"type": "error", "message": f"Invalid JSON: {e}"})
        except EOFError:
            log_info("EOF no stdin, encerrando...")
            _running = False
            break
        except Exception as e:
            log_error(f"Erro no command_loop: {e}\n{traceback.format_exc()}")
            send_json({"type": "error", "message": f"Internal error: {e}"})

    # limpeza na saída
    _capturing = False
    stop_stream()
    log_info("Worker audio_mic encerrado")

# ---------------------------------------------------------------------------
# ponto de entrada
# ---------------------------------------------------------------------------
def main():
    log_info("Iniciando audio_mic worker...")

    # verifica dispositivo logo no início (apenas para log, sem travar)
    dev_id = find_input_device()
    if dev_id is None:
        log_error("Nenhum dispositivo de entrada encontrado na inicialização")
        # não enviar erro aqui pois o start pode tentar de novo mais tarde
    else:
        log_info(f"Dispositivo de entrada detectado: {dev_id}")

    try:
        command_loop()
    except KeyboardInterrupt:
        log_info("Interrupção recebida")
    except Exception as e:
        log_error(f"Erro fatal: {e}\n{traceback.format_exc()}")
        send_json({"type": "error", "message": f"Fatal error: {e}"})
    finally:
        global _capturing, _running
        _capturing = False
        _running = False
        stop_stream()
        log_info("Worker finalizado")

if __name__ == "__main__":
    main()
