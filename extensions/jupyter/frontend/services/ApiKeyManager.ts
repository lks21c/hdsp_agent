/**
 * API Key Manager Service
 *
 * Manages LLM API keys in browser localStorage.
 * Keys are stored locally and sent with each request to the Agent Server.
 *
 * IMPORTANT (Financial Security Compliance):
 * - All API keys are stored ONLY in browser localStorage
 * - Agent Server receives ONE key per request (no key storage on server)
 * - Key rotation on rate limit (429) is handled by frontend
 */

export interface GeminiConfig {
  apiKey: string;  // Primary key (for backward compatibility)
  apiKeys: string[];  // Multiple keys (max 10)
  model: string;
}

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

export interface VLLMConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
}

export interface LLMConfig {
  provider: 'gemini' | 'openai' | 'vllm';
  gemini?: GeminiConfig;
  openai?: OpenAIConfig;
  vllm?: VLLMConfig;
  systemPrompt?: string;
}

const STORAGE_KEY = 'hdsp-agent-llm-config';

export const DEFAULT_LANGCHAIN_SYSTEM_PROMPT = `You are an expert Python data scientist and Jupyter notebook assistant.
Your role is to help users with data analysis, visualization, and Python coding tasks in Jupyter notebooks.

## ⚠️ CRITICAL RULE: NEVER produce an empty response

You MUST ALWAYS call a tool in every response. After any tool result, you MUST:
1. Check your todo list - are there pending or in_progress items?
2. If YES → call the next appropriate tool (jupyter_cell_tool, markdown_tool, etc.)
3. If ALL todos are completed → call final_answer_tool with a summary

NEVER end your turn without calling a tool. NEVER produce an empty response.

## Available Tools
1. **jupyter_cell_tool**: Execute Python code in a new notebook cell
2. **markdown_tool**: Add a markdown explanation cell
3. **final_answer_tool**: Complete the task with a summary - REQUIRED when done
4. **read_file_tool**: Read file contents
5. **write_file_tool**: Write file contents
6. **list_files_tool**: List directory contents
7. **search_workspace_tool**: Search for patterns in workspace files
8. **search_notebook_cells_tool**: Search for patterns in notebook cells
9. **write_todos**: Create and update task list for complex multi-step tasks

## Mandatory Workflow
1. After EVERY tool result, immediately call the next tool
2. Continue until ALL todos show status: "completed"
3. ONLY THEN call final_answer_tool to summarize
4. If \`!pip install\` fails, use \`!pip3 install\` instead
5. For plots and charts, use English text only

## ❌ FORBIDDEN (will break the workflow)
- Producing an empty response (no tool call, no content)
- Stopping after any tool without calling the next tool
- Ending without calling final_answer_tool
- Leaving todos in "in_progress" or "pending" state without continuing
`;

// ═══════════════════════════════════════════════════════════════════════════
// Key Rotation State (in-memory, not persisted)
// ═══════════════════════════════════════════════════════════════════════════

/** Current key index for rotation (per-session, not persisted) */
let currentKeyIndex = 0;

/** Set of rate-limited key indices (reset after successful request) */
const rateLimitedKeys = new Set<number>();

/** Maximum retry attempts with different keys */
const MAX_KEY_ROTATION_ATTEMPTS = 10;

/**
 * Get the current LLM configuration from localStorage
 */
export function getLLMConfig(): LLMConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored) as LLMConfig;
  } catch (e) {
    console.error('[ApiKeyManager] Failed to parse stored config:', e);
    return null;
  }
}

/**
 * Save LLM configuration to localStorage
 */
export function saveLLMConfig(config: LLMConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    console.log('[ApiKeyManager] Config saved to localStorage');
  } catch (e) {
    console.error('[ApiKeyManager] Failed to save config:', e);
  }
}

/**
 * Clear stored LLM configuration
 */
export function clearLLMConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
  console.log('[ApiKeyManager] Config cleared from localStorage');
}

