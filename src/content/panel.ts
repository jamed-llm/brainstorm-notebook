import { MindNoteGraph, GraphNode, GraphEdge } from '../shared/types';
import { layoutGraph, getCanvasHeight } from './graph-layout';
import { renderGraph, hitTestNode, hitTestEdge, createRenderState, screenToGraph, RenderState } from './graph-canvas';
import { findAncestors, findDirectParents, hasPath } from './graph-interaction';
import { saveGraph, loadGraph, saveLlmMode, loadLlmMode, getGraphCacheStats, loadSupportMilestone, saveSupportMilestone } from '../shared/storage';
import { getConversationId, startObserver, extractAllTurns, findAllMessageElements, ConversationTurn, ObserverHandle } from './observer';
import { detectPlatform } from './platforms';
import { exportAsMarkdown, exportAsJson, exportAsHtml } from './export';
import { NODE_WIDTH, NODE_HEIGHT } from './graph-layout';
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
let connectSourceNode: GraphNode | null = null;
let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
let llmEnabled = true;
let tooltipHovered = false;
let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null;
/** Keyword sets for each node (keyed by node ID) – used in non-LLM mode. */
let nodeKeywords = new Map<string, Set<string>>();

// ── Non-LLM helpers ──────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','in','on','at','to','for','of','is',
  'it','that','this','with','as','was','are','be','by','not','from','have',
  'has','had','do','does','did','will','would','could','should','can','may',
  'its','their','they','them','there','then','than','what','which','who',
  'how','when','where','why','all','each','every','any','some','no','more',
  'most','other','into','over','such','about','been','being','were','just',
  'also','very','much','many','only','your','you','our','we','my','me','he',
  'she','his','her','him','out','up','so','one','two','like','get','got',
  'make','made','use','used','using','know','think','want','need','say',
  'said','going','come','came','see','look','go','new',
]);

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ') + '...';
}

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9\u00C0-\u024F\u3000-\u9FFF\uAC00-\uD7AF]+/);
  const kw = new Set<string>();
  for (const w of words) {
    if (w.length >= 3 && !STOPWORDS.has(w)) kw.add(w);
  }
  return kw;
}

function jaccardWithRecency(
  a: Set<string>,
  b: Set<string>,
  distance: number,
  totalNodes: number,
): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  const jaccard = intersection / union;
  const recency = 0.7 + 0.3 * (1 - distance / Math.max(totalNodes, 1));
  return jaccard * recency;
}

function scoreToStrength(score: number): 'strong' | 'middle' | 'thin' | null {
  if (score >= 0.20) return 'strong';
  if (score >= 0.10) return 'middle';
  if (score >= 0.05) return 'thin';
  return null;
}

