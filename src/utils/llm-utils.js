/**
 * LLM API Utility Module
 * Provides unified interface for calling LLM APIs
 */

import Ajv from 'ajv';

/**
 * Parse model list from environment variable
 * Supports both single model and comma-separated fallback models
 * @param {string} modelEnv - The LLM_MODEL environment variable value
 * @returns {string[]} Array of model names in priority order
 */
const parseModelList = (modelEnv) => {
  if (!modelEnv) {
    return ['gpt-4o-mini']; // Default fallback
  }

  // Split by comma and trim whitespace, filter out empty strings
  return modelEnv.split(',')
    .map(model => model.trim())
    .filter(model => model.length > 0);
};

/**
 * Configuration for LLM API calls
 */
const getLLMConfig = () => {
  const LLM_API_URL = process.env.LLM_API_URL;
  const LLM_API_KEY = process.env.LLM_API_KEY;
  const LLM_MODEL = process.env.LLM_MODEL;

  if (!LLM_API_URL) {
    throw new Error('LLM_API_URL environment variable is not set');
  }

  return {
    apiUrl: LLM_API_URL,
    apiKey: LLM_API_KEY,
    models: parseModelList(LLM_MODEL),
  };
};

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const RATE_LIMIT_MAX_STRIKES = 3;

const disabledModels = new Set();
const minimalParamModels = new Set();
const rateLimitedUntil = new Map();
const rateLimitStrikes = new Map();

const isAvailable = (model, now) => !disabledModels.has(model) && !(rateLimitedUntil.get(model) > now);

const ajv = new Ajv({ allErrors: true });
const validators = new WeakMap();

const getValidator = (schema) => {
  if (!validators.has(schema)) validators.set(schema, ajv.compile(schema));
  return validators.get(schema);
};

const formatErrors = (validate) => (validate.errors || [])
  .map((e) => `${e.instancePath || 'root'} ${e.message}`)
  .join('; ');

const jsonSchemaResponse = (name, schema) => ({
  type: 'json_schema',
  json_schema: { name, strict: true, schema },
});

