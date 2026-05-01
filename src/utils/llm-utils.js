/**
 * LLM API Utility Module
 * Provides unified interface for calling LLM APIs
 */

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

/**
 * Call LLM API with a given prompt, with automatic fallback to alternative models
 * @param {string} prompt - The prompt to send to the LLM
 * @param {Object} options - Optional configuration
 * @param {string|string[]} options.model - Override default model(s). Can be a string or array of fallback models
 * @param {number} options.temperature - Temperature setting (default: 0.1)
 * @param {boolean} options.enableThinking - Enable thinking mode (default: false)
 * @returns {Promise<string>} The LLM response content
 */
export const callLLMAPI = async (prompt, options = {}) => {
  const { apiUrl, apiKey, models: defaultModels } = getLLMConfig();

  const {
    model: overrideModel,
    temperature = 0.1,
    enableThinking = false,
  } = options;

  // Determine which models to try (override or default)
  let modelsToTry;
  if (overrideModel) {
    modelsToTry = Array.isArray(overrideModel) 
      ? overrideModel 
      : [overrideModel];
  } else {
    modelsToTry = defaultModels;
  }

  // Try each model in sequence until one succeeds
  const errors = [];
  for (const model of modelsToTry) {
    try {
      console.log(`Attempting LLM call with model: ${model}`);
      
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        extra_body: { enable_thinking: enableThinking },
      });

      const res = await fetch(apiUrl, { method: 'POST', headers, body });

      if (!res.ok) {
        throw new Error(`LLM API error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('LLM returned empty content');
      }

      console.log(`✓ Successfully used model: ${model}`);
      return content;
    } catch (error) {
      console.warn(`✗ Model "${model}" failed: ${error.message}`);
      errors.push({ model, error: error.message });
      
      // Continue to next model if available
      if (modelsToTry.indexOf(model) < modelsToTry.length - 1) {
        console.log(`Trying next model...`);
        continue;
      }
    }
  }

  // All models failed
  const errorSummary = errors.map(e => `${e.model}: ${e.error}`).join('; ');
  throw new Error(`All LLM models failed. Errors: ${errorSummary}`);
};

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 * @param {string} content - The LLM response content
 * @returns {Object|Array} Parsed JSON
 */
export const parseLLMJSON = (content) => {
  // Extract JSON (handle markdown code blocks)
  const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                    content.match(/```[\s\S]*?```/);
  const jsonStr = jsonMatch
    ? (jsonMatch[1] || jsonMatch[0].replace(/```/g, ''))
    : content;

  return JSON.parse(jsonStr.trim());
};
