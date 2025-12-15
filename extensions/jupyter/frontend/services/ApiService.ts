/**
 * API Service Layer for REST communication with backend
 */

import {
  IAgentConfig,
  ICellActionRequest,
  ICellResponse,
  IChatRequest,
  IChatResponse,
  IHealthStatus,
  IModelInfo,
  IFileFixRequest,
  IFileFixResponse,
  ILLMConfig
} from '../types';

import {
  buildSingleKeyConfig,
  handleRateLimitError,
  isRateLimitError,
  resetKeyRotation,
  getValidGeminiKeys,
  getCurrentKeyIndex,
  LLMConfig
} from './ApiKeyManager';

import {
  AutoAgentPlanRequest,
  AutoAgentPlanResponse,
  AutoAgentRefineRequest,
  AutoAgentRefineResponse,
  AutoAgentReplanRequest,
  AutoAgentReplanResponse,
  AutoAgentValidateRequest,
  AutoAgentValidateResponse,
  AutoAgentReflectRequest,
  AutoAgentReflectResponse,
  AutoAgentVerifyStateRequest,
  AutoAgentVerifyStateResponse,
  ExecutionPlan,
  PlanStep,
  ExecutionError,
  ToolCall,
} from '../types/auto-agent';

// ✅ 핵심 변경 1: ServerConnection 대신 PageConfig 임포트
import { URLExt, PageConfig } from '@jupyterlab/coreutils';

export class ApiService {
  private baseUrl: string;

  // 생성자에서 baseUrl을 선택적으로 받도록 하되, 없으면 자동으로 계산
  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else {
      // ✅ 핵심 변경 2: ServerConnection 대신 PageConfig로 URL 가져오기
      // PageConfig.getBaseUrl()은 '/user/아이디/프로젝트/' 형태의 주소를 정확히 가져옵니다.
      const serverRoot = PageConfig.getBaseUrl();

      // 3. 경로 합치기
      // 결과: /user/453467/pl2wadmprj/hdsp-agent
      this.baseUrl = URLExt.join(serverRoot, 'hdsp-agent');
    }

