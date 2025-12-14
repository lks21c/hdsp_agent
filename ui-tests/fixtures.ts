/**
 * Galata fixtures with network mocking for HDSP Agent UI tests
 *
 * Network interception ensures zero token consumption during UI tests
 */

import { test as base, expect } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

/**
 * Mock LLM responses for different endpoints
 */
const mockResponses = {
  plan: {
    status: 'streaming',
    plan: {
      goal: 'Mock Goal for Testing',
      steps: [
        {
          description: 'Step 1: Mock initialization',
          toolCalls: [
            {
              tool: 'python',
              parameters: {
                code: 'print("Hello from mock")',
              },
            },
          ],
        },
        {
          description: 'Step 2: Mock verification',
          toolCalls: [],
        },
      ],
    },
  },

  execute: {
    status: 'success',
    result: {
      output: 'Mock execution completed',
      variables: { mock_var: 42 },
    },
  },

  error: {
    status: 'error',
    error: {
      type: 'MockError',
      message: 'This is a mock error for testing',
      recovery_suggestions: ['Try again', 'Check input'],
    },
  },
};

/**
 * Setup network mocking for HDSP Agent API endpoints
 */
async function setupNetworkMocking(page: Page): Promise<void> {
  // Mock plan generation endpoint
  await page.route('**/api/hdsp/plan', async (route) => {
    const request = route.request();
    const method = request.method();

    if (method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResponses.plan),
      });
    } else {
      await route.continue();
    }
  });

  // Mock execution endpoint
  await page.route('**/api/hdsp/execute', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResponses.execute),
    });
  });

  // Mock any external LLM API calls (OpenAI, Anthropic, etc.)
  await page.route('**/api.openai.com/**', async (route) => {
    console.log('[Mock] Blocked OpenAI API call');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: 'Mock LLM response',
            },
          },
        ],
      }),
    });
  });

  await page.route('**/api.anthropic.com/**', async (route) => {
    console.log('[Mock] Blocked Anthropic API call');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: [{ text: 'Mock Claude response' }],
      }),
    });
  });
}

/**
 * Extended test fixture with network mocking
 */
export const test = base.extend<{
  mockNetwork: void;
}>({
  mockNetwork: [
    async ({ page }, use) => {
      await setupNetworkMocking(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect, mockResponses };

/**
 * Helper functions for UI tests
 */
export const helpers = {
  /**
   * Wait for HDSP sidebar to be visible
   */
  async waitForSidebar(page: Page): Promise<void> {
    await page.waitForSelector('.hdsp-sidebar', { timeout: 10000 });
  },

  /**
   * Submit a prompt to the agent
   */
  async submitPrompt(page: Page, prompt: string): Promise<void> {
    const textarea = page.locator('textarea[placeholder*="질문"]');
    await textarea.fill(prompt);
    await page.click('button:has-text("전송")');
  },

  /**
   * Wait for plan to be displayed
   */
  async waitForPlan(page: Page): Promise<void> {
    await page.waitForSelector('.plan-step', { timeout: 15000 });
  },

  /**
   * Get plan step count
   */
  async getPlanStepCount(page: Page): Promise<number> {
    const steps = page.locator('.plan-step');
    return await steps.count();
  },
};
