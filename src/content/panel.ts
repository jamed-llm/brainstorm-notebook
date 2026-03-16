import { MindNoteGraph, GraphNode, GraphEdge } from '../shared/types';
import { layoutGraph, getCanvasHeight } from './graph-layout';
import { renderGraph, hitTestNode, createRenderState, screenToGraph, RenderState } from './graph-canvas';
import { findAncestors, findDirectParents } from './graph-interaction';
import { saveGraph, loadGraph } from '../shared/storage';
import { getConversationId, startObserver, extractAllTurns, findAllMessageElements, ConversationTurn, ObserverHandle } from './observer';
import { ExtensionMessage, AnalyzeTurnPayload } from '../shared/messages';
import panelCss from './panel.css?inline';

let floatingBtn: HTMLDivElement | null = null;
let panelHost: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let statusEl: HTMLDivElement | null = null;
let currentGraph: MindNoteGraph | null = null;
let renderState: RenderState = createRenderState();
let panelWidth = 400;
let observerHandle: ObserverHandle | null = null;
let isRebuilding = false;
let tooltip: HTMLDivElement | null = null;
let isDraggingCanvas = false;
let isDraggingNode = false;
let draggedNode: GraphNode | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;
let dragStartNodeX = 0;
let dragStartNodeY = 0;
let hasDragged = false;

