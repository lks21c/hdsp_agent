/**
 * Event emitter utility for component communication
 */

import { AgentEvent } from '../types';

export class AgentEventEmitter {
  /**
   * Emit a custom event with typed detail
   */
  static emit<T>(event: AgentEvent, detail: T): void {
    const customEvent = new CustomEvent(event, { detail });
    document.dispatchEvent(customEvent);
  }

  /**
   * Listen to a custom event with typed handler
   * Returns cleanup function to remove listener
   */
  static on<T>(
    event: AgentEvent,
    handler: (detail: T) => void
  ): () => void {
    const listener = (e: Event) => {
      const customEvent = e as CustomEvent<T>;
      handler(customEvent.detail);
    };

    document.addEventListener(event, listener);

    // Return cleanup function
    return () => {
      document.removeEventListener(event, listener);
    };
  }

  /**
   * Listen to event once and auto-remove
   */
  static once<T>(
    event: AgentEvent,
    handler: (detail: T) => void
  ): void {
    const listener = (e: Event) => {
      const customEvent = e as CustomEvent<T>;
      handler(customEvent.detail);
      document.removeEventListener(event, listener);
    };

    document.addEventListener(event, listener);
  }
}
