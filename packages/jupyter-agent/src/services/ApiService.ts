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

  constructor(baseUrl: string = '/api/jupyter-agent') {
    this.baseUrl = baseUrl;
  }

  /**
   * Execute cell action (explain, fix, custom)
   */
  async cellAction(request: ICellActionRequest): Promise<ICellResponse> {
    const response = await fetch(`${this.baseUrl}/cell/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to send message' }));
      throw new Error(error.message || 'Failed to send message');
    }

    return response.json();
  }

  /**
   * Save configuration
   */
  async saveConfig(config: IAgentConfig): Promise<void> {
    const response = await fetch(`${this.baseUrl}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
