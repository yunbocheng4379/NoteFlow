/**
 * NoteFlow Mini Program - Markdown Parser
 *
 * Converts Markdown text into a WXML-compatible node tree for rendering.
 * This is a lightweight parser for MVP; production can use towxml.
 *
 * Supported syntax:
 *   - Headings (h1-h4)
 *   - Bold/italic
 *   - Inline code and code blocks
 *   - Unordered lists
 *   - Blockquotes
 *   - Images (with proxy)
 *   - Links
 *   - Horizontal rules
 *   - Paragraphs
 */

const ENV = require('../.env.js');

/**
 * Parse markdown string into node tree
 * @param {string} markdown - Raw markdown text
 * @param {Object} options
 * @param {boolean} options.proxyImages - Whether to proxy images through backend
 * @returns {Array<Object>} Array of node objects
 */
function parse(markdown, options = {}) {
  const { proxyImages = true } = options;

  if (!markdown || typeof markdown !== 'string') {
    return [{ type: 'text', content: '' }];
  }

  const lines = markdown.split('\n');
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block (fenced)
    if (/^```/.test(line)) {
      const { code, endIndex } = _parseCodeBlock(lines, i);
      nodes.push({ type: 'code', language: code.language, content: code.content });
      i = endIndex;
      continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      nodes.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      nodes.push({ type: `h${level}`, content: _parseInline(headingMatch[2], proxyImages) });
      i++;
      continue;
    }

    // Unordered list
    const listMatch = line.match(/^[\-\*\+]\s+(.+)/);
    if (listMatch) {
      const items = [];
      while (i < lines.length && /^[\-\*\+]\s+(.+)/.test(lines[i])) {
        items.push(_parseInline(lines[i].replace(/^[\-\*\+]\s+/, ''), proxyImages));
        i++;
      }
      nodes.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+(.+)/.test(lines[i])) {
        items.push(_parseInline(lines[i].replace(/^\d+\.\s+/, ''), proxyImages));
        i++;
      }
      nodes.push({ type: 'ol', items });
      continue;
    }

    // Blockquote
    if (/^>\s/.test(line)) {
      const quotedLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quotedLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      nodes.push({ type: 'blockquote', content: quotedLines.join('\n') });
      continue;
    }

    // Image (standalone)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const alt = imgMatch[1];
      let src = imgMatch[2];
      if (proxyImages && !src.startsWith('data:') && !src.includes('/api/image_proxy')) {
        src = `${ENV.API_BASE}${ENV.IMAGE_PROXY_PATH}?url=${encodeURIComponent(src)}`;
      }
      nodes.push({ type: 'image', src, alt });
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      nodes.push({ type: 'spacer' });
      i++;
      continue;
    }

    // Paragraph (default)
    nodes.push({ type: 'p', content: _parseInline(line, proxyImages) });
    i++;
  }

  return nodes;
}

/**
 * Parse fenced code block
 */
function _parseCodeBlock(lines, startIndex) {
  const fence = lines[startIndex];
  const language = fence.replace(/^```/, '').trim() || '';
  const codeLines = [];

  let i = startIndex + 1;
  while (i < lines.length && !/^```/.test(lines[i])) {
    codeLines.push(lines[i]);
    i++;
  }

  const endIndex = i + 1; // skip closing fence
  return {
    code: { language, content: codeLines.join('\n') },
    endIndex,
  };
}

/**
 * Parse inline formatting (bold, italic, code, links, images)
 */
function _parseInline(text, proxyImages) {
  if (!text) return [{ type: 'text', content: '' }];

  // Regex to match inline elements
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|\[([^\]]+)\]\(([^)]+)\)|!\[([^\]]*)\]\(([^)]+)\))/g;

  const tokens = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      if (before) tokens.push({ type: 'text', content: before });
    }

    const full = match[0];

    // Inline code
    if (full.startsWith('`') && full.endsWith('`')) {
      tokens.push({ type: 'inline_code', content: full.slice(1, -1) });
    }
    // Bold
    else if (full.startsWith('**') && full.endsWith('**')) {
      tokens.push({ type: 'bold', content: full.slice(2, -2) });
    }
    else if (full.startsWith('__') && full.endsWith('__')) {
      tokens.push({ type: 'bold', content: full.slice(2, -2) });
    }
    // Italic
    else if (full.startsWith('*') && full.endsWith('*')) {
      tokens.push({ type: 'italic', content: full.slice(1, -1) });
    }
    else if (full.startsWith('_') && full.endsWith('_')) {
      tokens.push({ type: 'italic', content: full.slice(1, -1) });
    }
    // Link
    else if (full.startsWith('[')) {
      tokens.push({ type: 'link', content: match[1], url: match[2] });
    }
    // Inline image
    else if (full.startsWith('![')) {
      let src = match[4];
      if (proxyImages && !src.startsWith('data:') && !src.includes('/api/image_proxy')) {
        src = `${ENV.API_BASE}${ENV.IMAGE_PROXY_PATH}?url=${encodeURIComponent(src)}`;
      }
      tokens.push({ type: 'image', src, alt: match[3] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', content: text }];
}

/**
 * Convert node tree to plain text (for search/preview)
 */
function toPlainText(nodes) {
  if (!nodes || !Array.isArray(nodes)) return '';

  return nodes
    .map((node) => {
      if (node.type === 'text') return node.content;
      if (node.content) {
        if (Array.isArray(node.content)) {
          return node.content.map((c) => c.content || '').join('');
        }
        return node.content;
      }
      if (node.items) {
        return node.items
          .map((item) => {
            if (Array.isArray(item)) return item.map((c) => c.content || '').join('');
            return item.content || '';
          })
          .join(' ');
      }
      return '';
    })
    .join(' ');
}

/**
 * Calculate estimated reading time in minutes
 */
function readingTime(markdown) {
  if (!markdown) return 0;
  const words = markdown.replace(/[#*`\[\]()!\-_]/g, '').split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

module.exports = { parse, toPlainText, readingTime };
