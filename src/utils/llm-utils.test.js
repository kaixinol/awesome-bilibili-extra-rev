import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callLLMJSON } from './llm-utils.js';

const ok = (content) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

const badRequest = (message = 'bad request') => ({
  ok: false,
  status: 400,
  statusText: 'Bad Request',
  text: async () => message,
});

const arraySchema = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    properties: { related: { type: 'boolean' } },
    required: ['related'],
    additionalProperties: false,
  },
};

const objectSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};

const validArray = '[{"related":true}]';

describe('llm-utils structured output', () => {
  const originalApiUrl = process.env.LLM_API_URL;

  beforeEach(() => {
    process.env.LLM_API_URL = 'https://example.test/v1/chat/completions';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalApiUrl === undefined) delete process.env.LLM_API_URL;
    else process.env.LLM_API_URL = originalApiUrl;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends response_format.json_schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(validArray));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLLMJSON('prompt', {
      name: 'array_schema',
      schema: arraySchema,
      model: 'schema-model-a',
    });

    expect(result).toEqual([{ related: true }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('array_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toEqual(arraySchema);
  });

  it('keeps schema on 400 minimal retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(badRequest('unsupported temperature'))
      .mockResolvedValueOnce(ok(validArray));
    vi.stubGlobal('fetch', fetchMock);

    await callLLMJSON('prompt', { name: 'array_schema', schema: arraySchema, model: 'schema-model-b' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(first.temperature).toBe(0.1);
    expect(first.response_format).toBeDefined();
    expect(second.temperature).toBeUndefined();
    expect(second.extra_body).toBeUndefined();
    expect(second.response_format).toBeDefined();
  });

  it('falls back to prompt-only when schema is rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(badRequest('unsupported temperature'))
      .mockResolvedValueOnce(badRequest('unsupported response_format'))
      .mockResolvedValueOnce(ok(validArray));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLLMJSON('prompt', {
      name: 'array_schema',
      schema: arraySchema,
      model: 'schema-model-c',
    });

    expect(result).toEqual([{ related: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const third = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(third.temperature).toBeUndefined();
    expect(third.extra_body).toBeUndefined();
    expect(third.response_format).toBeUndefined();
  });

  it('tries next model with schema when first model fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(badRequest('fail'))
      .mockResolvedValueOnce(badRequest('fail'))
      .mockResolvedValueOnce(badRequest('fail'))
      .mockResolvedValueOnce(ok(validArray));
    vi.stubGlobal('fetch', fetchMock);

    await callLLMJSON('prompt', {
      name: 'array_schema',
      schema: arraySchema,
      model: ['schema-model-d', 'schema-model-e'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const last = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(last.model).toBe('schema-model-e');
    expect(last.response_format).toBeDefined();
  });

  it('validates LLM JSON locally and returns the parsed result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('```json\n{"ok":true}\n```'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLLMJSON('prompt', {
      name: 'object_schema',
      schema: objectSchema,
      model: 'json-model-a',
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects LLM JSON that does not match the schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('{"nope":1}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callLLMJSON('prompt', {
      name: 'object_schema',
      schema: objectSchema,
      model: 'json-model-b',
    })).rejects.toThrow('Invalid LLM response');
  });

  it('revalidates after an optional fix callback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('{"ok":"yes"}'));
    vi.stubGlobal('fetch', fetchMock);
    const fix = vi.fn((result) => {
      result.ok = Boolean(result.ok);
      return true;
    });

    const result = await callLLMJSON('prompt', {
      name: 'object_schema',
      schema: objectSchema,
      model: 'json-model-c',
      fix,
    });

    expect(fix).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
  });
});
