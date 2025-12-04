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
  IModelInfo
} from '../types';

export class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = '/user/453467/pl2wadmprj/hdsp-agent') {
    this.baseUrl = baseUrl;
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

  /**
   * Execute cell action (explain, fix, custom)
   */
  async cellAction(request: ICellActionRequest): Promise<ICellResponse> {
    const response = await fetch(`${this.baseUrl}/cell/action`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // ✅ 핵심 수정: 쿠키를 같이 보냄
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'API request failed' }));
      throw new Error(error.message || 'API request failed');
    }

    return response.json();
  }

  /**
   * Send chat message
   */
  async sendMessage(request: IChatRequest): Promise<IChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/message`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // ✅ 핵심 수정: 쿠키를 같이 보냄
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `Failed to send message (${response.status})`,
        error: `HTTP ${response.status}: ${response.statusText}`
      }));
      console.error('Chat API error:', error);
      console.error('Response status:', response.status);
      console.error('Request:', request);
      throw new Error(error.message || error.error || `Failed to send message (${response.status})`);
    }

    return response.json();
  }

  /**
   * Send chat message with streaming response
   */
  async sendMessageStream(
    request: IChatRequest,
    onChunk: (chunk: string) => void,
    onMetadata?: (metadata: { conversationId?: string; messageId?: string; provider?: string; model?: string }) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/chat/stream`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // ✅ 핵심 수정: 쿠키를 같이 보냄
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
}