/** Inject a floating button on the page so users can open the panel without the extension icon. */
export function injectFloatingButton(): void {
  if (floatingBtn) return;
  floatingBtn = document.createElement('div');
  floatingBtn.id = 'brainstorm-notebook-fab';
  floatingBtn.title = 'Brainstorm Notebook';
  floatingBtn.textContent = '\uD83E\uDDE0';
  floatingBtn.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999998;
    width: 44px; height: 44px; border-radius: 50%;
    background: #2563eb; color: white; font-size: 22px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    border: none; user-select: none; transition: transform 0.15s;
  `;
  floatingBtn.addEventListener('mouseenter', () => {
    if (floatingBtn) floatingBtn.style.transform = 'scale(1.1)';
  });
  floatingBtn.addEventListener('mouseleave', () => {
    if (floatingBtn) floatingBtn.style.transform = 'scale(1)';
  });
  floatingBtn.addEventListener('click', togglePanel);
  document.body.appendChild(floatingBtn);
}

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
      <button class="bn-btn bn-btn-primary" id="bn-rebuild">Rebuild</button>
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

  // Tooltip card
  tooltip = document.createElement('div');
  tooltip.className = 'bn-tooltip';
  tooltip.innerHTML = `
    <div class="bn-tooltip-title"></div>
    <div class="bn-tooltip-summary"></div>
  `;

  panel.appendChild(resizeHandle);
  panel.appendChild(header);
  panel.appendChild(canvasWrap);
  panel.appendChild(tooltip);
  panel.appendChild(statusEl);
  shadow.appendChild(panel);

  // Event listeners
  const rebuildBtn = shadow.getElementById('bn-rebuild');
  rebuildBtn?.addEventListener('click', rebuildFromConversation);

  const reformatBtn = shadow.getElementById('bn-reformat');
  reformatBtn?.addEventListener('click', reformat);

  const closeBtn = shadow.getElementById('bn-close');
  closeBtn?.addEventListener('click', destroyPanel);

  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mousedown', onCanvasMouseDown);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mouseleave', onCanvasMouseLeave);
  canvas.addEventListener('wheel', onCanvasWheel, { passive: false });

  // Push claude.ai content left
  adjustClaudeLayout(true);

  // Load existing graph or create new
  initGraph();

  // Start observing conversation
  observerHandle = startObserver(onResponseComplete);
  observerHandle.onNavigate = onNavigate;
}

async function onNavigate(convId: string | null): Promise<void> {
  if (!convId) {
    currentGraph = null;
    setStatus('Navigate to a conversation to start');
    return;
  }

  const existing = await loadGraph(convId);
  if (existing) {
    currentGraph = existing;
  } else {
    currentGraph = { conversationId: convId, nodes: [], edges: [] };
  }
  renderState.selectedNodeId = null;
  renderState.ancestorNodeIds = new Set();
  renderState.ancestorEdgeKeys = new Set();
  reformat();
  setStatus('Ready');
}

function destroyPanel(): void {
  if (observerHandle) {
    observerHandle.cleanup();
    observerHandle = null;
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
  // Reset pan/zoom to fit content
  renderState.panX = 0;
  renderState.panY = 0;
  renderState.zoom = 1;
  redraw();
}

function redraw(): void {
  if (!canvas || !currentGraph) return;

  const dpr = window.devicePixelRatio || 1;
  const wrap = canvas.parentElement;
  const width = wrap ? wrap.clientWidth : panelWidth - 20;
  const height = wrap ? wrap.clientHeight : 400;

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  ctx = canvas.getContext('2d');
  if (!ctx) return;

  renderGraph(ctx, currentGraph, renderState, width, height);
}

function canvasToGraph(e: MouseEvent): { x: number; y: number } {
  const rect = canvas!.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  return screenToGraph(sx, sy, renderState);
}

function onCanvasMouseDown(e: MouseEvent): void {
  if (!canvas || e.button !== 0) return;
  const { x, y } = canvasToGraph(e);
  const node = currentGraph ? hitTestNode(currentGraph, x, y) : null;

  dragStartX = e.clientX;
  dragStartY = e.clientY;
  hasDragged = false;

  if (node) {
    // Start node drag
    isDraggingNode = true;
    draggedNode = node;
    dragStartNodeX = node.x;
    dragStartNodeY = node.y;
    canvas.style.cursor = 'move';
  } else {
    // Start canvas pan
    isDraggingCanvas = true;
    dragStartPanX = renderState.panX;
    dragStartPanY = renderState.panY;
    canvas.style.cursor = 'grabbing';
  }
  e.preventDefault();
}

function onCanvasMouseMove(e: MouseEvent): void {
  if (!currentGraph || !canvas) return;

  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  if (isDraggingCanvas) {
    hasDragged = true;
    renderState.panX = dragStartPanX + dx;
    renderState.panY = dragStartPanY + dy;
    redraw();
    return;
  }

  if (isDraggingNode && draggedNode) {
    hasDragged = true;
    draggedNode.x = dragStartNodeX + dx / renderState.zoom;
    draggedNode.y = dragStartNodeY + dy / renderState.zoom;
    if (tooltip) tooltip.style.display = 'none';
    canvas.style.cursor = 'move';
    redraw();
    return;
  }

  const { x, y } = canvasToGraph(e);
  const node = hitTestNode(currentGraph, x, y);
  const newHoveredId = node?.id ?? null;

  if (newHoveredId !== renderState.hoveredNodeId) {
    renderState.hoveredNodeId = newHoveredId;
    canvas.style.cursor = newHoveredId ? 'pointer' : 'grab';
    updateTooltip(node, e);
    redraw();
  } else if (node && tooltip) {
    positionTooltip(e);
  }
}

function onCanvasWheel(e: WheelEvent): void {
  if (!canvas) return;
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  const newZoom = Math.max(0.2, Math.min(3, renderState.zoom * zoomFactor));
  const scale = newZoom / renderState.zoom;

  // Zoom toward the mouse position
  renderState.panX = mx - scale * (mx - renderState.panX);
  renderState.panY = my - scale * (my - renderState.panY);
  renderState.zoom = newZoom;

  redraw();
}

function updateTooltip(node: GraphNode | null, e: MouseEvent): void {
  if (!tooltip) return;
  if (!node) {
    tooltip.style.display = 'none';
    return;
  }
  const titleEl = tooltip.querySelector('.bn-tooltip-title') as HTMLDivElement;
  const summaryEl = tooltip.querySelector('.bn-tooltip-summary') as HTMLDivElement;
  titleEl.textContent = node.title;
  summaryEl.textContent = node.summary;
  summaryEl.scrollTop = 0;
  tooltip.style.display = 'block';
  positionTooltip(e);
}

function positionTooltip(e: MouseEvent): void {
  if (!tooltip || !panelHost) return;
  const panelRect = panelHost.getBoundingClientRect();
  const x = e.clientX - panelRect.left;
  const y = e.clientY - panelRect.top;

  // Position above cursor, clamped within panel
  const tooltipWidth = 220;
  let left = x - tooltipWidth / 2;
  left = Math.max(8, Math.min(left, panelWidth - tooltipWidth - 8));
  let top = y - tooltip.offsetHeight - 12;
  if (top < 8) top = y + 20;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function onCanvasClick(e: MouseEvent): void {
  const wasDragging = hasDragged;

  // End any drag
  if (isDraggingNode && draggedNode && hasDragged && currentGraph) {
    saveGraph(currentGraph);
  }
  isDraggingCanvas = false;
  isDraggingNode = false;
  draggedNode = null;
  if (canvas) canvas.style.cursor = 'grab';

  // If we dragged, don't trigger selection
  if (wasDragging) return;

  if (!currentGraph || !canvas) return;
  const { x, y } = canvasToGraph(e);

  const node = hitTestNode(currentGraph, x, y);
  if (node && node.id === renderState.selectedNodeId) {
    // Toggle off
    renderState.selectedNodeId = null;
    renderState.ancestorNodeIds = new Set();
    renderState.ancestorEdgeKeys = new Set();
  } else if (node) {
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
  if (isDraggingNode && draggedNode && currentGraph) {
    saveGraph(currentGraph);
  }
  isDraggingCanvas = false;
  isDraggingNode = false;
  draggedNode = null;
  renderState.hoveredNodeId = null;
  if (tooltip) tooltip.style.display = 'none';
  if (canvas) canvas.style.cursor = 'grab';
  redraw();
}

function scrollToMessage(messageIndex: number): void {
  const messages = findAllMessageElements();
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
  // If no graph yet (e.g. first message created a new conversation), init it
  if (!currentGraph) {
    const convId = getConversationId();
    if (!convId) return;
    currentGraph = { conversationId: convId, nodes: [], edges: [] };
  }

  setStatus('Analyzing...', true);

  // Use numeric indices so the LLM can reliably reference existing nodes
  const existingNodes = currentGraph.nodes.map((n, i) => ({
    id: String(i),
    title: n.title,
    summary: n.summary,
  }));

  const payload: AnalyzeTurnPayload = {
    existingNodes,
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
      let sourceNodeId: string | null = null;

      if (parent.nodeId === 'LAST' && currentGraph.nodes.length > 0) {
        sourceNodeId = currentGraph.nodes[currentGraph.nodes.length - 1].id;
      } else {
        // Map numeric index back to real node ID
        const idx = parseInt(parent.nodeId, 10);
        if (!isNaN(idx) && idx >= 0 && idx < currentGraph.nodes.length) {
          sourceNodeId = currentGraph.nodes[idx].id;
        }
      }

      if (sourceNodeId) {
        newEdges.push({
          source: sourceNodeId,
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

async function rebuildFromConversation(): Promise<void> {
  if (isRebuilding) return;
  isRebuilding = true;

  const convId = getConversationId();
  if (!convId) {
    setStatus('Navigate to a conversation first', false, true);
    isRebuilding = false;
    return;
  }

  const turns = extractAllTurns();
  if (turns.length === 0) {
    setStatus('No conversation turns found', false, true);
    isRebuilding = false;
    return;
  }

  // Reset graph
  currentGraph = { conversationId: convId, nodes: [], edges: [] };
  reformat();

  setStatus(`Analyzing ${turns.length} turns...`, true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_BATCH',
      payload: {
        turns: turns.map((t, i) => ({ index: i, human: t.human, assistant: t.assistant })),
      },
    } as ExtensionMessage);

    if (response.type === 'API_ERROR') {
      setStatus(`Error: ${response.error}`, false, true);
      isRebuilding = false;
      return;
    }

    const result = response.payload;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIdByIndex = new Map<number, string>();

    // Create all nodes
    for (const batchNode of result.nodes) {
      const nodeId = `node-${Date.now()}-${batchNode.index}`;
      nodeIdByIndex.set(batchNode.index, nodeId);
      nodes.push({
        id: nodeId,
        messageIndex: batchNode.index,
        title: batchNode.title,
        summary: batchNode.summary,
        level: 0,
        x: 0,
        y: 0,
      });
    }

    // Create all edges
    for (const batchNode of result.nodes) {
      const targetId = nodeIdByIndex.get(batchNode.index);
      if (!targetId) continue;
      for (const parent of batchNode.parents) {
        const sourceId = nodeIdByIndex.get(parent.index);
        if (sourceId) {
          edges.push({
            source: sourceId,
            target: targetId,
            strength: parent.strength,
          });
        }
      }
    }

    currentGraph = { conversationId: convId, nodes, edges };
    reformat();
    await saveGraph(currentGraph);
    observerHandle?.syncTurnCount();
    setStatus(`Rebuilt: ${nodes.length} nodes`);
  } catch (err) {
    setStatus(`Error: ${(err as Error).message}`, false, true);
  }

  isRebuilding = false;
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
