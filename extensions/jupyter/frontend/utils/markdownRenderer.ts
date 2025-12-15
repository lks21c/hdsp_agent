/**
 * Markdown to HTML converter with syntax highlighting
 * Based on chrome_agent's formatMarkdownToHtml implementation
 */

/**
 * Simple hash function for generating stable IDs from content
 * Uses djb2 algorithm for fast string hashing
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(36);
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Normalize indentation in code blocks
 */
export function normalizeIndentation(code: string): string {
  const lines = code.split('\n');

  // Find minimum indent from non-empty lines
  let minIndent = Infinity;
  const nonEmptyLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length > 0) {
      const match = line.match(/^(\s*)/);
      const indent = match ? match[1].length : 0;
      minIndent = Math.min(minIndent, indent);
      nonEmptyLines.push(i);
    }
  }

  // If no indent or no non-empty lines, return original
  if (minIndent === Infinity || minIndent === 0) {
    return code;
  }

  // Remove minimum indent from all lines
  const normalized = lines.map(line => {
    if (line.trim().length === 0) {
      return '';
    }
    return line.substring(minIndent);
  });

  return normalized.join('\n');
}

/**
 * Highlight Python code with inline styles
 */
export function highlightPython(code: string): string {
  let highlighted = code;

  // Color styles (matching chrome_agent)
  const styles = {
    COMMENT: 'color: #6a9955; font-style: italic;',
    STRING: 'color: #ce9178;',
    NUMBER: 'color: #b5cea8;',
    KEYWORD: 'color: #c586c0; font-weight: bold;',
    BUILTIN: 'color: #dcdcaa;',
    FUNCTION: 'color: #4fc1ff; font-weight: bold;',
    OPERATOR: 'color: #d4d4d4;',
    BRACKET: 'color: #d4d4d4;'
  };

  // Use placeholders to preserve order
  const placeholders: Array<{ id: string; html: string }> = [];
  let placeholderIndex = 0;

  // Comments (process first)
  highlighted = highlighted.replace(/(#.*$)/gm, (match) => {
    const id = `__PH${placeholderIndex++}__`;
    placeholders.push({
      id,
      html: `<span style="${styles.COMMENT}">${escapeHtml(match)}</span>`
    });
    return id;
  });

  // Triple-quoted strings
  highlighted = highlighted.replace(/(['"]{3})([\s\S]*?)(\1)/g, (match) => {
    const id = `__PH${placeholderIndex++}__`;
    placeholders.push({
      id,
      html: `<span style="${styles.STRING}">${escapeHtml(match)}</span>`
    });
    return id;
  });

  // Regular strings
  highlighted = highlighted.replace(/(['"])([^'"]*?)(\1)/g, (match) => {
    const id = `__PH${placeholderIndex++}__`;
    placeholders.push({
      id,
      html: `<span style="${styles.STRING}">${escapeHtml(match)}</span>`
    });
    return id;
  });

  // Numbers
  highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, (match) => {
    const id = `__PH${placeholderIndex++}__`;
    placeholders.push({
      id,
      html: `<span style="${styles.NUMBER}">${match}</span>`
    });
    return id;
  });

  // Python keywords
  const keywords = [
    'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import',
    'from', 'as', 'try', 'except', 'finally', 'with', 'lambda', 'yield',
    'async', 'await', 'pass', 'break', 'continue', 'raise', 'assert', 'del',
    'global', 'nonlocal', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is'
  ];

  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'g');
    highlighted = highlighted.replace(regex, (match) => {
      const id = `__PH${placeholderIndex++}__`;
      placeholders.push({
        id,
        html: `<span style="${styles.KEYWORD}">${match}</span>`
      });
      return id;
    });
  });

  // Built-in functions
  const builtins = [
    'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'tuple',
    'set', 'bool', 'type', 'isinstance', 'issubclass', 'hasattr', 'getattr',
    'setattr', 'delattr', 'dir', 'vars', 'locals', 'globals', 'input', 'open',
    'file', 'abs', 'all', 'any', 'bin', 'chr', 'ord', 'hex', 'oct', 'pow',
    'round', 'sum', 'min', 'max', 'sorted', 'reversed', 'enumerate', 'zip',
    'map', 'filter', 'reduce'
  ];

  builtins.forEach(builtin => {
    const regex = new RegExp(`\\b${builtin}\\b`, 'g');
    highlighted = highlighted.replace(regex, (match) => {
      const id = `__PH${placeholderIndex++}__`;
      placeholders.push({
        id,
        html: `<span style="${styles.BUILTIN}">${match}</span>`
      });
      return id;
    });
  });

  // Function definitions - def keyword followed by function name
  highlighted = highlighted.replace(/(__PH\d+__\s+)([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, defPart, funcName) => {
    const defPlaceholder = placeholders.find(p => p.id === defPart.trim());
    if (defPlaceholder && defPlaceholder.html.includes('def')) {
      const id = `__PH${placeholderIndex++}__`;
      placeholders.push({
        id,
        html: `<span style="${styles.FUNCTION}">${funcName}</span>`
      });
      return defPart + id;
    }
    return match;
  });

  // Process remaining text - escape HTML and handle operators/brackets
  highlighted = highlighted.split(/(__PH\d+__)/g).map(part => {
    if (part.match(/^__PH\d+__$/)) {
      return part; // Keep placeholder as is
    }

    // Escape HTML
    part = escapeHtml(part);

    // Operators
    part = part.replace(/([+\-*/%=<>!&|^~]+)/g, `<span style="${styles.OPERATOR}">$1</span>`);

    // Brackets and delimiters
    part = part.replace(/([()[\]{}])/g, `<span style="${styles.BRACKET}">$1</span>`);

    return part;
  }).join('');

  // Replace placeholders with actual HTML
  placeholders.forEach(ph => {
    highlighted = highlighted.replace(ph.id, ph.html);
  });

  return highlighted;
}

