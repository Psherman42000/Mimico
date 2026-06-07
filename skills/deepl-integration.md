---
name: deepl-api
description: "DeepL API Free tier usage: authentication, translation, limits, caching"
---

# DeepL API Integration

## API Key Setup
1. Go to https://www.deepl.com/pro-api (click "Sign up for Free")
2. Create account and get API key
3. Free tier: 500,000 characters/month

## API Endpoint
```typescript
const DEEPL_API = 'https://api-free.deepl.com/v2/translate';
// Pro accounts use: https://api.deepl.com/v2/translate
```

## Translation Request
```typescript
async function translate(text: string, targetLang: string, sourceLang?: string) {
  const params = new URLSearchParams({
    text,
    target_lang: targetLang,        // 'PT-BR', 'EN-US'
  });
  if (sourceLang) params.set('source_lang', sourceLang); // 'EN', 'PT'

  const response = await fetch(DEEPL_API, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const data = await response.json();
  return data.translations[0].text;
}
```

## Response Format
```json
{
  "translations": [
    {
      "detected_source_language": "EN",
      "text": "Vamos revisar as projeções do Q3"
    }
  ]
}
```

## LRU Cache Strategy
- Cache size: 1000 entries per direction (EN→PT, PT→EN)
- Key: `sourceLang:targetLang:text` (normalized lowercase)
- TTL: session-only (no disk persistence)
- Clear on config change (new API key)

```typescript
class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;

  get(key: K): V | undefined { /* move to recent */ }
  set(key: K, value: V): void { /* evict oldest if full */ }
}
```

## Error Handling
| Status | Meaning | Action |
|--------|---------|--------|
| 403 | Invalid API key | Show config prompt |
| 429 | Rate limited | Retry with backoff (1s, 2s, 4s) |
| 456 | Quota exceeded | Notify user, show original text |
| 5xx | Server error | Retry once, fallback to original |

## Usage Limits
- 500,000 chars/month (Free)
- ~50 chars per subtitle line
- ~10,000 lines/month capacity
- For heavy use, upgrade to DeepL Pro ($5.49/mo, 1M chars)
