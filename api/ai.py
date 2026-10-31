"""AI services backed by Google Gemini REST.

No API key is embedded. Set GEMINI_API_KEY (or GOOGLE_API_KEY). The endpoints return a
controlled fallback when AI is not configured so local/demo workflows keep working.
"""
from __future__ import annotations

import json
import logging
import os
import socket
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)


class GeminiAPIError(RuntimeError):
    """Lỗi đã chuẩn hóa từ Gemini, không chứa API key."""

    def __init__(self, message, *, status_code=None, code='provider_error'):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def _key():
    return os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')


def _model(override=None):
    return override or os.getenv('GEMINI_MODEL', 'gemini-3.6-flash')


def _timeout_seconds():
    try:
        return min(60, max(3, int(os.getenv('GEMINI_TIMEOUT_SECONDS', '22'))))
    except ValueError:
        return 22


def _generation_config(*, model=None, json_schema=None, max_tokens=900, temperature=0.2):
    model = _model(model).lower()
    config = {'maxOutputTokens': max_tokens}
    if model.startswith(('gemini-3', 'gemini-4')):
        level = os.getenv('GEMINI_THINKING_LEVEL', 'low').lower()
        if level not in {'low', 'medium', 'high'}:
            level = 'low'
        config['thinkingConfig'] = {'thinkingLevel': level}
    else:
        config['temperature'] = temperature
        if model.startswith('gemini-2.5-flash'):
            config['thinkingConfig'] = {'thinkingBudget': 0}
    if json_schema:
        config['responseMimeType'] = 'application/json'
        config['responseSchema'] = json_schema
    return config


def _provider_message(payload):
    try:
        return str(json.loads(payload).get('error', {}).get('message', '')).strip()[:500]
    except (json.JSONDecodeError, AttributeError, TypeError):
        return ''


def _generate_once(parts, *, system_instruction, model=None, json_schema=None, max_tokens=900, temperature=0.2):
    """Gọi Gemini. Truyền json_schema để bắt buộc đầu ra là JSON đúng cấu trúc (không phải đoán bằng regex)."""
    key = _key()
    if not key:
        return None
    model = _model(model)
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    body = {
        'system_instruction': {'parts': [{'text': system_instruction}]},
        'contents': [{'role': 'user', 'parts': parts}],
        'generationConfig': _generation_config(
            model=model, json_schema=json_schema, max_tokens=max_tokens, temperature=temperature,
        ),
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key},
    )
    try:
        with urllib.request.urlopen(req, timeout=_timeout_seconds()) as response:
            data = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        payload = exc.read(4096).decode('utf-8', errors='replace')
        message = _provider_message(payload) or f'Gemini HTTP {exc.code}'
        logger.warning('Gemini request failed model=%s status=%s message=%s', model, exc.code, message)
        raise GeminiAPIError(message, status_code=exc.code, code='http_error') from exc
    except (TimeoutError, socket.timeout) as exc:
        raise GeminiAPIError('Gemini không phản hồi trong thời gian cho phép.', code='timeout') from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise GeminiAPIError('Gemini không phản hồi trong thời gian cho phép.', code='timeout') from exc
        raise GeminiAPIError('Không kết nối được tới Gemini.', code='connection_error') from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise GeminiAPIError('Gemini trả về dữ liệu không hợp lệ.', code='invalid_response') from exc
    candidates = data.get('candidates') or []
    if not candidates:
        reason = str(data.get('promptFeedback', {}).get('blockReason', '')).strip()
        if reason:
            raise GeminiAPIError(f'Yêu cầu bị Gemini từ chối: {reason}.', code='blocked')
        raise GeminiAPIError('Gemini không trả về nội dung.', code='empty_response')
    chunks = candidates[0].get('content', {}).get('parts', [])
    text = '\n'.join(p.get('text', '') for p in chunks if p.get('text')).strip()
    if not text:
        raise GeminiAPIError('Gemini không trả về nội dung văn bản.', code='empty_response')
    return text


def _fallback_models(primary):
    configured = os.getenv('GEMINI_FALLBACK_MODELS', 'gemini-3.5-flash-lite,gemini-3.6-flash')
    models = [primary]
    for name in configured.split(','):
        name = name.strip()
        if name and name not in models:
            models.append(name)
    return models


def _generate(parts, *, system_instruction, model=None, json_schema=None, max_tokens=900, temperature=0.2):
    primary = _model(model)
    models = _fallback_models(primary)
    for index, selected_model in enumerate(models):
        try:
            return _generate_once(
                parts, system_instruction=system_instruction, model=selected_model,
                json_schema=json_schema, max_tokens=max_tokens, temperature=temperature,
            )
        except GeminiAPIError as exc:
            can_fallback = exc.status_code in {404, 429, 500, 502, 503, 504} and index + 1 < len(models)
            if not can_fallback:
                raise
            logger.warning(
                'Gemini model unavailable model=%s status=%s; falling back to %s',
                selected_model, exc.status_code, models[index + 1],
            )
    raise GeminiAPIError('Không có model Gemini khả dụng.', code='provider_error')