/**
 * Highlight JavaScript code
 */
export function highlightJavaScript(code: string): string {
  const escaped = escapeHtml(code);
  const lines = escaped.split('\n');
  const keywords = [
    'function', 'const', 'let', 'var', 'if', 'else', 'for', 'while',
    'return', 'class', 'import', 'export', 'from', 'async', 'await',
    'new', 'this', 'null', 'undefined', 'true', 'false', 'typeof'
  ];

  let inMultilineComment = false;
  const highlightedLines = lines.map(line => {
    // Check for multiline comment continuation
    if (inMultilineComment) {
      const endIndex = line.indexOf('*/');
      if (endIndex !== -1) {
        inMultilineComment = false;
        return `<span style="color: #6a9955; font-style: italic;">${line.substring(0, endIndex + 2)}</span>` +
               highlightJSTokens(line.substring(endIndex + 2), keywords);
      }
      return `<span style="color: #6a9955; font-style: italic;">${line}</span>`;
    }

    // Single-line comment
    const commentMatch = line.match(/^(\s*)(\/\/.*)$/);
    if (commentMatch) {
      return commentMatch[1] + `<span style="color: #6a9955; font-style: italic;">${commentMatch[2]}</span>`;
    }

    // Multiline comment start
    const multiCommentStart = line.indexOf('/*');
    if (multiCommentStart !== -1) {
      const multiCommentEnd = line.indexOf('*/', multiCommentStart);
      if (multiCommentEnd !== -1) {
        return highlightJSTokens(line.substring(0, multiCommentStart), keywords) +
               `<span style="color: #6a9955; font-style: italic;">${line.substring(multiCommentStart, multiCommentEnd + 2)}</span>` +
               highlightJSTokens(line.substring(multiCommentEnd + 2), keywords);
      } else {
        inMultilineComment = true;
        return highlightJSTokens(line.substring(0, multiCommentStart), keywords) +
               `<span style="color: #6a9955; font-style: italic;">${line.substring(multiCommentStart)}</span>`;
      }
    }

    // Comment in middle of line
    const commentIndex = line.indexOf('//');
    if (commentIndex !== -1) {
      return highlightJSTokens(line.substring(0, commentIndex), keywords) +
             `<span style="color: #6a9955; font-style: italic;">${line.substring(commentIndex)}</span>`;
    }

    return highlightJSTokens(line, keywords);
  });

  return highlightedLines.join('\n');
}

/**
 * Highlight JavaScript tokens (keywords, strings, numbers)
 */
