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
