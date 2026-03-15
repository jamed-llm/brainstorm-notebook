import { MindNoteGraph, GraphNode, GraphEdge } from '../shared/types';
import { layoutGraph, getCanvasHeight } from './graph-layout';
import { renderGraph, hitTestNode, createRenderState, RenderState } from './graph-canvas';
import { findAncestors, findDirectParents } from './graph-interaction';
import { saveGraph, loadGraph } from '../shared/storage';
import { getConversationId, startObserver, ConversationTurn } from './observer';
import { ExtensionMessage, AnalyzeTurnPayload } from '../shared/messages';
import panelCss from './panel.css?inline';

let panelHost: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let statusEl: HTMLDivElement | null = null;
let currentGraph: MindNoteGraph | null = null;
let renderState: RenderState = createRenderState();
let panelWidth = 400;
let cleanupObserver: (() => void) | null = null;

export function togglePanel(): void {
  if (panelHost) {
    destroyPanel();
  } else {
    createPanel();
  }
}

function createPanel(): void {
  panelHost = document.createElement('div');
  panelHost.id = 'brainstorm-notebook-host';
  panelHost.style.cssText = `
    position: fixed; top: 0; right: 0; height: 100vh;
    width: ${panelWidth}px; z-index: 999999;
  `;
  document.body.appendChild(panelHost);

  shadow = panelHost.attachShadow({ mode: 'closed' });

  // Inject styles
  const style = document.createElement('style');
  style.textContent = panelCss;
  shadow.appendChild(style);

  // Build panel DOM
  const panel = document.createElement('div');
  panel.className = 'bn-panel';

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'bn-resize-handle';
  setupResize(resizeHandle);

  // Header
  const header = document.createElement('div');
  header.className = 'bn-header';
  header.innerHTML = `
    <span>Brainstorm Notebook</span>
    <div class="bn-header-actions">
      <button class="bn-btn" id="bn-reformat">Reformat</button>
      <button class="bn-btn" id="bn-close">Close</button>
    </div>
  `;

  // Canvas
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'bn-canvas-wrap';
  canvas = document.createElement('canvas');
  canvasWrap.appendChild(canvas);

  // Status bar
  statusEl = document.createElement('div');
  statusEl.className = 'bn-status';
  statusEl.textContent = 'Ready';

  panel.appendChild(resizeHandle);
  panel.appendChild(header);
  panel.appendChild(canvasWrap);
  panel.appendChild(statusEl);
  shadow.appendChild(panel);

  // Event listeners
  const reformatBtn = shadow.getElementById('bn-reformat');
  reformatBtn?.addEventListener('click', reformat);

  const closeBtn = shadow.getElementById('bn-close');
  closeBtn?.addEventListener('click', destroyPanel);

  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mouseleave', onCanvasMouseLeave);

  // Push claude.ai content left
  adjustClaudeLayout(true);

  // Load existing graph or create new
  initGraph();

  // Start observing conversation
  cleanupObserver = startObserver(onResponseComplete);
}

function destroyPanel(): void {
  if (cleanupObserver) {
    cleanupObserver();
    cleanupObserver = null;
  }
  if (panelHost) {
    panelHost.remove();
    panelHost = null;
    shadow = null;
    canvas = null;
    ctx = null;
  }
  adjustClaudeLayout(false);
}

function adjustClaudeLayout(panelOpen: boolean): void {
  const main = document.querySelector('main') ?? document.body;
  if (panelOpen) {
    (main as HTMLElement).style.marginRight = `${panelWidth}px`;
  } else {
    (main as HTMLElement).style.marginRight = '';
  }
}