function highlightJSTokens(line: string, keywords: string[]): string {
  const container = document.createElement('span');
  let i = 0;

  while (i < line.length) {
    // String check (template literal, double quote, single quote)
    if (line[i] === '`') {
      let j = i + 1;
      let escaped = false;
      while (j < line.length) {
        if (line[j] === '\\' && !escaped) {
          escaped = true;
          j++;
          continue;
        }
        if (line[j] === '`' && !escaped) break;
        escaped = false;
        j++;
      }
      if (j < line.length && line[j] === '`') {
        const span = document.createElement('span');
        span.style.color = '#ce9178';
        span.textContent = line.substring(i, j + 1);
        container.appendChild(span);
        i = j + 1;
        continue;
      }
    }

    if (line[i] === '"') {
      let j = i + 1;
      let escaped = false;
      while (j < line.length) {
        if (line[j] === '\\' && !escaped) {
          escaped = true;
          j++;
          continue;
        }
        if (line[j] === '"' && !escaped) break;
        escaped = false;
        j++;
      }
      if (j < line.length && line[j] === '"') {
        const span = document.createElement('span');
        span.style.color = '#ce9178';
        span.textContent = line.substring(i, j + 1);
        container.appendChild(span);
        i = j + 1;
        continue;
      }
      // Unclosed string - treat rest as string
      const span = document.createElement('span');
      span.style.color = '#ce9178';
      span.textContent = line.substring(i);
      container.appendChild(span);
      break;
    }

    if (line[i] === '\'') {
      let j = i + 1;
      let escaped = false;
      while (j < line.length) {
        if (line[j] === '\\' && !escaped) {
          escaped = true;
          j++;
          continue;
        }
        if (line[j] === '\'' && !escaped) break;
        escaped = false;
        j++;
      }
      if (j < line.length && line[j] === '\'') {
        const span = document.createElement('span');
        span.style.color = '#ce9178';
        span.textContent = line.substring(i, j + 1);
        container.appendChild(span);
        i = j + 1;
        continue;
      }
      // Unclosed string
      const span = document.createElement('span');
      span.style.color = '#ce9178';
      span.textContent = line.substring(i);
      container.appendChild(span);
      break;
    }

    // Number check
    if (/\d/.test(line[i])) {
      let j = i;
      while (j < line.length && /[\d.]/.test(line[j])) {
        j++;
      }
      const span = document.createElement('span');
      span.style.color = '#b5cea8';
      span.textContent = line.substring(i, j);
      container.appendChild(span);
      i = j;
      continue;
    }

    // Word check (keyword or identifier)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) {
        j++;
      }
      const word = line.substring(i, j);

      if (keywords.includes(word)) {
        const span = document.createElement('span');
        span.style.color = '#569cd6';
        span.style.fontWeight = '500';
        span.textContent = word;
        container.appendChild(span);
      } else {
        const textNode = document.createTextNode(word);
        container.appendChild(textNode);
      }
      i = j;
      continue;
    }

    // Regular character
    const textNode = document.createTextNode(line[i]);
    container.appendChild(textNode);
    i++;
  }

  return container.innerHTML;
}

/**
 * Format inline markdown (bold, italic, inline code) within text
 */
export function formatInlineMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Inline code first (to protect from other transformations)
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold text (**text**)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic text (*text*)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return html;
}

/**
 * Parse markdown table to HTML
 */