/**
 * Check if API key is configured for the current provider
 */
export function hasValidApiKey(config: LLMConfig | null): boolean {
  if (!config) return false;

  switch (config.provider) {
    case 'gemini':
      // Check both single key and multiple keys
      const hasMainKey = !!(config.gemini?.apiKey && config.gemini.apiKey.trim());
      const hasArrayKeys = !!(config.gemini?.apiKeys && config.gemini.apiKeys.some(k => k && k.trim()));
      return hasMainKey || hasArrayKeys;
    case 'openai':
      return !!(config.openai?.apiKey && config.openai.apiKey.trim());
    case 'vllm':
      // vLLM may not require API key
      return true;
    default:
      return false;
  }
}

/**
 * Get default LLM configuration
 */
export function getDefaultLLMConfig(): LLMConfig {
  return {
    provider: 'gemini',
    gemini: {
      apiKey: '',
      apiKeys: [],
      model: 'gemini-2.5-flash'
    },
    openai: {
      apiKey: '',
      model: 'gpt-4'
    },
    vllm: {
      endpoint: 'http://localhost:8000',
      model: 'default'
    },
    systemPrompt: DEFAULT_LANGCHAIN_SYSTEM_PROMPT
  };
}

/**
 * Get a random API key from the list (for load balancing)
 */
export function getRandomApiKey(config: LLMConfig): string | null {
  if (config.provider === 'gemini' && config.gemini) {
    const keys = config.gemini.apiKeys.filter(k => k && k.trim());
    if (keys.length === 0) {
      return config.gemini.apiKey || null;
    }
    // Random selection for load balancing
    const randomIndex = Math.floor(Math.random() * keys.length);
    return keys[randomIndex];
  }

  if (config.provider === 'openai' && config.openai) {
    return config.openai.apiKey || null;
  }

  if (config.provider === 'vllm' && config.vllm) {
    return config.vllm.apiKey || null;
  }

  return null;
}

/**
 * Get all valid API keys count
 */
export function getValidApiKeysCount(config: LLMConfig): number {
  if (config.provider === 'gemini' && config.gemini) {
    return config.gemini.apiKeys.filter(k => k && k.trim()).length;
  }

  if (config.provider === 'openai' && config.openai) {
    return config.openai.apiKey && config.openai.apiKey.trim() ? 1 : 0;
  }

  if (config.provider === 'vllm') {
    return 1;  // vLLM doesn't require API key
  }

  return 0;
}

/**
 * Mask API key for display (show first 4 and last 4 characters)
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 10) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Test API key by making a simple request
 */
