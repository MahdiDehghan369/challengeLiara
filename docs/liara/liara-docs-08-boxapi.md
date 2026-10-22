# BoxAPI — LLM provider for the hackathon

OpenAI-compatible API.

**Base URL:** `https://ai.boxapi.ir/ai/v1`
**Supported endpoints:** `/chat/completions`, `/embeddings`
**Auth:** API key (`BOXAPI_API_KEY`) passed as the OpenAI-style bearer key.

## Supported models for the hackathon
```
gpt-6.1-sol
gpt-6-astra
gpt-6-luna
gpt-6-sol
gpt-5-mini
gpt-5.6-luna
gpt-5.6-terra
gpt-5.6-sol
gpt-5.4-mini
gpt-5.3-codex
text-embedding-3-small
text-embedding-3-large
```

## Example (Python, `openai` SDK)
```python
from openai import OpenAI

client = OpenAI(
    api_key="BOXAPI_API_KEY",
    base_url="https://ai.boxapi.ir/ai/v1",
)

response = client.chat.completions.create(
    model="gpt-6-astra",
    messages=[
        {"role": "user", "content": "سلام، من BoxAPI هستم."},
    ],
)

print(response.choices[0].message.content)
```

## Example (Node/TypeScript, same API)
```ts
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.BOXAPI_API_KEY, baseURL: 'https://ai.boxapi.ir/ai/v1' });
const r = await client.chat.completions.create({ model: 'gpt-6-astra', messages: [{ role: 'user', content: 'سلام' }] });
console.log(r.choices[0].message.content);
```

## NOT PROVIDED
Whether each model supports tool calling, streaming and `response_format: json_object` — test with `scripts/llm-smoke.ts` (Phase 0, task T0.2) and record the result in `docs/LLM_COMPAT.md`.
