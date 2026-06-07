/** Mimico Overlay Renderer */

import '../shared/window-api';
import { AppConfig } from '../shared/types';

// DOM Elements
const originalContent = document.getElementById('original-content')!;
const translatedContent = document.getElementById('translated-content')!;
const statusIndicator = document.getElementById('status-indicator')!;
const btnTTS = document.getElementById('btn-tts')!;
const ttsLabel = document.getElementById('tts-label')!;
const btnClose = document.getElementById('btn-close')!;
const btnSettings = document.getElementById('btn-settings')!;
const settingsPanel = document.getElementById('settings-panel')!;
const btnCloseSettings = document.getElementById('btn-close-settings')!;
const btnSaveSettings = document.getElementById('btn-save-settings')!;
const latencyBar = document.getElementById('latency-bar')!;
const latencyMs = document.getElementById('latency-ms')!;
const inputDeepLKey = document.getElementById('input-deepl-key') as HTMLInputElement;
const selectTTSMode = document.getElementById('select-tts-mode') as HTMLSelectElement;
const selectTTSProvider = document.getElementById('select-tts-provider') as HTMLSelectElement;
const inputTTSKey = document.getElementById('input-tts-key') as HTMLInputElement;
const inputHotkey = document.getElementById('input-hotkey') as HTMLInputElement;
const inputOpacity = document.getElementById('input-opacity') as HTMLInputElement;
const providerGroup = document.getElementById('provider-group')!;
const apiKeyGroup = document.getElementById('api-key-group')!;
const btnRecordVoice = document.getElementById('btn-record-voice')!;
const btnTestLatency = document.getElementById('btn-test-latency')!;

// State
let ttsActive = false;
let currentConfig: AppConfig | null = null;

async function init(): Promise<void> {
  currentConfig = await window.mimico.loadConfig();
  populateSettings(currentConfig);
  registerListeners();
}

function registerListeners(): void {
  window.mimico.onTranscription((text: string) => {
    originalContent.textContent = text;
    statusIndicator.style.background = '#fbbf24';
  });

  window.mimico.onTranslation((data) => {
    originalContent.textContent = data.original;
    translatedContent.textContent = data.translated;
    statusIndicator.style.background = '#4ade80';
  });

  window.mimico.onTTSStatus((active: boolean) => {
    ttsActive = active;
    updateTTSButton();
  });

  window.mimico.onLatency((latency) => {
    latencyMs.textContent = `${latency.total}ms`;
    latencyBar.classList.remove('hidden');
  });

  window.mimico.onOpenSettings(openSettings);

  window.mimico.onPositionChanged((pos) => {
    if (currentConfig) {
      currentConfig.overlayPosition = pos;
      window.mimico.saveConfig({ overlayPosition: pos });
    }
  });
}

// --- TTS Toggle ---

btnTTS.addEventListener('click', async () => {
  ttsActive = !ttsActive;
  await window.mimico.toggleTTS(ttsActive);
  updateTTSButton();
});

function updateTTSButton(): void {
  if (ttsActive) {
    btnTTS.classList.remove('inactive');
    btnTTS.classList.add('active');
    ttsLabel.textContent = 'Voz: ON';
  } else {
    btnTTS.classList.remove('active');
    btnTTS.classList.add('inactive');
    ttsLabel.textContent = 'Voz: OFF';
  }
}

// --- Overlay controls ---

btnClose.addEventListener('click', () => window.close());

// --- Settings ---

btnSettings.addEventListener('click', openSettings);

function openSettings(): void {
  if (currentConfig) {
    populateSettings(currentConfig);
  }
  settingsPanel.classList.remove('hidden');
}

btnCloseSettings.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

selectTTSMode.addEventListener('change', toggleProviderFields);

function toggleProviderFields(): void {
  const isApiMode = selectTTSMode.value === 'api';
  providerGroup.style.display = isApiMode ? 'block' : 'none';
  apiKeyGroup.style.display = isApiMode ? 'block' : 'none';
}

btnSaveSettings.addEventListener('click', async () => {
  const config: Partial<AppConfig> = {
    deepLKey: inputDeepLKey.value,
    ttsMode: selectTTSMode.value as 'local' | 'api',
    ttsProvider: selectTTSProvider.value as 'cartesia' | 'fish' | 'openai',
    ttsApiKey: inputTTSKey.value,
    hotkey: inputHotkey.value,
    overlayOpacity: parseFloat(inputOpacity.value),
  };

  currentConfig = await window.mimico.saveConfig(config);
  settingsPanel.classList.add('hidden');
});

btnRecordVoice.addEventListener('click', () => {
  alert('Gravação de voz será implementada em breve!');
});

btnTestLatency.addEventListener('click', () => {
  alert('Teste de latência será implementado em breve!');
});

// --- Helpers ---

function populateSettings(config: AppConfig): void {
  inputDeepLKey.value = config.deepLKey || '';
  selectTTSMode.value = config.ttsMode || 'local';
  selectTTSProvider.value = config.ttsProvider || 'cartesia';
  inputTTSKey.value = config.ttsApiKey || '';
  inputHotkey.value = config.hotkey || 'Ctrl+Shift+M';
  inputOpacity.value = String(config.overlayOpacity ?? 0.85);
  toggleProviderFields();
}

init();

export {};