export function parseMarkdownTable(tableText: string): string {
  const lines = tableText.trim().split('\n');
  if (lines.length < 2) return escapeHtml(tableText);

  // Check if it's a valid table (has header separator)
  const separatorIndex = lines.findIndex(line => /^\|?\s*[-:]+[-|\s:]+\s*\|?$/.test(line));
  if (separatorIndex === -1 || separatorIndex === 0) return escapeHtml(tableText);

  const headerLines = lines.slice(0, separatorIndex);
  const separatorLine = lines[separatorIndex];
  const bodyLines = lines.slice(separatorIndex + 1);

  // Parse alignment from separator
  const alignments: string[] = [];
  const separatorCells = separatorLine.split('|').filter(cell => cell.trim());
  separatorCells.forEach(cell => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
      alignments.push('center');
    } else if (trimmed.endsWith(':')) {
      alignments.push('right');
    } else {
      alignments.push('left');
    }
  });

  // Build HTML table with wrapper for horizontal scroll
  let html = '<div class="markdown-table-wrapper"><table class="markdown-table">';

  // Header
  html += '<thead>';
  headerLines.forEach(line => {
    html += '<tr>';
    const cells = line.split('|').filter((cell, idx, arr) => {
      // Filter out empty cells from leading/trailing |
      if (idx === 0 && cell.trim() === '') return false;
      if (idx === arr.length - 1 && cell.trim() === '') return false;
      return true;
    });
    cells.forEach((cell, idx) => {
      const align = alignments[idx] || 'left';
      html += `<th style="text-align: ${align};">${formatInlineMarkdown(cell.trim())}</th>`;
    });
    html += '</tr>';
  });
  html += '</thead>';

  // Body
  if (bodyLines.length > 0) {
    html += '<tbody>';
    bodyLines.forEach(line => {
      if (!line.trim()) return;
      html += '<tr>';
      const cells = line.split('|').filter((cell, idx, arr) => {
        if (idx === 0 && cell.trim() === '') return false;
        if (idx === arr.length - 1 && cell.trim() === '') return false;
        return true;
      });
      cells.forEach((cell, idx) => {
        const align = alignments[idx] || 'left';
        html += `<td style="text-align: ${align};">${formatInlineMarkdown(cell.trim())}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
  }

  html += '</table></div>';
  return html;
}

/**
 * Format markdown text to HTML with syntax highlighting
 */
export function formatMarkdownToHtml(text: string): string {
  // Decode HTML entities if present
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  let html = textarea.value;

  // Step 0.5: Protect DataFrame HTML tables (must be before code blocks)
  const dataframeHtmlPlaceholders: Array<{ placeholder: string; html: string }> = [];
  html = html.replace(/<!--DFHTML-->([\s\S]*?)<!--\/DFHTML-->/g, (match, tableHtml) => {
    const placeholder = '__DATAFRAME_HTML_' + Math.random().toString(36).substr(2, 9) + '__';
    dataframeHtmlPlaceholders.push({
      placeholder: placeholder,
      html: tableHtml
    });
    return placeholder;
  });

  // Step 1: Protect code blocks by replacing with placeholders
  const codeBlocks: Array<{ id: string; code: string; language: string }> = [];
  const codeBlockPlaceholders: Array<{ placeholder: string; html: string }> = [];

  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
    const lang = (language || 'python').toLowerCase();
    const trimmedCode = normalizeIndentation(code.trim());
    // Use content-based hash for stable ID across re-renders
    const contentHash = simpleHash(trimmedCode + lang);
    const blockId = 'code-block-' + contentHash;
    const placeholder = '__CODE_BLOCK_' + blockId + '__';

    codeBlocks.push({
      id: blockId,
      code: trimmedCode,
      language: lang
    });

    // Create HTML for code block
    const highlightedCode = lang === 'python' || lang === 'py'
      ? highlightPython(trimmedCode)
      : lang === 'javascript' || lang === 'js'
      ? highlightJavaScript(trimmedCode)
      : escapeHtml(trimmedCode);

    const htmlBlock = '<div class="code-block-container" data-block-id="' + blockId + '">' +
      '<div class="code-block-header">' +
        '<span class="code-block-language">' + escapeHtml(lang) + '</span>' +
        '<div class="code-block-actions">' +
          '<button class="code-block-apply" data-block-id="' + blockId + '" title="셀에 적용">셀에 적용</button>' +
          '<button class="code-block-copy" data-block-id="' + blockId + '" title="복사">복사</button>' +
        '</div>' +
      '</div>' +
      '<pre class="code-block language-' + escapeHtml(lang) + '"><code id="' + blockId + '">' + highlightedCode + '</code></pre>' +
    '</div>';

    codeBlockPlaceholders.push({
      placeholder: placeholder,
      html: htmlBlock
    });

    return placeholder;
  });

  // Step 2: Protect inline code
  const inlineCodePlaceholders: Array<{ placeholder: string; html: string }> = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = '__INLINE_CODE_' + Math.random().toString(36).substr(2, 9) + '__';
    inlineCodePlaceholders.push({
      placeholder: placeholder,
      html: '<code class="inline-code">' + escapeHtml(code) + '</code>'
    });
    return placeholder;
  });

  // Step 3: Parse and protect markdown tables
  const tablePlaceholders: Array<{ placeholder: string; html: string }> = [];

  // Improved table detection: look for lines with | separators and a separator row
  // Match pattern: header row(s), separator row (with ---), body rows
  // More flexible regex to handle various table formats
  const tableRegex = /(?:^|\n)((?:\|[^\n]+\|\n?)+\|[-:| ]+\|(?:\n\|[^\n]+\|)*)/gm;
  html = html.replace(tableRegex, (match, tableBlock) => {
    const placeholder = '__TABLE_' + Math.random().toString(36).substr(2, 9) + '__';
    const tableHtml = parseMarkdownTable(tableBlock.trim());
    tablePlaceholders.push({
      placeholder: placeholder,
      html: tableHtml
    });
    return '\n' + placeholder + '\n';
  });

  // Alternative: tables without leading/trailing | (GFM style)
  // Pattern: "header | header\n---|---\ndata | data"
  const gfmTableRegex = /(?:^|\n)((?:[^\n|]+\|[^\n]+\n)+[-:|\s]+[-|]+\n(?:[^\n|]+\|[^\n]+\n?)*)/gm;
  html = html.replace(gfmTableRegex, (match, tableBlock) => {
    // Skip if already processed (contains placeholder)
    if (tableBlock.includes('__TABLE_')) return match;
    const placeholder = '__TABLE_' + Math.random().toString(36).substr(2, 9) + '__';
    const tableHtml = parseMarkdownTable(tableBlock.trim());
    tablePlaceholders.push({
      placeholder: placeholder,
      html: tableHtml
    });
    return '\n' + placeholder + '\n';
  });

  // Third pattern: catch any remaining tables with | characters and --- separator
  const fallbackTableRegex = /(?:^|\n)(\|[^\n]*\|\n\|[-:| ]*\|(?:\n\|[^\n]*\|)*)/gm;
  html = html.replace(fallbackTableRegex, (match, tableBlock) => {
    if (tableBlock.includes('__TABLE_')) return match;
    const placeholder = '__TABLE_' + Math.random().toString(36).substr(2, 9) + '__';
    const tableHtml = parseMarkdownTable(tableBlock.trim());
    tablePlaceholders.push({
      placeholder: placeholder,
      html: tableHtml
    });
    return '\n' + placeholder + '\n';
  });

  // Step 4: Escape HTML for non-placeholder text
  html = html.split(/(__(?:DATAFRAME_HTML|CODE_BLOCK|INLINE_CODE|TABLE)_[a-z0-9-]+__)/gi)
    .map((part, index) => {
      // Odd indices are placeholders - keep as is
      if (index % 2 === 1) return part;
      // Even indices are regular text - escape HTML
      return escapeHtml(part);
    })
    .join('');

  // Step 5: Convert markdown to HTML
  // Headings (process from h6 to h1 to avoid conflicts)
  html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Horizontal rule (---)
  html = html.replace(/^---+$/gim, '<hr>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Lists - process BEFORE bold/italic to handle "* item" correctly
  // Unordered lists: - or * at start of line
  html = html.replace(/^[\-\*]\s+(.*$)/gim, '<li>$1</li>');

  // Numbered lists: 1. 2. etc
  html = html.replace(/^\d+\.\s+(.*$)/gim, '<li>$1</li>');

  // Bold text (must be before italic)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic text - only match single * not at line start (to avoid conflict with lists)
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // Step 6: Restore table placeholders
  tablePlaceholders.forEach(item => {
    html = html.replace(item.placeholder, item.html);
  });

  // Step 6.5: Restore DataFrame HTML tables
  dataframeHtmlPlaceholders.forEach(item => {
    html = html.replace(item.placeholder, item.html);
  });

  // Step 7: Restore inline code placeholders
  inlineCodePlaceholders.forEach(item => {
    html = html.replace(item.placeholder, item.html);
  });

  // Step 8: Restore code block placeholders
  codeBlockPlaceholders.forEach(item => {
    html = html.replace(item.placeholder, item.html);
  });

  return html;
}

