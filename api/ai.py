"""AI services backed by Google Gemini REST.

No API key is embedded. Set GEMINI_API_KEY (or GOOGLE_API_KEY). The endpoints return a
controlled fallback when AI is not configured so local/demo workflows keep working.
"""
from __future__ import annotations

import json
import os
import urllib.request


def _key():
    return os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')


def _model():
    return os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')


def _generate(parts, *, system_instruction):
    key = _key()
    if not key:
        return None
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{_model()}:generateContent?key={key}'
    body = {
        'system_instruction': {'parts': [{'text': system_instruction}]},
        'contents': [{'role': 'user', 'parts': parts}],
        'generationConfig': {'temperature': 0.2, 'maxOutputTokens': 900},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=25) as response:
        data = json.loads(response.read().decode('utf-8'))
    candidates = data.get('candidates') or []
    if not candidates:
        return None
    chunks = candidates[0].get('content', {}).get('parts', [])
    return '\n'.join(p.get('text', '') for p in chunks if p.get('text')).strip() or None
