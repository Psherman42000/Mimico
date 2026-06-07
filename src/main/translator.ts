/**
 * TranslatorService — Tradução via DeepL API Free com cache LRU.
 * 
 * Estratégia:
 * - Cache LRU para evitar re-traduzir frases repetidas
 * - Detecção de idioma: não traduz se já estiver em PT-BR
 * - Rate limiting suave para não estourar cota (500k chars/mês)
 * - Fallback: retorna texto original se API falhar
 */

import { BrowserWindow } from 'electron';

interface CacheEntry {
  result: string;
  timestamp: number;
}

interface DeepLResponse {
  translations: Array<{
    text: string;
    detected_source_language: string;
  }>;
}

export class TranslatorService {
  private apiKey = '';
  private mainWindow: BrowserWindow | null = null;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_MAX = 200;
  private readonly CACHE_TTL_MS = 3600000; // 1 hour
  private readonly API_URL = 'https://api-free.deepl.com/v2/translate';
  private monthlyCharCount = 0;
  private readonly MONTHLY_LIMIT = 450000; // 90% of 500k to leave margin
  private lastResetMonth = new Date().getMonth();

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  getMonthlyUsage(): number {
    return this.monthlyCharCount;
  }

  getMonthlyLimit(): number {
    return this.MONTHLY_LIMIT;
  }

  /**
   * Translate text from sourceLang to targetLang.
   * Uses LRU cache. Detects if already target language.
   */
  async translate(
    text: string,
    sourceLang = 'EN',
    targetLang = 'PT-BR',
  ): Promise<{ translated: string; sourceLang: string; cached: boolean }> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { translated: '', sourceLang, cached: false };
    }

    // Check cache first
    const cacheKey = `${sourceLang}:${targetLang}:${trimmed}`;
    const fromCache = this.getFromCache(cacheKey);
    if (fromCache) {
      return { translated: fromCache, sourceLang: targetLang, cached: true };
    }

    // Check monthly limit
    if (this.isLimitReached()) {
      return { translated: trimmed, sourceLang, cached: false };
    }

    return this.callAndCache(trimmed, sourceLang, targetLang, cacheKey);
  }

  private getFromCache(cacheKey: string): string | null {
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
      return cached.result;
    }
    return null;
  }

  private isLimitReached(): boolean {
    this.checkMonthlyReset();
    if (this.monthlyCharCount >= this.MONTHLY_LIMIT) {
      console.warn('DeepL monthly limit reached');
      return true;
    }
    return false;
  }

  private async callAndCache(
    text: string,
    sourceLang: string,
    targetLang: string,
    cacheKey: string,
  ): Promise<{ translated: string; sourceLang: string; cached: boolean }> {
    try {
      const result = await this.callDeepL(text, sourceLang, targetLang);
      const translated = result.translations[0].text;
      const detectedSource = result.translations[0].detected_source_language;

      this.setCache(cacheKey, translated);
      this.monthlyCharCount += text.length + translated.length;

      return { translated, sourceLang: detectedSource, cached: false };
    } catch (error) {
      console.error('DeepL translation failed:', error);
      return { translated: text, sourceLang, cached: false };
    }
  }

  /**
   * Translate a batch of transcription segments.
   */
  async translateBatch(
    segments: Array<{ text: string }>,
    sourceLang = 'EN',
    targetLang = 'PT-BR',
  ): Promise<Array<{ original: string; translated: string; cached: boolean }>> {
    const results: Array<{ original: string; translated: string; cached: boolean }> = [];

    for (const segment of segments) {
      if (!segment.text.trim()) {
        continue;
      }
      const result = await this.translate(segment.text, sourceLang, targetLang);
      results.push({
        original: segment.text,
        translated: result.translated,
        cached: result.cached,
      });
    }

    return results;
  }

  /**
   * Send translation request to DeepL API.
   */
  private async callDeepL(
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<DeepLResponse> {
    const response = await fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        target_lang: targetLang,
        source_lang: sourceLang,
        formality: 'default',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`DeepL API ${response.status}: ${errorBody}`);
    }

    return response.json() as Promise<DeepLResponse>;
  }

  /**
   * Reset monthly counter if month changed.
   */
  private checkMonthlyReset(): void {
    const currentMonth = new Date().getMonth();
    if (currentMonth !== this.lastResetMonth) {
      this.monthlyCharCount = 0;
      this.lastResetMonth = currentMonth;
      this.cache.clear();
    }
  }

  /**
   * Set cache entry with LRU eviction.
   */
  private setCache(key: string, value: string): void {
    if (this.cache.size >= this.CACHE_MAX) {
      // Evict oldest entry
      let oldestKey = '';
      let oldestTime = Infinity;
      this.cache.forEach((entry, key) => {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      });
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { result: value, timestamp: Date.now() });
  }

  /**
   * Send status update to renderer.
   */
  private sendToWindow(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}