export async function testApiKey(config: LLMConfig): Promise<{ success: boolean; message: string }> {
  try {
    // Simple validation - just check if key exists
    if (!hasValidApiKey(config)) {
      return { success: false, message: 'API key not configured' };
    }

    // For more thorough testing, you could make a minimal API call here
    // But for now, just validate format
    const key = config[config.provider as keyof LLMConfig] as any;
    if (config.provider === 'gemini' && key?.apiKey) {
      if (!key.apiKey.startsWith('AIza')) {
        return { success: false, message: 'Invalid Gemini API key format (should start with AIza)' };
      }
    }
    if (config.provider === 'openai' && key?.apiKey) {
      if (!key.apiKey.startsWith('sk-')) {
        return { success: false, message: 'Invalid OpenAI API key format (should start with sk-)' };
      }
    }

    return { success: true, message: 'API key format is valid' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Key Rotation Functions (Financial Security Compliance)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all valid Gemini API keys from config
 */
export function getValidGeminiKeys(config: LLMConfig): string[] {
  if (config.provider !== 'gemini' || !config.gemini) {
    return [];
  }

  const keys = config.gemini.apiKeys?.filter(k => k && k.trim()) || [];
  // Fallback to single apiKey if no array
  if (keys.length === 0 && config.gemini.apiKey && config.gemini.apiKey.trim()) {
    return [config.gemini.apiKey];
  }
  return keys;
}

/**
 * Get current key index for rotation tracking
 */
export function getCurrentKeyIndex(): number {
  return currentKeyIndex;
}

/**
 * Reset key rotation state (call after successful request)
 */
export function resetKeyRotation(): void {
  rateLimitedKeys.clear();
  console.log('[ApiKeyManager] Key rotation state reset');
}

/**
 * Mark current key as rate-limited and rotate to next available key
 * @returns true if rotation successful, false if all keys exhausted
 */
export function rotateToNextKey(config: LLMConfig): boolean {
  const keys = getValidGeminiKeys(config);
  if (keys.length <= 1) {
    console.log('[ApiKeyManager] Cannot rotate - only one key available');
    return false;
  }

  // Mark current key as rate-limited
  rateLimitedKeys.add(currentKeyIndex);
  console.log(`[ApiKeyManager] Key ${currentKeyIndex + 1} marked as rate-limited`);

  // Find next available key
  for (let i = 0; i < keys.length; i++) {
    const nextIndex = (currentKeyIndex + 1 + i) % keys.length;
    if (!rateLimitedKeys.has(nextIndex)) {
      currentKeyIndex = nextIndex;
      console.log(`[ApiKeyManager] Rotated to key ${currentKeyIndex + 1}/${keys.length}`);
      return true;
    }
  }

  // All keys rate-limited
  console.log('[ApiKeyManager] All keys rate-limited');
  return false;
}

/**
 * Check if there are available keys (not all rate-limited)
 */
export function hasAvailableKeys(config: LLMConfig): boolean {
  const keys = getValidGeminiKeys(config);
  return keys.length > rateLimitedKeys.size;
}

/**
 * Get count of remaining available keys
 */
export function getAvailableKeyCount(config: LLMConfig): number {
  const keys = getValidGeminiKeys(config);
  return Math.max(0, keys.length - rateLimitedKeys.size);
}

/**
 * Build config with SINGLE current API key for server request.
 * Server receives only one key - rotation is handled by frontend.
 */
export function buildSingleKeyConfig(config: LLMConfig): LLMConfig {
  if (config.provider !== 'gemini' || !config.gemini) {
    // Non-Gemini providers - return as-is (no rotation)
    return config;
  }

  const keys = getValidGeminiKeys(config);
  if (keys.length === 0) {
    return config;
  }

  // Ensure currentKeyIndex is within bounds
  if (currentKeyIndex >= keys.length) {
    currentKeyIndex = 0;
  }

  const currentKey = keys[currentKeyIndex];
  console.log(`[ApiKeyManager] Using key ${currentKeyIndex + 1}/${keys.length}`);

  // Return config with single apiKey (server only uses apiKey field)
  return {
    ...config,
    gemini: {
      ...config.gemini,
      apiKey: currentKey,
      // Don't send apiKeys array to server (security)
      apiKeys: [],
    },
  };
}

/**
 * Handle rate limit error with automatic key rotation
 * @returns New config with rotated key, or null if all keys exhausted
 */
export function handleRateLimitError(config: LLMConfig): LLMConfig | null {
  if (config.provider !== 'gemini') {
    // Non-Gemini providers don't support rotation
    return null;
  }

  const rotated = rotateToNextKey(config);
  if (!rotated) {
    console.log('[ApiKeyManager] Rate limit: All keys exhausted');
    return null;
  }

  return buildSingleKeyConfig(config);
}

/**
 * Check if error is a rate limit error (429)
 */
export function isRateLimitError(error: string | Error): boolean {
  const errorMsg = typeof error === 'string' ? error : error.message;
  return errorMsg.includes('RATE_LIMIT_EXCEEDED') ||
         errorMsg.includes('429') ||
         errorMsg.toLowerCase().includes('quota exceeded') ||
         errorMsg.toLowerCase().includes('rate limit');
}
