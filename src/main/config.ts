import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig } from '../shared/types';

const DEFAULT_CONFIG: AppConfig = {
  deepLKey: '',
  ttsMode: 'local',
  ttsProvider: 'cartesia',
  ttsApiKey: '',
  voiceSamplePath: '',
  overlayPosition: { x: 100, y: 100 },
  overlayOpacity: 0.85,
  autoStart: false,
  hotkey: 'Ctrl+Shift+M',
  sourceLanguage: 'EN',
  targetLanguage: 'PT-BR',
};

export class ConfigManager {
  private configPath: string;

  constructor() {
    const appData = app.getPath('appData');
    const mimicoDir = path.join(appData, 'Mimico');
    if (!fs.existsSync(mimicoDir)) {
      fs.mkdirSync(mimicoDir, { recursive: true });
    }
    this.configPath = path.join(mimicoDir, 'config.json');
  }

  load(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
    return { ...DEFAULT_CONFIG };
  }

  save(config: AppConfig): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  }
}