/** Inject a floating button on the page so users can open the panel without the extension icon. */
export function injectFloatingButton(): void {
  if (floatingBtn) return;

  // Wrapper holds both buttons so hover area spans both
  const fabWrap = document.createElement('div');
  fabWrap.id = 'brainstorm-notebook-fab-wrap';
  fabWrap.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999998;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
  `;

  // Coffee button (hidden by default, slides up on hover)
  const coffeeFab = document.createElement('a');
  coffeeFab.id = 'brainstorm-notebook-coffee';
  coffeeFab.href = 'https://www.buymeacoffee.com/godlucky';
  coffeeFab.target = '_blank';
  coffeeFab.rel = 'noopener noreferrer';
  coffeeFab.textContent = '\u2615';
  coffeeFab.style.cssText = `
    width: 44px; height: 44px; border-radius: 50%;
    background: #FFDD00; color: #6F4E37; font-size: 22px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    text-decoration: none; user-select: none;
    opacity: 0; transform: translateY(20px) scale(0.6);
    transition: opacity 0.25s, transform 0.25s;
    pointer-events: none; position: relative;
  `;
  const coffeeTip = document.createElement('div');
  coffeeTip.textContent = 'Leave a tip!';
  coffeeTip.style.cssText = `
    position: absolute; right: 52px; top: 50%; transform: translateY(-50%);
    white-space: nowrap; background: #1f2937; color: #fff;
    font-size: 12px; padding: 5px 10px; border-radius: 4px;
    pointer-events: none; opacity: 0; transition: opacity 0.2s;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  coffeeFab.appendChild(coffeeTip);
  coffeeFab.addEventListener('mouseenter', () => {
    coffeeFab.style.transform = 'translateY(0) scale(1.1)';
    coffeeTip.style.opacity = '1';
  });
  coffeeFab.addEventListener('mouseleave', () => {
    coffeeFab.style.transform = 'translateY(0) scale(1)';
    coffeeTip.style.opacity = '0';
  });

  // Brain button
  floatingBtn = document.createElement('div');
  floatingBtn.id = 'brainstorm-notebook-fab';
  floatingBtn.title = 'Brainstorm Notebook';
  floatingBtn.textContent = '\uD83E\uDDE0';
  floatingBtn.style.cssText = `
    width: 44px; height: 44px; border-radius: 50%;
    background: #2563eb; color: white; font-size: 22px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    border: none; user-select: none; transition: transform 0.15s;
  `;
  floatingBtn.addEventListener('click', togglePanel);

  // Show/hide coffee on wrapper hover
  fabWrap.addEventListener('mouseenter', () => {
    coffeeFab.style.opacity = '1';
    coffeeFab.style.transform = 'translateY(0) scale(1)';
    coffeeFab.style.pointerEvents = 'auto';
    if (floatingBtn) floatingBtn.style.transform = 'scale(1.1)';
  });
  fabWrap.addEventListener('mouseleave', () => {
    coffeeFab.style.opacity = '0';
    coffeeFab.style.transform = 'translateY(20px) scale(0.6)';
    coffeeFab.style.pointerEvents = 'none';
    coffeeTip.style.opacity = '0';
    if (floatingBtn) floatingBtn.style.transform = 'scale(1)';
  });

  fabWrap.appendChild(coffeeFab);
  fabWrap.appendChild(floatingBtn);
  document.body.appendChild(fabWrap);
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
    <div class="bn-header-row">
      <span>Brainstorm Notebook</span>
      <div class="bn-header-actions">
        <button class="bn-btn bn-btn-primary" id="bn-rebuild">Rebuild</button>
        <span class="bn-btn-tip-wrap bn-export-wrap">
          <button class="bn-btn" id="bn-export">Export</button>
          <span class="bn-btn-tip bn-btn-tip-right">Export the conversation in Markdown, JSON, or as an interactive HTML with the brainstorm graph.</span>
          <div class="bn-export-popup" id="bn-export-popup">
            <button class="bn-btn bn-btn-sm" id="bn-export-md">Markdown</button>
            <button class="bn-btn bn-btn-sm" id="bn-export-json">JSON</button>
            <button class="bn-btn bn-btn-sm" id="bn-export-html">HTML (with graph)</button>
          </div>
        </span>
        <span class="bn-btn-tip-wrap">
          <a class="bn-btn bn-btn-coffee" id="bn-coffee" href="https://www.buymeacoffee.com/godlucky" target="_blank" rel="noopener noreferrer">&#9749;</a>
          <span class="bn-btn-tip bn-btn-tip-right">Leave a tip!</span>
        </span>
        <button class="bn-btn" id="bn-close">Close</button>
      </div>
    </div>
    <div class="bn-header-row bn-toolbar">
      <button class="bn-btn bn-btn-sm" id="bn-reformat">Reformat</button>
      <span class="bn-btn-tip-wrap">
        <button class="bn-btn bn-btn-sm" id="bn-connect">Connect</button>
        <span class="bn-btn-tip">Press to enter connect mode, then click source node and target node to add an edge. Press again or Esc to exit.</span>
      </span>
      <span class="bn-btn-tip-wrap">
        <button class="bn-btn bn-btn-sm" id="bn-cut">Cut</button>
        <span class="bn-btn-tip">Press to enter cut mode, then hover an edge and click to remove it. Press again or Esc to exit.</span>
      </span>
      <span class="bn-btn-tip-wrap bn-toggle">
        <span class="bn-toggle-label">LLM</span>
        <label class="bn-toggle-switch">
          <input type="checkbox" id="bn-llm-toggle" />
          <span class="bn-toggle-slider"></span>
        </label>
        <span class="bn-btn-tip">When ON, an LLM analyzes each turn to generate titles, summaries and semantic connections. When OFF, titles and summaries are extracted from the text directly, and connections are based on keyword similarity.</span>
      </span>
    </div>
  `;

  // Canvas
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'bn-canvas-wrap';
  canvas = document.createElement('canvas');
  canvasWrap.appendChild(canvas);

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.className = 'bn-status-bar';

  statusEl = document.createElement('div');
  statusEl.className = 'bn-status';
  statusEl.textContent = 'Ready';

  statusBar.appendChild(statusEl);

  // Tooltip card
  tooltip = document.createElement('div');
  tooltip.className = 'bn-tooltip';
  tooltip.innerHTML = `
    <div class="bn-tooltip-title"></div>
    <div class="bn-tooltip-summary"></div>
  `;
  tooltip.addEventListener('mouseenter', () => {
    tooltipHovered = true;
    if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
  });
  tooltip.addEventListener('mouseleave', () => {
    tooltipHovered = false;
    hideTooltip();
  });

  // Support popup
  const supportPopup = document.createElement('div');
  supportPopup.className = 'bn-support-popup';
  supportPopup.innerHTML = `
    <div class="bn-support-popup-text">Enjoying this app? Leave a tip!</div>
    <div class="bn-support-popup-actions">
      <a class="bn-btn bn-btn-primary" href="https://www.buymeacoffee.com/godlucky" target="_blank" rel="noopener noreferrer">\u2615 Buy me a coffee</a>
      <button class="bn-btn bn-support-popup-dismiss">Later</button>
    </div>
  `;
  supportPopup.querySelector('.bn-support-popup-dismiss')?.addEventListener('click', () => {
    supportPopup.style.display = 'none';
  });

  panel.appendChild(resizeHandle);
  panel.appendChild(header);
  panel.appendChild(canvasWrap);
  panel.appendChild(tooltip);
  panel.appendChild(supportPopup);
  panel.appendChild(statusBar);
  shadow.appendChild(panel);

  // Event listeners
  shadow.getElementById('bn-connect')?.addEventListener('click', () => toggleMode('connect'));
  shadow.getElementById('bn-cut')?.addEventListener('click', () => toggleMode('cut'));
  shadow.getElementById('bn-rebuild')?.addEventListener('click', rebuildFromConversation);
  shadow.getElementById('bn-reformat')?.addEventListener('click', reformat);
  shadow.getElementById('bn-close')?.addEventListener('click', destroyPanel);

  // Export popup
  const exportBtn = shadow.getElementById('bn-export');
  const exportPopup = shadow.getElementById('bn-export-popup');
  exportBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    exportPopup?.classList.toggle('bn-open');
  });
  // Close popup on outside click
  shadow.addEventListener('click', (e) => {
    if (exportPopup?.classList.contains('bn-open') && !exportPopup.contains(e.target as Node) && e.target !== exportBtn) {
      exportPopup.classList.remove('bn-open');
    }
  });
  const convId = () => currentGraph?.conversationId || 'export';
  shadow.getElementById('bn-export-md')?.addEventListener('click', () => {
    const turns = extractAllTurns();
    if (turns.length === 0) { if (statusEl) statusEl.textContent = 'No conversation to export'; return; }
    exportAsMarkdown(turns, convId());
    exportPopup?.classList.remove('bn-open');
    if (statusEl) statusEl.textContent = 'Exported as Markdown';
  });
  shadow.getElementById('bn-export-json')?.addEventListener('click', () => {
    const turns = extractAllTurns();
    if (turns.length === 0) { if (statusEl) statusEl.textContent = 'No conversation to export'; return; }
    exportAsJson(turns, convId());
    exportPopup?.classList.remove('bn-open');
    if (statusEl) statusEl.textContent = 'Exported as JSON';
  });
  shadow.getElementById('bn-export-html')?.addEventListener('click', () => {
    const turns = extractAllTurns();
    if (!currentGraph || turns.length === 0) { if (statusEl) statusEl.textContent = 'No graph or conversation to export'; return; }
    exportAsHtml(currentGraph, turns, convId());
    exportPopup?.classList.remove('bn-open');
    if (statusEl) statusEl.textContent = 'Exported as HTML';
  });

  // LLM toggle
  const llmToggle = shadow.getElementById('bn-llm-toggle') as HTMLInputElement | null;
  if (llmToggle) {
    loadLlmMode().then((enabled) => {
      llmEnabled = enabled;
      llmToggle.checked = enabled;
    });
    llmToggle.addEventListener('change', () => {
      llmEnabled = llmToggle.checked;
      saveLlmMode(llmEnabled);
    });
  }

  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mousedown', onCanvasMouseDown);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mouseleave', onCanvasMouseLeave);
  canvas.addEventListener('wheel', onCanvasWheel, { passive: false });

  // Escape key exits connect/cut modes
  onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && renderState.interactionMode !== 'default') {
      exitMode();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // Push page content left to make room for panel
  adjustPageLayout(true);

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

  // If we already have a graph with a temporary ID (e.g. chatgpt- prefix from homepage),
  // migrate it to the real conversation ID instead of resetting.
  if (currentGraph && currentGraph.nodes.length > 0 && currentGraph.conversationId !== convId) {
    const oldId = currentGraph.conversationId;
    if (oldId.startsWith('chatgpt-')) {
      currentGraph = { ...currentGraph, conversationId: convId };
      await saveGraph(currentGraph);
    await checkSupportMilestone();
      return;
    }
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
  if (onKeyDown) {
    document.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
  }
  exitMode();
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
  adjustPageLayout(false);
}

function adjustPageLayout(panelOpen: boolean): void {
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
    adjustPageLayout(true);
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

function toggleMode(mode: 'connect' | 'cut'): void {
  if (renderState.interactionMode === mode) {
    exitMode();
  } else {
    exitMode();
    renderState.interactionMode = mode;
    updateModeButtons();
    setStatus(mode === 'connect' ? 'Click source node' : 'Click an edge to cut');
    if (canvas) canvas.style.cursor = 'crosshair';
  }
}

function exitMode(): void {
  renderState.interactionMode = 'default';
  renderState.connectSourceId = null;
  renderState.rubberBandEnd = null;
  renderState.hoveredEdgeIndex = null;
  connectSourceNode = null;
  updateModeButtons();
  if (canvas) canvas.style.cursor = 'grab';
  redraw();
}

function updateModeButtons(): void {
  const connectBtn = shadow?.getElementById('bn-connect');
  const cutBtn = shadow?.getElementById('bn-cut');
  if (connectBtn) {
    connectBtn.className = renderState.interactionMode === 'connect' ? 'bn-btn bn-btn-sm bn-btn-active' : 'bn-btn bn-btn-sm';
  }
  if (cutBtn) {
    cutBtn.className = renderState.interactionMode === 'cut' ? 'bn-btn bn-btn-sm bn-btn-active' : 'bn-btn bn-btn-sm';
  }
}

function reformat(): void {
  if (renderState.interactionMode !== 'default') exitMode();
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

  // In connect/cut mode, clicks are handled in onCanvasClick
  if (renderState.interactionMode !== 'default') {
    e.preventDefault();
    return;
  }

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

  // Connect mode: update rubber-band line
  if (renderState.interactionMode === 'connect' && connectSourceNode) {
    const { x, y } = canvasToGraph(e);
    renderState.rubberBandEnd = { x, y };
    const node = hitTestNode(currentGraph, x, y);
    canvas.style.cursor = node && node.id !== connectSourceNode.id ? 'pointer' : 'crosshair';
    redraw();
    return;
  }

  // Cut mode: highlight nearest edge
  if (renderState.interactionMode === 'cut') {
    const { x, y } = canvasToGraph(e);
    const hit = hitTestEdge(currentGraph, x, y);
    const newIdx = hit?.index ?? null;
    if (newIdx !== renderState.hoveredEdgeIndex) {
      renderState.hoveredEdgeIndex = newIdx;
      canvas.style.cursor = newIdx !== null ? 'pointer' : 'crosshair';
      redraw();
    }
    return;
  }

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
    updateTooltip(node);
    redraw();
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

function hideTooltip(): void {
  if (tooltipHovered) return;
  // Short delay so the mouse can travel from canvas to tooltip
  tooltipHideTimer = setTimeout(() => {
    if (!tooltipHovered && tooltip) {
      tooltip.style.display = 'none';
      renderState.hoveredNodeId = null;
      redraw();
    }
    tooltipHideTimer = null;
  }, 100);
}

function updateTooltip(node: GraphNode | null): void {
  if (!tooltip) return;
  if (!node) {
    if (!tooltipHovered) hideTooltip();
    return;
  }
  if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
  const titleEl = tooltip.querySelector('.bn-tooltip-title') as HTMLDivElement;
  const summaryEl = tooltip.querySelector('.bn-tooltip-summary') as HTMLDivElement;
  titleEl.textContent = node.title;
  summaryEl.textContent = node.summary;
  summaryEl.scrollTop = 0;
  tooltip.style.display = 'block';
  positionTooltipOnNode(node);
}

/** Position the tooltip anchored to the node, overlapping slightly so the mouse can reach it. */
function positionTooltipOnNode(node: GraphNode): void {
  if (!tooltip || !panelHost || !canvas) return;

  const canvasRect = canvas.getBoundingClientRect();
  const panelRect = panelHost.getBoundingClientRect();

  // Convert node graph coords to screen coords relative to panel
  const nodeScreenX = node.x * renderState.zoom + renderState.panX + canvasRect.left - panelRect.left;
  const nodeScreenY = node.y * renderState.zoom + renderState.panY + canvasRect.top - panelRect.top;
  const nodeScreenW = NODE_WIDTH * renderState.zoom;
  const nodeScreenH = NODE_HEIGHT * renderState.zoom;

  const tooltipWidth = 220;
  // Center tooltip horizontally on the node
  let left = nodeScreenX + nodeScreenW / 2 - tooltipWidth / 2;
  left = Math.max(8, Math.min(left, panelWidth - tooltipWidth - 8));
  // Place above the node, overlapping by 6px so mouse can travel to it
  let top = nodeScreenY - tooltip.offsetHeight + 6;
  // If not enough room above, place below with overlap
  if (top < 8) top = nodeScreenY + nodeScreenH - 6;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function onCanvasClick(e: MouseEvent): void {
  if (!currentGraph || !canvas) return;
  const { x, y } = canvasToGraph(e);

  // --- Connect mode ---
  if (renderState.interactionMode === 'connect') {
    const node = hitTestNode(currentGraph, x, y);
    if (!connectSourceNode) {
      // First click: pick source
      if (node) {
        connectSourceNode = node;
        renderState.connectSourceId = node.id;
        setStatus('Click target node');
        redraw();
      } else {
        exitMode();
        setStatus('Ready');
      }
    } else {
      // Second click: pick target and create edge
      if (node && node.id !== connectSourceNode.id) {
        const duplicate = currentGraph.edges.some(
          (e) => e.source === connectSourceNode!.id && e.target === node.id,
        );
        const pathExists = hasPath(currentGraph, connectSourceNode.id, node.id);
        if (duplicate || pathExists) {
          setStatus('Path already exists');
        } else {
          currentGraph = {
            ...currentGraph,
            edges: [...currentGraph.edges, {
              source: connectSourceNode.id,
              target: node.id,
              strength: 'middle',
            }],
          };
          saveGraph(currentGraph).then(checkSupportMilestone);
          setStatus(`${currentGraph.nodes.length} nodes`);
        }
      }
      // Reset connect state (stay in connect mode for chaining)
      connectSourceNode = null;
      renderState.connectSourceId = null;
      renderState.rubberBandEnd = null;
      setStatus('Click source node');
      redraw();
    }
    return;
  }

  // --- Cut mode ---
  if (renderState.interactionMode === 'cut') {
    if (renderState.hoveredEdgeIndex !== null) {
      currentGraph = {
        ...currentGraph,
        edges: currentGraph.edges.filter((_, i) => i !== renderState.hoveredEdgeIndex),
      };
      renderState.hoveredEdgeIndex = null;
      saveGraph(currentGraph).then(checkSupportMilestone);
      setStatus(`${currentGraph.nodes.length} nodes`);
      redraw();
    }
    return;
  }

  // --- Default mode ---
  const wasDragging = hasDragged;

  // End any drag
  if (isDraggingNode && draggedNode && hasDragged) {
    saveGraph(currentGraph).then(checkSupportMilestone);
  }
  isDraggingCanvas = false;
  isDraggingNode = false;
  draggedNode = null;
  canvas.style.cursor = 'grab';

  // If we dragged, don't trigger selection
  if (wasDragging) return;

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

    // Scroll chat to the corresponding message
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
    saveGraph(currentGraph).then(checkSupportMilestone);
  }
  isDraggingCanvas = false;
  isDraggingNode = false;
  draggedNode = null;
  if (!tooltipHovered) {
    hideTooltip();
  }
  if (canvas) canvas.style.cursor = 'grab';
  redraw();
}

function scrollToMessage(messageIndex: number): void {
  const messages = findAllMessageElements();
  const platform = detectPlatform();
  // On Claude, each turn is 2 wrappers (human + assistant), so multiply by 2.
  // On ChatGPT, each <article> is one turn, so user turn index = messageIndex * 2.
  const targetIdx = platform.name === 'claude' ? messageIndex * 2 : messageIndex * 2;
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

  try {
    let result: { title: string; summary: string; parents: { nodeId: string; strength: 'strong' | 'middle' | 'thin' }[] };

    if (!llmEnabled) {
      // Non-LLM: extract title/summary from text, connect via keyword similarity
      const title = latestTurn.human.slice(0, 30).trim() + (latestTurn.human.length > 30 ? '...' : '');
      const summary = truncateWords(latestTurn.assistant, 100);
      const newKw = extractKeywords(latestTurn.human + ' ' + latestTurn.assistant);
      const parents: { nodeId: string; strength: 'strong' | 'middle' | 'thin' }[] = [];
      const total = currentGraph.nodes.length;

      for (let i = 0; i < total; i++) {
        const existKw = nodeKeywords.get(currentGraph.nodes[i].id);
        if (!existKw) continue;
        const score = jaccardWithRecency(newKw, existKw, total - i, total);
        const strength = scoreToStrength(score);
        if (strength) parents.push({ nodeId: String(i), strength });
      }

      result = { title, summary, parents };
      // Store keywords for this node (will be keyed by newNodeId below)
      (result as any)._keywords = newKw;
    } else {
      // LLM mode: send to service worker
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

      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_TURN',
        payload,
      } as ExtensionMessage);

      if (response.type === 'API_ERROR') {
        setStatus(response.error, false, true);
        return;
      }

      result = response.payload;
    }

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

    // Store keywords for non-LLM mode
    if (!llmEnabled) {
      nodeKeywords.set(newNodeId, (result as any)._keywords);
    }

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
        // Skip if a path already exists from source to the new node through existing edges + already-added new edges
        const tempGraph: MindNoteGraph = {
          ...currentGraph,
          edges: [...currentGraph.edges, ...newEdges],
        };
        if (!hasPath(tempGraph, sourceNodeId, newNodeId)) {
          newEdges.push({
            source: sourceNodeId,
            target: newNodeId,
            strength: parent.strength,
          });
        }
      }
    }

    currentGraph = {
      ...currentGraph,
      nodes: [...currentGraph.nodes, newNode],
      edges: [...currentGraph.edges, ...newEdges],
    };

    reformat();
    await saveGraph(currentGraph);
    await checkSupportMilestone();
    setStatus(`${currentGraph.nodes.length} nodes`);
  } catch (err) {
    setStatus((err as Error).message, false, true);
  }
}

async function rebuildFromConversation(): Promise<void> {
  if (isRebuilding) return;
  if (renderState.interactionMode !== 'default') exitMode();
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

  // Reset graph and keyword cache
  currentGraph = { conversationId: convId, nodes: [], edges: [] };
  nodeKeywords.clear();
  reformat();

  setStatus(`Analyzing ${turns.length} turns...`, true);

  try {
    let batchResult: {
      nodes: { index: number; title: string; summary: string; parents: { index: number; strength: 'strong' | 'middle' | 'thin' }[] }[];
    };

    if (!llmEnabled) {
      // Non-LLM batch: keyword-based connections
      const turnKeywords: Set<string>[] = turns.map(
        (t) => extractKeywords(t.human + ' ' + t.assistant),
      );
      const batchNodes: typeof batchResult.nodes = [];

      for (let i = 0; i < turns.length; i++) {
        const parents: { index: number; strength: 'strong' | 'middle' | 'thin' }[] = [];

        for (let j = 0; j < i; j++) {
          const score = jaccardWithRecency(turnKeywords[i], turnKeywords[j], i - j, i);
          const strength = scoreToStrength(score);
          if (strength) parents.push({ index: j, strength });
        }

        batchNodes.push({
          index: i,
          title: turns[i].human.slice(0, 30).trim() + (turns[i].human.length > 30 ? '...' : ''),
          summary: truncateWords(turns[i].assistant, 100),
          parents,
        });
      }

      batchResult = { nodes: batchNodes };
    } else {
      // LLM batch
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

      batchResult = { nodes: response.payload.nodes };
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIdByIndex = new Map<number, string>();

    // Create all nodes
    for (const batchNode of batchResult.nodes) {
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

      // Cache keywords for non-LLM incremental updates
      if (!llmEnabled) {
        nodeKeywords.set(nodeId, extractKeywords(turns[batchNode.index].human + ' ' + turns[batchNode.index].assistant));
      }
    }

    // Create all edges
    for (const batchNode of batchResult.nodes) {
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
    await checkSupportMilestone();
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

async function checkSupportMilestone(): Promise<void> {
  if (!shadow) return;
  const stats = await getGraphCacheStats();
  const currentKB = Math.floor(stats.sizeBytes / 1024);
  if (currentKB < 1) return;
  const lastMilestone = await loadSupportMilestone();
  if (currentKB > lastMilestone) {
    await saveSupportMilestone(currentKB);
    const popup = shadow.querySelector('.bn-support-popup') as HTMLElement | null;
    if (popup) popup.style.display = 'block';
  }
}
