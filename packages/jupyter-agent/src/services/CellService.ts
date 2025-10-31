/**
 * Cell Service for handling cell-level operations and coordination
 */

import { ICellActionEvent, ICellResponse, AgentEvent } from '../types';
import { AgentEventEmitter } from '../utils/events';
import { ApiService } from './ApiService';

export class CellService {
  private static instance: CellService;
  private apiService: ApiService;

  private constructor() {
    this.apiService = new ApiService();
    this.setupEventListeners();
  }

  static getInstance(): CellService {
    if (!CellService.instance) {
      CellService.instance = new CellService();
    }
    return CellService.instance;
  }

  private setupEventListeners(): void {
    // Listen for cell action events
    AgentEventEmitter.on<ICellActionEvent>(
      AgentEvent.CELL_ACTION,
      this.handleCellAction.bind(this)
    );
  }

  private async handleCellAction(event: ICellActionEvent): Promise<void> {
    const { type, cellId, cellContent, customPrompt, context } = event;

    console.log(`[CellService] Handling ${type} action for cell ${cellId}`);

    // Show loading state
    this.emitLoadingState(cellId, true);

    try {
      // Call API
      const response = await this.apiService.cellAction({
        action: type,
        cellId,
        cellContent,
        customPrompt,
        context
      });

      // Emit response for side panel
      this.emitCellResponse(response);

    } catch (error) {
      console.error('[CellService] Cell action failed:', error);
      this.emitError(cellId, error as Error);
    } finally {
      this.emitLoadingState(cellId, false);
    }
  }

  private emitLoadingState(cellId: string, isLoading: boolean): void {
    // Emit loading state change
    const event = new CustomEvent('jupyter-agent:loading', {
      detail: { cellId, isLoading }
    });
    document.dispatchEvent(event);
  }

  private emitCellResponse(response: ICellResponse): void {
    AgentEventEmitter.emit(AgentEvent.MESSAGE_RECEIVED, response);
  }

  private emitError(cellId: string, error: Error): void {
    const event = new CustomEvent('jupyter-agent:error', {
      detail: { cellId, error: error.message }
    });
    document.dispatchEvent(event);
  }

  /**
   * Manually trigger cell action (for programmatic use)
   */
  triggerCellAction(event: ICellActionEvent): void {
    AgentEventEmitter.emit(AgentEvent.CELL_ACTION, event);
  }
}
