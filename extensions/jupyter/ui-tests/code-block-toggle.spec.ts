import fs from 'fs';
import path from 'path';
import { test, expect } from './fixtures';
import { formatMarkdownToHtml } from '../frontend/utils/markdownRenderer';

test.describe('Code block toggle', () => {
  test('renders expand toggle for fenced code blocks', async () => {
    const html = formatMarkdownToHtml('```python\nprint("hi")\n```');
    expect(html).toContain('code-block-toggle');
    expect(html).toContain('aria-expanded="false"');
  });

  test('preserves full code contents in HTML', async () => {
    const code = Array.from({ length: 12 }, (_, i) => `line-${i + 1}`).join('\n');
    const html = formatMarkdownToHtml(`\`\`\`python\n${code}\n\`\`\``);
    expect(html).toContain('line-12');
  });

  test('keeps horizontal scroll on expanded code blocks', async () => {
    const cssPath = path.resolve(process.cwd(), 'frontend/styles/agent-panel.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const marker = '.code-block-container.is-expanded .code-block';
    const startIndex = css.indexOf(marker);

    expect(startIndex).toBeGreaterThan(-1);

    const snippet = css.slice(startIndex, startIndex + 300);
    expect(snippet).toContain('overflow-x: auto');
  });
});

test.describe('Next items rendering', () => {
  test('renders next items JSON as material list', async () => {
    const payload = JSON.stringify({
      next_items: [
        { subject: 'Load data', description: 'Read the CSV into a dataframe.' },
        { subject: 'Train model', description: 'Fit a baseline classifier.' }
      ]
    });

    const html = formatMarkdownToHtml(payload);
    expect(html).toContain('jp-next-items-list');
    expect(html).toContain('jp-next-items-item');
    expect(html).toContain('Load data');
    expect(html).toContain('Train model');
  });

  test('renders next items from fenced json block', async () => {
    const payload = `\`\`\`json\n${JSON.stringify({
      next_items: [{ subject: 'Evaluate', description: 'Check accuracy metrics.' }]
    })}\n\`\`\``;

    const html = formatMarkdownToHtml(payload);
    expect(html).toContain('jp-next-items-list');
    expect(html).toContain('Evaluate');
  });

  test('renders next items embedded in text', async () => {
    const payload = `Next steps:\n\njson\n${JSON.stringify({
      next_items: [{ subject: 'Scale features', description: 'Normalize numeric columns.' }]
    }, null, 2)}`;

    const html = formatMarkdownToHtml(payload);
    expect(html).toContain('Next steps');
    expect(html).toContain('jp-next-items-list');
    expect(html).toContain('Scale features');
  });
});
