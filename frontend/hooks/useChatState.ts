/**
 * useChatState - Centralized chat state management hook
 *
 * Consolidates common chat state patterns:
 * - messages array
 * - input value
 * - loading/streaming states
 * - error handling
 */

import { useState, useCallback } from 'react';

/**
 * Base message interface - extend for specific use cases
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/**
 * Streaming state for real-time updates
 */
export interface StreamingState {
  isStreaming: boolean;
  messageId: string | null;
}

/**
 * Chat state return type
 */
export interface ChatStateReturn<T extends ChatMessage = ChatMessage> {
  // State
  messages: T[];
  input: string;
  isLoading: boolean;
  streaming: StreamingState;
  error: string | null;
  conversationId: string;

  // Message actions
  addMessage: (message: Omit<T, 'id' | 'timestamp'> & Partial<Pick<T, 'id' | 'timestamp'>>) => string;
  updateMessage: (id: string, updates: Partial<T>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setMessages: React.Dispatch<React.SetStateAction<T[]>>;

  // Input actions
  setInput: (value: string) => void;
  clearInput: () => void;

  // Loading/streaming actions
  setIsLoading: (loading: boolean) => void;
  startStreaming: (messageId: string) => void;
  stopStreaming: () => void;

  // Error actions
  setError: (error: string | null) => void;
  clearError: () => void;

  // Conversation actions
  setConversationId: (id: string) => void;
  resetConversation: () => void;
}

/**
 * Generate unique ID for messages
 */
const generateId = (): string => {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Generate conversation ID
 */
const generateConversationId = (): string => {
  return `conv-${Date.now()}`;
};

/**
 * Custom hook for managing chat state
 *
 * @param initialMessages - Initial messages array
 * @returns Chat state and actions
 *
 * @example
 * ```tsx
 * const {
 *   messages,
 *   input,
 *   isLoading,
 *   addMessage,
 *   setInput,
 *   setIsLoading
 * } = useChatState<IChatMessage>();
 *
 * const handleSend = async () => {
 *   const userMsg = addMessage({ role: 'user', content: input });
 *   clearInput();
 *   setIsLoading(true);
 *   // ... API call
 *   setIsLoading(false);
 * };
 * ```
 */
export function useChatState<T extends ChatMessage = ChatMessage>(
  initialMessages: T[] = []
): ChatStateReturn<T> {
  // Core state
  const [messages, setMessages] = useState<T[]>(initialMessages);
  const [input, setInputState] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState>({
    isStreaming: false,
    messageId: null,
  });
  const [error, setErrorState] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(generateConversationId);

  // Message actions
  const addMessage = useCallback(
    (message: Omit<T, 'id' | 'timestamp'> & Partial<Pick<T, 'id' | 'timestamp'>>): string => {
      const id = message.id || generateId();
      const timestamp = message.timestamp || Date.now();
      const newMessage = { ...message, id, timestamp } as T;

      setMessages((prev) => [...prev, newMessage]);
      return id;
    },
    []
  );

  const updateMessage = useCallback((id: string, updates: Partial<T>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Input actions
  const setInput = useCallback((value: string) => {
    setInputState(value);
  }, []);

  const clearInput = useCallback(() => {
    setInputState('');
  }, []);

  // Streaming actions
  const startStreaming = useCallback((messageId: string) => {
    setStreaming({ isStreaming: true, messageId });
  }, []);

  const stopStreaming = useCallback(() => {
    setStreaming({ isStreaming: false, messageId: null });
  }, []);

  // Error actions
  const setError = useCallback((err: string | null) => {
    setErrorState(err);
  }, []);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  // Conversation actions
  const resetConversation = useCallback(() => {
    setMessages([]);
    setInputState('');
    setIsLoading(false);
    setStreaming({ isStreaming: false, messageId: null });
    setErrorState(null);
    setConversationId(generateConversationId());
  }, []);

  return {
    // State
    messages,
    input,
    isLoading,
    streaming,
    error,
    conversationId,

    // Message actions
    addMessage,
    updateMessage,
    removeMessage,
    clearMessages,
    setMessages,

    // Input actions
    setInput,
    clearInput,

    // Loading/streaming actions
    setIsLoading,
    startStreaming,
    stopStreaming,

    // Error actions
    setError,
    clearError,

    // Conversation actions
    setConversationId,
    resetConversation,
  };
}

export default useChatState;
