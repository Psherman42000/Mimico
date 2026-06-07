/** Mimico Overlay Renderer */

import '../shared/window-api';

// DOM Elements
const originalContent = document.getElementById('original-content')!;
const translatedContent = document.getElementById('translated-content')!;
const statusIndicator = document.getElementById('status-indicator')!;
const listeningMode = document.getElementById('listening-mode')!;
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
let currentConfig: any = {};

// Load config on startup
async function init() {
  currentConfig = await window.mimico.loadConfig();
  populateSettings(currentConfig);

  // Setup IPC listeners
  window.mimico.onTranscription((text: string) => {
    originalContent.textContent = text;
    statusIndicator.style.background = '#fbbf24'; // yellow while transcribing
  });

  window.mimico.onTranslation((data: { original: string; translated: string }) => {
    originalContent.textContent = data.original;
    translatedContent.textContent = data.translated;
    statusIndicator.style.background = '#4ade80'; // green - done
  });

  window.mimico.onTTSStatus((active: boolean) => {
    ttsActive = active;
    updateTTSButton();
  });

  window.mimico.onLatency((latency: any) => {
    latencyMs.textContent = `${latency.total}ms`;
    latencyBar.classList.remove('hidden');
  });

  window.mimico.onOpenSettings(() => {
    openSettings();
  });

  // Position save
  window.mimico.onPositionChanged((pos: { x: number; y: number }) => {
    currentConfig.overlayPosition = pos;
    // Auto-save position
    window.mimico.saveConfig({ overlayPosition: pos });
  });
}

// TTS Toggle
btnTTS.addEventListener('click', async () => {
  ttsActive = !ttsActive;
  await window.mimico.toggleTTS(ttsActive);
  updateTTSButton();
});

function updateTTSButton() {
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

// Close overlay
btnClose.addEventListener('click', () => {
  window.close();
});

// Settings panel
btnSettings.addEventListener('click', openSettings);

function openSettings() {
  const config = currentConfig;
  populateSettings(config);
  settingsPanel.classList.remove('hidden');
}

btnCloseSettings.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

// TTS mode toggle -> show/hide provider and api key fields
selectTTSMode.addEventListener('change', () => {
  const isAPI = selectTTSMode.value === 'api';
  providerGroup.style.display = isAPI ? 'block' : 'none';
  apiKeyGroup.style.display = isAPI ? 'block' : 'none';
});

// Save settings
btnSaveSettings.addEventListener('click', async () => {
  const config = {
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

// Record voice
btnRecordVoice.addEventListener('click', () => {
  // TODO: Fase 5 - implement voice recording
  alert('Funcionalidade de gravação será implementada em breve!');
});

// Test latency
btnTestLatency.addEventListener('click', () => {
  // TODO: Implement latency test
  alert('Teste de latência será implementado em breve!');
});

// Populate settings from config
function populateSettings(config: any) {
  inputDeepLKey.value = config.deepLKey || '';
  selectTTSMode.value = config.ttsMode || 'local';
  selectTTSProvider.value = config.ttsProvider || 'cartesia';
  inputTTSKey.value = config.ttsApiKey || '';
  inputHotkey.value = config.hotkey || 'Ctrl+Shift+M';
  inputOpacity.value = config.overlayOpacity ?? 0.85;

  const isAPI = selectTTSMode.value === 'api';
  providerGroup.style.display = isAPI ? 'block' : 'none';
  apiKeyGroup.style.display = isAPI ? 'block' : 'none';
}

// Start
init();

export {};
