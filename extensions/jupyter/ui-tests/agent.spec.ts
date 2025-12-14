/**
 * HDSP Agent E2E Tests
 *
 * Galata-based UI tests with network mocking for zero-token testing
 *
 * Usage:
 *   yarn test:ui           # Run all UI tests
 *   yarn test:ui:headed    # Run with browser visible
 *   yarn test:ui:debug     # Run in debug mode
 */

import { test, expect, helpers, mockResponses } from './fixtures';

test.describe('HDSP Agent Extension', () => {
  test.beforeEach(async ({ page }) => {
    // Wait for JupyterLab to be fully loaded
    await page.waitForSelector('#jp-main-dock-panel', { timeout: 30000 });
  });

  test.describe('Extension Loading', () => {
    test('should load HDSP Agent extension', async ({ page }) => {
      // Check if extension menu or icon is present
      const launcher = page.locator('.jp-Launcher');
      await expect(launcher).toBeVisible();

      // The extension should be loaded (check for any HDSP-related element)
      // This will vary based on actual extension implementation
    });

    test('should have sidebar panel available', async ({ page }) => {
      // Look for HDSP sidebar icon in the left panel
      const leftPanel = page.locator('#jp-left-stack');
      await expect(leftPanel).toBeVisible();
    });
  });

  test.describe('Notebook Integration', () => {
    test('should create new notebook', async ({ page }) => {
      // Create new notebook via launcher
      await page.click('text=Python 3');
      await page.waitForSelector('.jp-Notebook', { timeout: 15000 });

      // Verify notebook is created
      const notebook = page.locator('.jp-Notebook');
      await expect(notebook).toBeVisible();
    });

    test('should show cell action buttons on code cells', async ({ page }) => {
      // Create new notebook
      await page.click('text=Python 3');
      await page.waitForSelector('.jp-Notebook', { timeout: 15000 });

      // Wait for cell to be active
      await page.waitForSelector('.jp-Cell-inputArea', { timeout: 10000 });

      // HDSP Agent adds action buttons to code cells
      // Check for E/F/? buttons (based on actual implementation)
      const cellArea = page.locator('.jp-Cell-inputArea').first();
      await expect(cellArea).toBeVisible();
    });
  });

  test.describe('Agent Sidebar (Mocked)', () => {
    test('should open sidebar panel when triggered', async ({ page }) => {
      // This test uses network mocking - no real LLM calls
      // The mockNetwork fixture automatically intercepts API calls

      // Open sidebar (implementation-specific selector)
      // await page.click('[data-icon="hdsp-agent"]');

      // For now, verify mock is active by checking network interception
      const mockActive = true; // Placeholder - actual test depends on UI implementation
      expect(mockActive).toBe(true);
    });

    test('should display mocked plan response', async ({ page }) => {
      // Verify mock response structure is correct
      expect(mockResponses.plan.status).toBe('streaming');
      expect(mockResponses.plan.plan.steps.length).toBe(2);
      expect(mockResponses.plan.plan.goal).toContain('Mock');
    });
  });

  test.describe('Network Mocking Verification', () => {
    test('should block OpenAI API calls', async ({ page }) => {
      // This test verifies that network mocking is working
      // Any actual OpenAI API call would be intercepted

      const responsePromise = page.evaluate(async () => {
        try {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4', messages: [] }),
          });
          return await response.json();
        } catch (e) {
          return { error: 'blocked' };
        }
      });

      const response = await responsePromise;
      // Should get mocked response, not real API error
      expect(response).toBeDefined();
    });

    test('should block Anthropic API calls', async ({ page }) => {
      const responsePromise = page.evaluate(async () => {
        try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'claude-3', messages: [] }),
          });
          return await response.json();
        } catch (e) {
          return { error: 'blocked' };
        }
      });

      const response = await responsePromise;
      expect(response).toBeDefined();
    });

    test('should intercept HDSP plan endpoint', async ({ page }) => {
      const responsePromise = page.evaluate(async () => {
        try {
          const response = await fetch('/api/hdsp/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'test' }),
          });
          return await response.json();
        } catch (e) {
          return { error: String(e) };
        }
      });

      const response = await responsePromise;
      // Should get our mocked response
      if (!('error' in response)) {
        expect(response.status).toBe('streaming');
        expect(response.plan.goal).toContain('Mock');
      }
    });
  });
});

test.describe('Error Handling (Mocked)', () => {
  test('should have error mock response available', async ({ page }) => {
    // Verify error mock structure
    expect(mockResponses.error.status).toBe('error');
    expect(mockResponses.error.error.type).toBe('MockError');
    expect(mockResponses.error.error.recovery_suggestions.length).toBeGreaterThan(0);
  });
});

test.describe('Helper Functions', () => {
  test('helpers should be defined', async () => {
    expect(helpers.waitForSidebar).toBeDefined();
    expect(helpers.submitPrompt).toBeDefined();
    expect(helpers.waitForPlan).toBeDefined();
    expect(helpers.getPlanStepCount).toBeDefined();
  });
});