function setupResize(handle: HTMLDivElement): void {
  let startX = 0;
  let startWidth = 0;

  function onMouseMove(e: MouseEvent) {
    const delta = startX - e.clientX;
    panelWidth = Math.max(250, Math.min(800, startWidth + delta));
    if (panelHost) panelHost.style.width = `${panelWidth}px`;
    adjustClaudeLayout(true);
    redraw();
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  handle.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startWidth = panelWidth;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

async function initGraph(): Promise<void> {
  const convId = getConversationId();
  if (!convId) {
    setStatus('Navigate to a conversation to start');
    return;
  }

  const existing = await loadGraph(convId);
  if (existing) {
    currentGraph = existing;
  } else {
    currentGraph = { conversationId: convId, nodes: [], edges: [] };
  }
  reformat();
}

function reformat(): void {
  if (!currentGraph || !canvas) return;
  currentGraph = layoutGraph(currentGraph, panelWidth - 20);
  redraw();
}

function redraw(): void {
  if (!canvas || !currentGraph) return;

  const dpr = window.devicePixelRatio || 1;
  const width = panelWidth - 20;
  const height = getCanvasHeight(currentGraph);

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx = canvas.getContext('2d');
  if (!ctx) return;

  renderGraph(ctx, currentGraph, renderState, width, height);
}

function onCanvasMouseMove(e: MouseEvent): void {
  if (!currentGraph || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const node = hitTestNode(currentGraph, x, y);
  const newHoveredId = node?.id ?? null;

  if (newHoveredId !== renderState.hoveredNodeId) {
    renderState.hoveredNodeId = newHoveredId;
    canvas.style.cursor = newHoveredId ? 'pointer' : 'default';
    redraw();
  }
}

function onCanvasClick(e: MouseEvent): void {
  if (!currentGraph || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const node = hitTestNode(currentGraph, x, y);
  if (node) {
    renderState.selectedNodeId = node.id;
    const { nodeIds, edgeKeys } = findAncestors(currentGraph, node.id);
    renderState.ancestorNodeIds = nodeIds;
    renderState.ancestorEdgeKeys = edgeKeys;

    // Scroll Claude chat to the corresponding message
    scrollToMessage(node.messageIndex);
  } else {
    renderState.selectedNodeId = null;
    renderState.ancestorNodeIds = new Set();
    renderState.ancestorEdgeKeys = new Set();
  }

  redraw();
}

function onCanvasMouseLeave(): void {
  renderState.hoveredNodeId = null;
  redraw();
}

function scrollToMessage(messageIndex: number): void {
  // Try to find the message element in Claude's DOM
  const messages = document.querySelectorAll(
    '[data-testid="human-turn"], [data-testid="assistant-turn"], [class*="human"], [class*="assistant"]',
  );
  // Each turn is 2 messages (human + assistant), so target index * 2
  const targetIdx = messageIndex * 2;
  if (messages[targetIdx]) {
    messages[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function onResponseComplete(
  turns: ConversationTurn[],
  latestTurn: ConversationTurn,
): Promise<void> {
  if (!currentGraph) return;

  setStatus('Analyzing...', true);

  const payload: AnalyzeTurnPayload = {
    existingNodes: currentGraph.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
    })),
    humanMessage: latestTurn.human,
    assistantMessage: latestTurn.assistant,
  };

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_TURN',
      payload,
    } as ExtensionMessage);

    if (response.type === 'API_ERROR') {
      setStatus(response.error, false, true);
      return;
    }

    const result = response.payload;
    const newNodeId = `node-${Date.now()}`;
    const messageIndex = turns.length - 1;

    const newNode: GraphNode = {
      id: newNodeId,
      messageIndex,
      title: result.title,
      summary: result.summary,
      level: 0,
      x: 0,
      y: 0,
    };

    const newEdges: GraphEdge[] = [];
    for (const parent of result.parents) {
      let sourceId = parent.nodeId;
      if (sourceId === 'LAST' && currentGraph.nodes.length > 0) {
        sourceId = currentGraph.nodes[currentGraph.nodes.length - 1].id;
      }
      // Verify parent exists
      if (currentGraph.nodes.some((n) => n.id === sourceId)) {
        newEdges.push({
          source: sourceId,
          target: newNodeId,
          strength: parent.strength,
        });
      }
    }

    currentGraph = {
      ...currentGraph,
      nodes: [...currentGraph.nodes, newNode],
      edges: [...currentGraph.edges, ...newEdges],
    };

    reformat();
    await saveGraph(currentGraph);
    setStatus(`${currentGraph.nodes.length} nodes`);
  } catch (err) {
    setStatus((err as Error).message, false, true);
  }
}

function setStatus(text: string, loading = false, error = false): void {
  if (!statusEl) return;
  if (loading) {
    statusEl.className = 'bn-status bn-loading';
    statusEl.innerHTML = `<div class="bn-spinner"></div> ${text}`;
  } else if (error) {
    statusEl.className = 'bn-status bn-error';
    statusEl.textContent = text;
  } else {
    statusEl.className = 'bn-status';
    statusEl.textContent = text;
  }
}
