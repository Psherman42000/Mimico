/** translator.ts - Tradutor DeepL com cache LRU */

import { EventEmitter } from 'events';

/** Chave da API DeepL */
const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

/** Tamanho máximo do cache LRU */
const LRU_MAX_SIZE = 1000;

/** Opções para a requisição de tradução */
interface TranslateOptions {
  /** Código do idioma de origem (ex: 'EN', 'DE') */
  sourceLang?: string;
  /** Código do idioma de destino (ex: 'PT', 'ES') */
  targetLang: string;
  /** Se deve usar o modo formal (default: false) */
  formality?: boolean;
}

/**
 * Nó da lista duplamente encadeada para o cache LRU.
 */
interface LRUNode {
  key: string;
  value: string;
  prev: LRUNode | null;
  next: LRUNode | null;
}

/**
 * Implementação de cache LRU (Least Recently Used) com lista
 * duplamente encadeada + Map para O(1) em operações de get/set.
 */
class LRUCache {
  private readonly map = new Map<string, LRUNode>();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;
  private readonly maxSize: number;

  constructor(maxSize: number = LRU_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * Obtém um valor do cache. Move o nó para o início (mais recente).
   * Retorna undefined se a chave não existir.
   */
  get(key: string): string | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    // Move para o início (mais recentemente usado)
    this.removeNode(node);
    this.addToFront(node);
    return node.value;
  }

  /**
   * Insere ou atualiza um valor no cache.
   * Se o cache estiver cheio, remove o menos recentemente usado (tail).
   */
  set(key: string, value: string): void {
    // Se já existe, atualiza e move para o início
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.removeNode(existing);
      this.addToFront(existing);
      return;
    }

    // Verifica se precisa remover o mais antigo
    if (this.map.size >= this.maxSize && this.tail) {
      this.map.delete(this.tail.key);
      this.removeNode(this.tail);
    }

    // Insere novo nó
    const node: LRUNode = { key, value, prev: null, next: null };
    this.map.set(key, node);
    this.addToFront(node);
  }

  private removeNode(node: LRUNode): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (this.head === node) this.head = node.next;
    if (this.tail === node) this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  private addToFront(node: LRUNode): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  get size(): number {
    return this.map.size;
  }
}

/** Tradutor usando API DeepL com cache LRU integrado. */
export class Translator extends EventEmitter {
  /** Chave da API DeepL */
  private apiKey: string;

  /** Cache LRU para resultados de tradução */
  private readonly cache: LRUCache;

  /** Indica se a API key está configurada */
  private configured: boolean;

  constructor(apiKey: string = '') {
    super();
    this.apiKey = apiKey;
    this.configured = apiKey.length > 0;
    this.cache = new LRUCache(LRU_MAX_SIZE);
  }

  /**
   * Atualiza a chave da API DeepL.
   *
   * @param key - Nova chave de API
   */
  setApiKey(key: string): void {
    this.apiKey = key;
    this.configured = key.length > 0;
    // Limpa o cache ao trocar a chave (resultados anteriores podem ser inválidos)
    this.cache.clear();
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Traduz um texto do idioma de origem para o idioma de destino.
   *
   * Se a API key não estiver configurada, retorna o texto original
   * com o prefixo '[DeepL: configure API key in settings]'.
   *
   * Utiliza cache LRU: traduções repetidas para o mesmo texto
   * são servidas do cache sem chamar a API.
   *
   * @param text - Texto a ser traduzido
   * @param sourceLang - Código do idioma de origem (default: 'EN')
   * @param targetLang - Código do idioma de destino (default: 'PT')
   * @returns Promise com o texto traduzido
   */
  async translate(
    text: string,
    sourceLang: string = 'EN',
    targetLang: string = 'PT',
  ): Promise<string> {
    // Se não há texto, retorna vazio
    if (!text || text.trim().length === 0) {
      return '';
    }

    // Se a API não está configurada, retorna com aviso
    if (!this.configured) {
      return `[DeepL: configure API key in settings] ${text}`;
    }

    // Gera chave de cache
    const cacheKey = `${sourceLang}:${targetLang}:${text}`;

    // Verifica cache
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const translatedText = await this.callDeepLAPI(text, sourceLang, targetLang);

      // Armazena no cache
      this.cache.set(cacheKey, translatedText);

      return translatedText;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('error', new Error(`DeepL translation failed: ${errorMessage}`));

      // Fallback: retorna texto original com aviso
      return `[Translation failed] ${text}`;
    }
  }

  /**
   * Faz a chamada HTTP para a API DeepL.
   *
   * @param text - Texto a traduzir
   * @param sourceLang - Idioma de origem
   * @param targetLang - Idioma de destino
   * @returns Promise com o texto traduzido
   */
  private async callDeepLAPI(
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<string> {
    const params = new URLSearchParams({
      auth_key: this.apiKey,
      text,
      source_lang: sourceLang.toUpperCase(),
      target_lang: targetLang.toUpperCase(),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(DEEPL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`DeepL API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        translations: Array<{ text: string; detected_source_language: string }>;
      };

      if (!data.translations || data.translations.length === 0) {
        throw new Error('DeepL returned empty translations');
      }

      return data.translations[0].text;
    } finally {
      clearTimeout(timeout);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  dispose(): void {
    this.cache.clear();
    this.removeAllListeners();
  }
}

export default Translator;
