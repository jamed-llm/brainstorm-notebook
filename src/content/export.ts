import { MindNoteGraph, GraphNode } from '../shared/types';
import { NODE_WIDTH, NODE_HEIGHT } from './graph-layout';
import { ConversationTurn } from './observer';

// ── Constants (mirrored from graph-canvas.ts) ─────────────────────────

const COLORS = {
  nodeFill: '#ffffff',
  nodeStroke: '#d1d5db',
  nodeText: '#1f2937',
  edgeStrong: '#6b7280',
  edgeMiddle: '#9ca3af',
  edgeThin: '#d1d5db',
  background: '#f9fafb',
};

const EDGE_WIDTHS: Record<string, number> = {
  strong: 3,
  middle: 2,
  thin: 1,
};

// ── Helpers ────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Approximate word-wrap for SVG <text> — ~6px per char at 11px system font. */
function svgWrapText(text: string, maxWidth: number): string[] {
  const charWidth = 6;
  const maxChars = Math.floor(maxWidth / charWidth);
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (test.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  if (lines.length > 3) {
    lines.length = 3;
    lines[2] = lines[2].slice(0, -1) + '\u2026';
  }

  return lines;
}

// ── Markdown Export ────────────────────────────────────────────────────

export function exportAsMarkdown(turns: ConversationTurn[], conversationId: string): void {
  const parts: string[] = [`# Conversation Export\n`];

  for (let i = 0; i < turns.length; i++) {
    parts.push(`## Turn ${i + 1}\n`);
    parts.push(`**Human:**\n${turns[i].human}\n`);
    parts.push(`**Assistant:**\n${turns[i].assistant}\n`);
    parts.push(`---\n`);
  }

  triggerDownload(parts.join('\n'), `brainstorm-${conversationId}.md`, 'text/markdown');
}

// ── JSON Export ────────────────────────────────────────────────────────

export function exportAsJson(turns: ConversationTurn[], conversationId: string): void {
  const data = {
    conversationId,
    exportedAt: new Date().toISOString(),
    turns: turns.map((t, i) => ({ index: i, human: t.human, assistant: t.assistant })),
  };

  triggerDownload(JSON.stringify(data, null, 2), `brainstorm-${conversationId}.json`, 'application/json');
}

// ── HTML Export ────────────────────────────────────────────────────────

function generateSvg(graph: MindNoteGraph): string {
  if (graph.nodes.length === 0) return '';

  const padding = 20;
  const minX = Math.min(...graph.nodes.map((n) => n.x));
  const maxX = Math.max(...graph.nodes.map((n) => n.x + NODE_WIDTH));
  const minY = Math.min(...graph.nodes.map((n) => n.y));
  const maxY = Math.max(...graph.nodes.map((n) => n.y + NODE_HEIGHT));

  const vbX = minX - padding;
  const vbY = minY - padding;
  const vbW = Math.max(maxX - minX + padding * 2, 400);
  const vbH = maxY - minY + padding * 2;

  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  // Build edges
  const edgePaths: string[] = [];
  for (const edge of graph.edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const x1 = source.x + NODE_WIDTH / 2;
    const y1 = source.y + NODE_HEIGHT;
    const x2 = target.x + NODE_WIDTH / 2;
    const y2 = target.y;
    const dy = Math.abs(y2 - y1);
    const cpOffset = Math.max(20, dy * 0.4);

    const color = COLORS[`edge${edge.strength.charAt(0).toUpperCase() + edge.strength.slice(1)}` as keyof typeof COLORS] || COLORS.edgeThin;
    const width = EDGE_WIDTHS[edge.strength] || 1;

    edgePaths.push(
      `<path d="M ${x1},${y1} C ${x1},${y1 + cpOffset} ${x2},${y2 - cpOffset} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="${width}"/>`
    );
  }

  // Build nodes
  const nodeElements: string[] = [];
  for (const node of graph.nodes) {
    const textPadding = 12;
    const maxTextWidth = NODE_WIDTH - textPadding * 2;
    const lines = svgWrapText(node.title, maxTextWidth);
    const lineHeight = 14;
    const totalHeight = lines.length * lineHeight;
    const startY = node.y + (NODE_HEIGHT - totalHeight) / 2 + lineHeight / 2;

    const tspans = lines
      .map((line, li) =>
        `<tspan x="${node.x + NODE_WIDTH / 2}" y="${startY + li * lineHeight}">${escapeHtml(line)}</tspan>`
      )
      .join('');

    nodeElements.push(`
      <a href="#turn-${node.messageIndex}" class="graph-node">
        <rect x="${node.x}" y="${node.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8"
              fill="${COLORS.nodeFill}" stroke="${COLORS.nodeStroke}" stroke-width="1"/>
        <text fill="${COLORS.nodeText}" font-size="11" font-family="-apple-system, BlinkMacSystemFont, sans-serif"
              text-anchor="middle" dominant-baseline="central">
          ${tspans}
        </text>
      </a>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" style="max-height:50vh; background:${COLORS.background}; border-bottom:1px solid #e5e7eb;">
    <style>
      .graph-node rect { cursor: pointer; transition: stroke 0.15s; }
      .graph-node:hover rect { stroke: #3b82f6; stroke-width: 2; }
      .graph-node:hover text { fill: #2563eb; }
    </style>
    ${edgePaths.join('\n    ')}
    ${nodeElements.join('\n    ')}
  </svg>`;
}

function generateConversationHtml(graph: MindNoteGraph, turns: ConversationTurn[]): string {
  const nodeByIndex = new Map<number, GraphNode>();
  for (const node of graph.nodes) {
    nodeByIndex.set(node.messageIndex, node);
  }

  const sections: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const node = nodeByIndex.get(i);
    const title = node ? escapeHtml(node.title) : `Turn ${i + 1}`;
    const summary = node ? `<p class="turn-summary">${escapeHtml(node.summary)}</p>` : '';

    sections.push(`
      <div id="turn-${i}" class="turn">
        <div class="turn-header">${title}</div>
        ${summary}
        <div class="message human">
          <div class="message-role">Human</div>
          <div class="message-text">${escapeHtml(turns[i].human)}</div>
        </div>
        <div class="message assistant">
          <div class="message-role">Assistant</div>
          <div class="message-text">${escapeHtml(turns[i].assistant)}</div>
        </div>
      </div>`);
  }

  return sections.join('\n');
}

export function exportAsHtml(graph: MindNoteGraph, turns: ConversationTurn[], conversationId: string): void {
  const svg = generateSvg(graph);
  const conversation = generateConversationHtml(graph, turns);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brainstorm Notebook Export</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      color: #1f2937;
      line-height: 1.6;
    }
    .graph-section {
      position: sticky;
      top: 0;
      z-index: 10;
      background: ${COLORS.background};
      border-bottom: 2px solid #e5e7eb;
    }
    .conversation-section {
      max-width: 800px;
      margin: 0 auto;
      padding: 24px 20px;
    }
    .turn {
      margin-bottom: 24px;
      padding: 16px 20px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      background: #ffffff;
      scroll-margin-top: 55vh;
    }
    .turn:target {
      background: #eff6ff;
      border-color: #3b82f6;
      border-left: 3px solid #3b82f6;
    }
    .turn-header {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .turn-summary {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 12px;
      font-style: italic;
    }
    .message {
      margin-top: 12px;
    }
    .message-role {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .human .message-role { color: #2563eb; }
    .assistant .message-role { color: #16a34a; }
    .message-text {
      font-size: 14px;
      white-space: pre-wrap;
      word-break: break-word;
      color: #374151;
      padding: 8px 12px;
      border-radius: 6px;
      max-height: 400px;
      overflow-y: auto;
    }
    .human .message-text { background: #f0f4ff; }
    .assistant .message-text { background: #f0fdf4; }
  </style>
</head>
<body>
  <div class="graph-section">
    ${svg}
  </div>
  <div class="conversation-section">
    ${conversation}
  </div>
</body>
</html>`;

  triggerDownload(html, `brainstorm-${conversationId}.html`, 'text/html');
}