const callModel = async ({ apiUrl, apiKey, model, prompt, temperature, enableThinking, responseFormat, minimal, useSchema }) => {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const body = { model, messages: [{ role: 'user', content: prompt }] };
  if (!minimal) {
    body.temperature = temperature;
    body.extra_body = { enable_thinking: enableThinking };
  }
  if (useSchema) body.response_format = responseFormat;

  const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`LLM API error: ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    error.status = res.status;
    error.minimal = minimal;
    error.useSchema = useSchema;
    throw error;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty content');
  }
  return content;
};

/**
 * Call LLM API with a given prompt, with automatic fallback to alternative models
 * @param {string} prompt - The prompt to send to the LLM
 * @param {Object} options - Optional configuration
 * @param {string|string[]} options.model - Override default model(s). Can be a string or array of fallback models
 * @param {number} options.temperature - Temperature setting (default: 0.1)
 * @param {boolean} options.enableThinking - Enable thinking mode (default: false)
 * @param {Object} options.responseFormat - OpenAI-compatible structured output format
 * @returns {Promise<string>} The LLM response content
 */
const callLLMAPI = async (prompt, options = {}) => {
  const { apiUrl, apiKey, models: defaultModels } = getLLMConfig();
  const {
    model: overrideModel,
    temperature = 0.1,
    enableThinking = false,
    responseFormat,
  } = options;

  const requested = overrideModel
    ? (Array.isArray(overrideModel) ? overrideModel : [overrideModel])
    : defaultModels;
  const now = Date.now();
  const modelsToTry = requested.filter(model => isAvailable(model, now));

  if (modelsToTry.length === 0) {
    const cooling = requested.filter(model => rateLimitedUntil.get(model) > now);
    throw new Error(`All LLM models unavailable (disabled: ${[...disabledModels].join(', ') || 'none'}; cooling: ${cooling.join(', ') || 'none'})`);
  }

  const errors = [];
  for (const model of modelsToTry) {
    const args = { apiUrl, apiKey, model, prompt, temperature, enableThinking, responseFormat };
    const minimal = minimalParamModels.has(model);
    const useSchema = Boolean(responseFormat);

    let error;
    try {
      console.log(`Attempting LLM call with model: ${model}`);
      const content = await callModel({ ...args, minimal, useSchema });
      rateLimitStrikes.delete(model);
      console.log(`✓ Successfully used model: ${model}`);
      return content;
    } catch (e) {
      error = e;
      console.warn(`✗ Model "${model}" failed: ${error.message}`);
      errors.push({ model, error: error.message });
    }

    // 400 且本次带了可选参数 → 无条件用最小参数重试一次，但保留 schema。
    // 不读 Set 决策，避免并发下两个 worker 同时 400 时，后者看到 Set 已有该模型而跳过重试直接拉黑。
    if (error.status === 400 && !error.minimal) {
      minimalParamModels.add(model);
      try {
        const content = await callModel({ ...args, minimal: true, useSchema });
        rateLimitStrikes.delete(model);
        console.log(`✓ Successfully used model: ${model} (minimal params)`);
        return content;
      } catch (retryError) {
        error = retryError;
        console.warn(`✗ Model "${model}" minimal retry failed: ${error.message}`);
        errors.push({ model, error: error.message });
      }
    }

    // Schema 不被接受时降级为纯 prompt 输出；本地校验仍会兜底。
    if (error.status === 400 && error.useSchema) {
      try {
        const content = await callModel({ ...args, minimal: true, useSchema: false });
        rateLimitStrikes.delete(model);
        console.log(`✓ Successfully used model: ${model} (no schema)`);
        return content;
      } catch (schemaRetryError) {
        error = schemaRetryError;
        console.warn(`✗ Model "${model}" no-schema retry failed: ${error.message}`);
        errors.push({ model, error: error.message });
      }
    }

    if (error.status === 429) {
      // 冷却窗口内的重复 429 属于同一波限流，不累加；否则并发突发会瞬间凑满 3 次
      if ((rateLimitedUntil.get(model) || 0) <= Date.now()) {
        const strikes = (rateLimitStrikes.get(model) || 0) + 1;
        rateLimitStrikes.set(model, strikes);
        if (strikes >= RATE_LIMIT_MAX_STRIKES) {
          disabledModels.add(model);
          console.warn(`⊘ Model "${model}" rate-limited ${strikes} times, disabled permanently`);
        } else {
          rateLimitedUntil.set(model, Date.now() + RATE_LIMIT_COOLDOWN_MS);
          console.warn(`⏳ Model "${model}" cooling down 60s (${strikes}/${RATE_LIMIT_MAX_STRIKES})`);
        }
      } else {
        console.warn(`⏳ Model "${model}" still cooling (${rateLimitStrikes.get(model)}/${RATE_LIMIT_MAX_STRIKES})`);
      }
    } else {
      disabledModels.add(model);
    }

    if (modelsToTry.indexOf(model) < modelsToTry.length - 1) {
      console.log('Trying next model...');
    }
  }

  const errorSummary = errors.map(e => `${e.model}: ${e.error}`).join('; ');
  throw new Error(`All LLM models failed. Errors: ${errorSummary}`);
};

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 * @param {string} content - The LLM response content
 * @returns {Object|Array} Parsed JSON
 */
const parseLLMJSON = (content) => {
  // Extract JSON (handle markdown code blocks)
  const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                    content.match(/```[\s\S]*?```/);
  const jsonStr = jsonMatch
    ? (jsonMatch[1] || jsonMatch[0].replace(/```/g, ''))
    : content;

  return JSON.parse(jsonStr.trim());
};

/**
 * Call LLM with a JSON Schema and validate the response locally with Ajv.
 * @param {string} prompt - The prompt to send to the LLM
 * @param {Object} options
 * @param {string} options.name - JSON Schema name sent to the provider
 * @param {Object} options.schema - JSON Schema used for both provider and local validation
 * @param {(result: Object|Array) => boolean} [options.fix] - Optional in-place repair before revalidation
 * @returns {Promise<Object|Array>} Parsed and validated JSON
 */
export const callLLMJSON = async (prompt, { name, schema, fix, ...options } = {}) => {
  const validate = getValidator(schema);
  const content = await callLLMAPI(prompt, {
    ...options,
    responseFormat: jsonSchemaResponse(name, schema),
  });
  const result = parseLLMJSON(content);

  if (validate(result)) return result;

  if (fix?.(result) && validate(result)) {
    console.log('  ✓ Validation passed after auto-fix');
    return result;
  }

  throw new Error(`Invalid LLM response: ${formatErrors(validate) || 'unknown validation error'}`);
};