    console.log('[ApiService] Base URL initialized:', this.baseUrl); // 디버깅용 로그
  }

  /**
   * Get cookie value by name
   */
  private getCookie(name: string): string {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      return parts.pop()?.split(';').shift() || '';
    }
    return '';
  }

  /**
   * Get CSRF token from cookie
   */
  private getCsrfToken(): string {
    return this.getCookie('_xsrf');
  }

  /**
   * Get headers with CSRF token for POST requests
   */
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-XSRFToken': this.getCsrfToken()
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Global Rate Limit Handling with Key Rotation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch wrapper with automatic API key rotation on rate limit (429)
   *
   * NOTE (Financial Security Compliance):
   * - API key rotation is handled by frontend (not server)
   * - Server receives ONLY ONE key per request
   * - On 429 rate limit, frontend rotates key and retries with next key
   */
  private async fetchWithKeyRotation<T>(
    url: string,
    request: { llmConfig?: any; [key: string]: any },
    options?: {
      onKeyRotation?: (keyIndex: number, totalKeys: number) => void;
      defaultErrorMessage?: string;
    }
  ): Promise<T> {
    const MAX_RETRIES = 10;
    const originalConfig = request.llmConfig as LLMConfig | undefined;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Build request with single key for this attempt
      const requestToSend = originalConfig
        ? { ...request, llmConfig: buildSingleKeyConfig(originalConfig) }
        : request;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          credentials: 'include',
          body: JSON.stringify(requestToSend)
        });

        if (response.ok) {
          // Success - reset key rotation state
          resetKeyRotation();
          return response.json();
        }

        // Handle error response
        const errorText = await response.text();

        // Check if rate limit error
        if (isRateLimitError(errorText) && originalConfig) {
          console.log(`[ApiService] Rate limit on attempt ${attempt + 1}, rotating key...`);

          // Try to rotate to next key
          const rotatedConfig = handleRateLimitError(originalConfig);

          if (rotatedConfig) {
            // Notify UI about key rotation
            const keys = getValidGeminiKeys(originalConfig);
            if (options?.onKeyRotation) {
              options.onKeyRotation(getCurrentKeyIndex(), keys.length);
            }
            continue; // Try next key
          } else {
            // All keys exhausted
            throw new Error('모든 API 키가 Rate Limit 상태입니다. 잠시 후 다시 시도해주세요.');
          }
        }

        // Not a rate limit error - parse and throw
        let errorMessage = options?.defaultErrorMessage || 'API 요청 실패';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorJson.error || errorJson.message || errorMessage;
        } catch (e) {
          errorMessage = errorText || errorMessage;
        }

        throw new Error(errorMessage);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(errorMsg);

        // If it's a rate limit error from the catch block, check rotation
        if (isRateLimitError(errorMsg) && originalConfig) {
          const rotatedConfig = handleRateLimitError(originalConfig);
          if (rotatedConfig) {
            const keys = getValidGeminiKeys(originalConfig);
            if (options?.onKeyRotation) {
              options.onKeyRotation(getCurrentKeyIndex(), keys.length);
            }
            continue;
          }
          throw new Error('모든 API 키가 Rate Limit 상태입니다. 잠시 후 다시 시도해주세요.');
        }

        // Not a rate limit error, throw immediately
        throw error;
      }
    }

    throw lastError || new Error('Maximum retry attempts exceeded');
  }

  /**
   * Execute cell action (explain, fix, custom)
   * Uses global rate limit handling with key rotation
   */
  async cellAction(request: ICellActionRequest): Promise<ICellResponse> {
    console.log('[ApiService] cellAction request:', request);
    return this.fetchWithKeyRotation<ICellResponse>(
      `${this.baseUrl}/cell/action`,
      request,
      { defaultErrorMessage: '셀 액션 실패' }
    );
  }

  /**
   * Send chat message (non-streaming)
   * Uses global rate limit handling with key rotation
   */
  async sendMessage(request: IChatRequest): Promise<IChatResponse> {
    console.log('[ApiService] sendMessage request');
    return this.fetchWithKeyRotation<IChatResponse>(
      `${this.baseUrl}/chat/message`,
      request,
      { defaultErrorMessage: '메시지 전송 실패' }
    );
  }

  /**
   * Send chat message with streaming response
   *
   * NOTE (Financial Security Compliance):
   * - API key rotation is handled by frontend (not server)
   * - Server receives ONLY ONE key per request
   * - On 429 rate limit, frontend rotates key and retries with next key
   */
  async sendMessageStream(
    request: IChatRequest,
    onChunk: (chunk: string) => void,
    onMetadata?: (metadata: { conversationId?: string; messageId?: string; provider?: string; model?: string }) => void
  ): Promise<void> {
    // Maximum retry attempts (should match number of keys)
    const MAX_RETRIES = 10;
    let currentConfig = request.llmConfig as LLMConfig | undefined;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Build request with single key for this attempt
      const requestToSend = currentConfig
        ? { ...request, llmConfig: buildSingleKeyConfig(currentConfig) }
        : request;

      try {
        await this.sendMessageStreamInternal(requestToSend, onChunk, onMetadata);
        // Success - reset key rotation state
        resetKeyRotation();
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(errorMsg);

        // Check if rate limit error and we have config to rotate
        if (isRateLimitError(errorMsg) && request.llmConfig) {
          console.log(`[ApiService] Rate limit on attempt ${attempt + 1}, trying next key...`);

          // Try to rotate to next key using ORIGINAL config (with all keys)
          const rotatedConfig = handleRateLimitError(request.llmConfig as LLMConfig);

          if (rotatedConfig) {
            // Update currentConfig with the rotated key for next attempt
            // Note: rotatedConfig already has single key, but we need full config for next rotation
            currentConfig = request.llmConfig as LLMConfig;
            continue; // Try next key
          } else {
            // All keys exhausted
            throw new Error('모든 API 키가 Rate Limit 상태입니다. 잠시 후 다시 시도해주세요.');
          }
        }

        // Not a rate limit error, throw immediately
        throw error;
      }
    }

    // Should not reach here, but just in case
    throw lastError || new Error('Maximum retry attempts exceeded');
  }

  /**
   * Build request with single API key for server
   * (Key rotation is managed by frontend for financial security compliance)
   */
  private buildRequestWithSingleKey(request: IChatRequest): IChatRequest {
    if (!request.llmConfig) {
      return request;
    }

    // Build config with single key (server only uses apiKey field)
    const singleKeyConfig = buildSingleKeyConfig(request.llmConfig as LLMConfig);

    return {
      ...request,
      llmConfig: singleKeyConfig
    };
  }

  /**
   * Internal streaming implementation (without retry logic)
   */
  private async sendMessageStreamInternal(
    request: IChatRequest,
    onChunk: (chunk: string) => void,
    onMetadata?: (metadata: { conversationId?: string; messageId?: string; provider?: string; model?: string }) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/chat/stream`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send message: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle errors
              if (data.error) {
                throw new Error(data.error);
              }

              // Handle metadata (conversationId, messageId, etc.)
              if (data.conversationId && onMetadata) {
                onMetadata({
                  conversationId: data.conversationId,
                  messageId: data.messageId,
                  provider: data.metadata?.provider,
                  model: data.metadata?.model
                });
              }

              // Handle content chunks
              if (data.content) {
                onChunk(data.content);
              }

              // Final metadata update
              if (data.done && data.metadata && onMetadata) {
                onMetadata({
                  provider: data.metadata.provider,
                  model: data.metadata.model
                });
              }
            } catch (e) {
              if (e instanceof SyntaxError) {
                console.warn('Failed to parse SSE data:', line);
              } else {
                throw e;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Save configuration
   */
  async saveConfig(config: IAgentConfig): Promise<void> {
    const response = await fetch(`${this.baseUrl}/config`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // ✅ 핵심 수정: 쿠키를 같이 보냄
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to save configuration' }));
      throw new Error(error.message || 'Failed to save configuration');
    }
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<IAgentConfig> {
    const response = await fetch(`${this.baseUrl}/config`);

    if (!response.ok) {
      throw new Error('Failed to load configuration');
    }

    return response.json();
  }

  /**
   * Get health status
   */
  async getStatus(): Promise<IHealthStatus> {
    const response = await fetch(`${this.baseUrl}/status`);

    if (!response.ok) {
      throw new Error('Failed to get status');
    }

    return response.json();
  }

  /**
   * Get available models
   */
  async getModels(): Promise<IModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`);

    if (!response.ok) {
      throw new Error('Failed to load models');
    }

    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-Agent API Methods (All use global rate limit handling)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate execution plan for auto-agent task
   */
  async generateExecutionPlan(
    request: AutoAgentPlanRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<AutoAgentPlanResponse> {
    console.log('[ApiService] generateExecutionPlan request:', request);
    return this.fetchWithKeyRotation<AutoAgentPlanResponse>(
      `${this.baseUrl}/auto-agent/plan`,
      request,
      { onKeyRotation, defaultErrorMessage: '계획 생성 실패' }
    );
  }

  /**
   * Refine step code after error (Self-Healing)
   */
  async refineStepCode(
    request: AutoAgentRefineRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<AutoAgentRefineResponse> {
    console.log('[ApiService] refineStepCode request:', request);
    return this.fetchWithKeyRotation<AutoAgentRefineResponse>(
      `${this.baseUrl}/auto-agent/refine`,
      request,
      { onKeyRotation, defaultErrorMessage: '코드 수정 실패' }
    );
  }

  /**
   * Adaptive Replanning - 에러 분석 후 계획 재수립
   */
  async replanExecution(
    request: AutoAgentReplanRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<AutoAgentReplanResponse> {
    console.log('[ApiService] replanExecution request:', request);
    return this.fetchWithKeyRotation<AutoAgentReplanResponse>(
      `${this.baseUrl}/auto-agent/replan`,
      request,
      { onKeyRotation, defaultErrorMessage: '계획 재수립 실패' }
    );
  }

  /**
   * Validate code before execution - 사전 코드 품질 검증 (Pyflakes/AST 기반)
   * Note: This is a local validation, no LLM call, but uses wrapper for consistency
   */
  async validateCode(request: AutoAgentValidateRequest): Promise<AutoAgentValidateResponse> {
    console.log('[ApiService] validateCode request:', request);
    return this.fetchWithKeyRotation<AutoAgentValidateResponse>(
      `${this.baseUrl}/auto-agent/validate`,
      request,
      { defaultErrorMessage: '코드 검증 실패' }
    );
  }

  /**
   * Reflect on step execution - 실행 결과 분석 및 적응적 조정
   */
  async reflectOnExecution(
    request: AutoAgentReflectRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<AutoAgentReflectResponse> {
    console.log('[ApiService] reflectOnExecution request:', request);
    return this.fetchWithKeyRotation<AutoAgentReflectResponse>(
      `${this.baseUrl}/auto-agent/reflect`,
      request,
      { onKeyRotation, defaultErrorMessage: 'Reflection 실패' }
    );
  }

  /**
   * Verify state after step execution - 상태 검증 (Phase 1)
   * Note: This is a local verification, no LLM call, but uses wrapper for consistency
   */
  async verifyState(request: AutoAgentVerifyStateRequest): Promise<AutoAgentVerifyStateResponse> {
    console.log('[ApiService] verifyState request:', request);
    return this.fetchWithKeyRotation<AutoAgentVerifyStateResponse>(
      `${this.baseUrl}/auto-agent/verify-state`,
      request,
      { defaultErrorMessage: '상태 검증 실패' }
    );
  }

  /**
   * Stream execution plan generation with real-time updates
   */
  async generateExecutionPlanStream(
    request: AutoAgentPlanRequest,
    onPlanUpdate: (plan: Partial<ExecutionPlan>) => void,
    onReasoning?: (reasoning: string) => void
  ): Promise<ExecutionPlan> {
    const response = await fetch(`${this.baseUrl}/auto-agent/plan/stream`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to generate plan: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finalPlan: ExecutionPlan | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.reasoning && onReasoning) {
                onReasoning(data.reasoning);
              }

              if (data.plan) {
                onPlanUpdate(data.plan);
                if (data.done) {
                  finalPlan = data.plan;
                }
              }
            } catch (e) {
              if (!(e instanceof SyntaxError)) {
                throw e;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!finalPlan) {
      throw new Error('No plan received from server');
    }

    return finalPlan;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // File Action API Methods (Python 파일 에러 수정)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Python 파일 에러 수정/분석/설명 요청
   */
  async fileAction(
    request: IFileFixRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<IFileFixResponse> {
    console.log('[ApiService] fileAction request:', request);
    return this.fetchWithKeyRotation<IFileFixResponse>(
      `${this.baseUrl}/file/action`,
      request,
      { onKeyRotation, defaultErrorMessage: '파일 액션 실패' }
    );
  }
}
