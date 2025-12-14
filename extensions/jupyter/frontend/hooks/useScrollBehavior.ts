/**
 * useScrollBehavior - Centralized scroll management hook
 *
 * Features:
 * - Auto-scroll on content updates
 * - User scroll detection (prevents auto-scroll when user is reading)
 * - Scroll to top/bottom utilities
 * - Near-bottom detection
 */

import { useRef, useCallback, useEffect } from 'react';

/**
 * Scroll behavior options
 */
export interface ScrollOptions {
  /** Scroll animation behavior */
  behavior?: ScrollBehavior;
  /** Auto-scroll when dependencies change */
  autoScrollOnUpdate?: boolean;
  /** Distance from bottom to consider "near bottom" (px) */
  scrollThreshold?: number;
  /** Delay before auto-scroll (ms) - useful for DOM updates */
  scrollDelay?: number;
}

/**
 * Return type for useScrollBehavior
 */
export interface ScrollBehaviorReturn<T extends HTMLElement> {
  /** Ref to attach to scrollable container */
  containerRef: React.RefObject<T>;
  /** Ref to attach to end marker element */
  endMarkerRef: React.RefObject<HTMLDivElement>;
  /** Scroll to bottom of container */
  scrollToBottom: (immediate?: boolean) => void;
  /** Scroll to top of container */
  scrollToTop: () => void;
  /** Check if scroll position is near bottom */
  isNearBottom: () => boolean;
  /** Force scroll to bottom ignoring user scroll state */
  forceScrollToBottom: () => void;
}

const DEFAULT_OPTIONS: Required<ScrollOptions> = {
  behavior: 'smooth',
  autoScrollOnUpdate: true,
  scrollThreshold: 100,
  scrollDelay: 50,
};

/**
 * Custom hook for managing scroll behavior
 *
 * @param dependencies - Array of values that trigger auto-scroll when changed
 * @param options - Scroll behavior configuration
 * @returns Scroll refs and utilities
 *
 * @example
 * ```tsx
 * const { containerRef, endMarkerRef, scrollToBottom } = useScrollBehavior<HTMLDivElement>(
 *   [messages],
 *   { autoScrollOnUpdate: true }
 * );
 *
 * return (
 *   <div ref={containerRef} className="messages-container">
 *     {messages.map(msg => <Message key={msg.id} {...msg} />)}
 *     <div ref={endMarkerRef} />
 *   </div>
 * );
 * ```
 */
export function useScrollBehavior<T extends HTMLElement = HTMLDivElement>(
  dependencies: unknown[] = [],
  options: ScrollOptions = {}
): ScrollBehaviorReturn<T> {
  const {
    behavior,
    autoScrollOnUpdate,
    scrollThreshold,
    scrollDelay,
  } = { ...DEFAULT_OPTIONS, ...options };

  const containerRef = useRef<T>(null);
  const endMarkerRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  /**
   * Check if scroll position is near the bottom
   */
  const isNearBottom = useCallback((): boolean => {
    const container = containerRef.current;
    if (!container) return true; // Default to true if no container

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < scrollThreshold;
  }, [scrollThreshold]);

  /**
   * Scroll to bottom using end marker (more reliable)
   */
  const scrollToBottom = useCallback(
    (immediate = false) => {
      // Don't auto-scroll if user is manually scrolling up
      if (isUserScrollingRef.current && !immediate) {
        return;
      }

      const scrollAction = () => {
        // Try end marker first (scrollIntoView)
        if (endMarkerRef.current) {
          endMarkerRef.current.scrollIntoView({
            behavior: immediate ? 'auto' : behavior,
            block: 'end',
          });
          return;
        }

        // Fallback to container scroll
        const container = containerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: immediate ? 'auto' : behavior,
          });
        }
      };

      // Apply delay for DOM updates to complete
      if (scrollDelay > 0 && !immediate) {
        setTimeout(scrollAction, scrollDelay);
      } else {
        scrollAction();
      }
    },
    [behavior, scrollDelay]
  );

  /**
   * Force scroll to bottom, ignoring user scroll state
   */
  const forceScrollToBottom = useCallback(() => {
    isUserScrollingRef.current = false;
    scrollToBottom(true);
  }, [scrollToBottom]);

  /**
   * Scroll to top
   */
  const scrollToTop = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTo({
        top: 0,
        behavior,
      });
    }
  }, [behavior]);

  /**
   * Track user scroll to detect manual scrolling up
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const currentScrollTop = container.scrollTop;

      // User scrolled up = manual scrolling
      if (currentScrollTop < lastScrollTopRef.current - 10) {
        isUserScrollingRef.current = true;
      }

      // User scrolled to near bottom = resume auto-scroll
      if (isNearBottom()) {
        isUserScrollingRef.current = false;
      }

      lastScrollTopRef.current = currentScrollTop;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isNearBottom]);

  /**
   * Auto-scroll when dependencies change
   */
  useEffect(() => {
    if (autoScrollOnUpdate) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, autoScrollOnUpdate]);

  return {
    containerRef,
    endMarkerRef,
    scrollToBottom,
    scrollToTop,
    isNearBottom,
    forceScrollToBottom,
  };
}

export default useScrollBehavior;
