/**
 * Task Service - Handles notebook generation tasks and progress tracking
 */

import {
  INotebookGenerationRequest,
  INotebookGenerationResponse,
  ITaskStatus
} from '../types';

export class TaskService {
  private baseUrl: string;
  private eventSources: Map<string, EventSource>;

  constructor(baseUrl: string = '/hdsp-agent') {
    this.baseUrl = baseUrl;
    this.eventSources = new Map();
  }

  /**
   * Get CSRF token from cookie
   */
  private getCsrfToken(): string {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; _xsrf=`);
    if (parts.length === 2) {
      return parts.pop()?.split(';').shift() || '';
    }
    return '';
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
   * Start a new notebook generation task
   */
  async generateNotebook(
    request: INotebookGenerationRequest
  ): Promise<INotebookGenerationResponse> {
    const response = await fetch(`${this.baseUrl}/notebook/generate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Failed to start notebook generation' }));
      throw new Error(error.message || 'Failed to start notebook generation');
    }

    return response.json();
  }

  /**
   * Get current task status
   */
  async getTaskStatus(taskId: string): Promise<ITaskStatus> {
    const response = await fetch(`${this.baseUrl}/task/${taskId}/status`);

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Failed to get task status' }));
      throw new Error(error.message || 'Failed to get task status');
    }

    return response.json();
  }

  /**
   * Subscribe to task progress updates via Server-Sent Events
   */
  subscribeToTaskProgress(
    taskId: string,
    onProgress: (status: ITaskStatus) => void,
    onError?: (error: Error) => void,
    onComplete?: () => void
  ): () => void {
    // Close existing connection if any
    this.unsubscribeFromTask(taskId);

    const eventSource = new EventSource(
      `${this.baseUrl}/task/${taskId}/stream`
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ITaskStatus;
        onProgress(data);

        // Close connection if task is done
        if (['completed', 'failed', 'cancelled'].includes(data.status)) {
          this.unsubscribeFromTask(taskId);
          if (onComplete) {
            onComplete();
          }
        }
      } catch (error) {
        console.error('Failed to parse SSE message:', error);
        if (onError) {
          onError(error as Error);
        }
      }
    };

    eventSource.onerror = (event) => {
      console.error('SSE connection error:', event);
      this.unsubscribeFromTask(taskId);
      if (onError) {
        onError(new Error('Connection to server lost'));
      }
    };

    this.eventSources.set(taskId, eventSource);

    // Return unsubscribe function
    return () => this.unsubscribeFromTask(taskId);
  }

  /**
   * Unsubscribe from task progress updates
   */
  unsubscribeFromTask(taskId: string): void {
    const eventSource = this.eventSources.get(taskId);
    if (eventSource) {
      eventSource.close();
      this.eventSources.delete(taskId);
    }
  }

  /**
   * Cancel a running task
   */
  async cancelTask(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/task/${taskId}/cancel`, {
      method: 'POST',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Failed to cancel task' }));
      throw new Error(error.message || 'Failed to cancel task');
    }

    // Close SSE connection
    this.unsubscribeFromTask(taskId);
  }

  /**
   * Clean up all active connections
   */
  dispose(): void {
    for (const [taskId, _] of this.eventSources) {
      this.unsubscribeFromTask(taskId);
    }
  }
}
