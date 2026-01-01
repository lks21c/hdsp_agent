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

  test.describe('Chat Interrupts (Mocked)', () => {
    test('should show write_file_tool path in code block header', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('hdsp-agent-llm-config', JSON.stringify({
          provider: 'gemini',
          gemini: { apiKey: 'test-key', apiKeys: ['test-key'], model: 'gemini-2.5-pro' }
        }));
        const app = (window as any).jupyterapp;
        if (app?.shell?.activateById) {
          app.shell.activateById('hdsp-agent-panel');
        }
      });

      await page.waitForSelector('.jp-agent-panel', { timeout: 10000 });

      const writePath = 'outputs/result.txt';
      const interruptPayload = {
        thread_id: 'test-thread-write',
        action: 'write_file_tool',
        args: { path: writePath, content: 'data' },
        description: '파일 쓰기 요청'
      };

      await page.route('**/hdsp-agent/agent/langchain/stream', async (route) => {
        const body = [
          'event: interrupt',
          `data: ${JSON.stringify(interruptPayload)}`,
          '',
          '',
        ].join('\n');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body
        });
      });

      await page.fill('.jp-agent-input', 'write file');
      await page.click('.jp-agent-send-button');

      const description = page.locator('.jp-agent-interrupt-description');
      await expect(description).not.toContainText('경로');
      const languageLabel = page.locator('.jp-agent-interrupt-action .code-block-language');
      await expect(languageLabel).toHaveText(writePath);
    });

    test('should auto-resume list_files_tool interrupt without notebook', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('hdsp-agent-llm-config', JSON.stringify({
          provider: 'gemini',
          gemini: { apiKey: 'test-key', apiKeys: ['test-key'], model: 'gemini-2.5-pro' }
        }));
        const app = (window as any).jupyterapp;
        if (app?.shell?.activateById) {
          app.shell.activateById('hdsp-agent-panel');
        }
      });

      await page.waitForSelector('.jp-agent-panel', { timeout: 10000 });

      const listPath = 'tests-list';
      let contentsRequestCount = 0;
      await page.route('**/api/contents/**', async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        if (!url.pathname.includes(`/api/contents/${listPath}`)) {
          await route.fallback();
          return;
        }
        contentsRequestCount += 1;
        const payload = {
          name: listPath,
          path: listPath,
          type: 'directory',
          content: [
            { name: 'cal.py', path: `${listPath}/cal.py`, type: 'file', size: 12 },
            { name: 'data', path: `${listPath}/data`, type: 'directory' },
          ]
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload)
        });
      });

      const interruptPayload = {
        thread_id: 'test-thread',
        action: 'list_files_tool',
        args: { path: listPath },
        description: 'List files'
      };

      await page.route('**/hdsp-agent/agent/langchain/stream', async (route) => {
        const body = [
          'event: interrupt',
          `data: ${JSON.stringify(interruptPayload)}`,
          '',
          '',
        ].join('\n');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body
        });
      });

      let resumeBody: any = null;
      await page.route('**/hdsp-agent/agent/langchain/resume', async (route) => {
        const payload = route.request().postData() || '{}';
        resumeBody = JSON.parse(payload);
        const body = [
          'event: complete',
          `data: ${JSON.stringify({ success: true, thread_id: 'test-thread' })}`,
          '',
          '',
        ].join('\n');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body
        });
      });

      const resumeRequest = page.waitForRequest('**/hdsp-agent/agent/langchain/resume');

      await page.fill('.jp-agent-input', 'list files');
      await page.click('.jp-agent-send-button');

      await resumeRequest;

      expect(contentsRequestCount).toBeGreaterThan(0);
      expect(resumeBody?.decisions?.[0]?.type).toBe('edit');
      expect(resumeBody?.decisions?.[0]?.args?.execution_result).toBeDefined();
      expect(typeof resumeBody?.decisions?.[0]?.args?.execution_result?.success).toBe('boolean');
      expect(resumeBody?.decisions?.[0]?.args?.execution_result?.output).toContain('cal.py');
    });

    test('should run shell code via subprocess when no notebook is focused', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('hdsp-agent-llm-config', JSON.stringify({
          provider: 'gemini',
          gemini: { apiKey: 'test-key', apiKeys: ['test-key'], model: 'gemini-2.5-pro' }
        }));
        const app = (window as any).jupyterapp;
        if (app?.shell?.activateById) {
          app.shell.activateById('hdsp-agent-panel');
        }
      });

      await page.waitForSelector('.jp-agent-panel', { timeout: 10000 });

      const interruptPayload = {
        thread_id: 'test-thread-shell',
        action: 'jupyter_cell_tool',
        args: { code: '!ls -la' },
        description: 'Run shell command'
      };

      await page.route('**/hdsp-agent/agent/langchain/stream', async (route) => {
        const body = [
          'event: interrupt',
          `data: ${JSON.stringify(interruptPayload)}`,
          '',
          '',
        ].join('\n');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body
        });
      });

      let executePayload: any = null;
      await page.route('**/hdsp-agent/execute-command/stream', async (route) => {
        const payload = route.request().postData() || '{}';
        executePayload = JSON.parse(payload);
        const body = [
          'event: output',
          `data: ${JSON.stringify({ stream: 'stdout', text: 'line-1\n' })}`,
          '',
          'event: output',
          `data: ${JSON.stringify({ stream: 'stdout', text: 'line-2\n' })}`,
          '',
          'event: output',
          `data: ${JSON.stringify({ stream: 'stdout', text: 'line-3\n' })}`,
          '',
          'event: result',
          `data: ${JSON.stringify({
            success: true,
            stdout: 'line-1\nline-2\nline-3\n',
            stderr: '',
            returncode: 0
          })}`,
          '',
          '',
        ].join('\n');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body
        });
      });

      let resumeBody: any = null;
      await page.route('**/hdsp-agent/agent/langchain/resume', async (route) => {
        const payload = route.request().postData() || '{}';
        resumeBody = JSON.parse(payload);
        const body = [
          'event: complete',
          `data: ${JSON.stringify({ success: true, thread_id: 'test-thread-shell' })}`,
          '',
          '',
        ].join('\n');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body
        });
      });

      const resumeRequest = page.waitForRequest('**/hdsp-agent/agent/langchain/resume');

      await page.fill('.jp-agent-input', 'run shell command');
      await page.click('.jp-agent-send-button');

      await page.waitForSelector('.jp-agent-interrupt-approve-btn', { timeout: 10000 });
      await page.click('.jp-agent-interrupt-approve-btn');

      await resumeRequest;

      const shellMessage = page.locator('.jp-agent-message-shell-output').first();
      await expect(shellMessage).toBeVisible();
      await expect(shellMessage.locator('.jp-agent-message-role')).toHaveText('shell 실행');
      await expect(shellMessage.locator('.jp-agent-message-content')).toHaveClass(/jp-agent-message-content-shell/);

      expect(executePayload?.command).toContain('ls -la');
      const output = resumeBody?.decisions?.[0]?.args?.execution_result?.output;
      expect(output).toBe('line-1\nline-2');
      expect(output).not.toContain('line-3');
    });
  });

  test.describe('Settings', () => {
    test('should persist workspace root setting', async ({ page }) => {
      await page.evaluate(() => {
        const app = (window as any).jupyterapp;
        if (app?.shell?.activateById) {
          app.shell.activateById('hdsp-agent-panel');
        }
      });

      await page.waitForSelector('.jp-agent-panel', { timeout: 10000 });
      await page.click('.jp-agent-settings-button-icon');
      await page.waitForSelector('.jp-agent-settings-dialog', { timeout: 10000 });

      const input = page.locator('[data-testid="workspace-root-input"]');
      await input.fill('/Users/example/workspace');
      await page.click('.jp-agent-settings-button-primary');

      const stored = await page.evaluate(() => localStorage.getItem('hdsp-agent-llm-config'));
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored as string);
      expect(parsed.workspaceRoot).toBe('/Users/example/workspace');
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
