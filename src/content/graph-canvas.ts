import { MindNoteGraph, GraphNode, GraphEdge } from '../shared/types';
import { NODE_WIDTH, NODE_HEIGHT } from './graph-layout';

const COLORS = {
  nodeFill: '#ffffff',
  nodeStroke: '#d1d5db',
  nodeText: '#1f2937',
  nodeHighlight: '#3b82f6',
  nodeAncestor: '#2563eb',
  edgeStrong: '#6b7280',
  edgeMiddle: '#9ca3af',
  edgeThin: '#d1d5db',
  edgeHighlight: '#3b82f6',
  background: '#f9fafb',
};

const EDGE_WIDTHS = {
  strong: 3,
  middle: 2,
  thin: 1,
};

export interface RenderState {
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  ancestorNodeIds: Set<string>;
  ancestorEdgeKeys: Set<string>;
  panX: number;
  panY: number;
  zoom: number;
  interactionMode: 'default' | 'connect' | 'cut';
  connectSourceId: string | null;
  rubberBandEnd: { x: number; y: number } | null;
  hoveredEdgeIndex: number | null;
}

export function createRenderState(): RenderState {
  return {
    hoveredNodeId: null,
    selectedNodeId: null,
    ancestorNodeIds: new Set(),
    ancestorEdgeKeys: new Set(),
    panX: 0,
    panY: 0,
    zoom: 1,
    interactionMode: 'default',
    connectSourceId: null,
    rubberBandEnd: null,
    hoveredEdgeIndex: null,
  };
}

/** Convert screen-space coordinates to graph-space. */
export function screenToGraph(
  sx: number,
  sy: number,
  state: RenderState,
): { x: number; y: number } {
  return {
    x: (sx - state.panX) / state.zoom,
    y: (sy - state.panY) / state.zoom,
  };
}

function edgeKey(source: string, target: string): string {
  return `${source}->${target}`;
}

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  graph: MindNoteGraph,
  state: RenderState,
  width: number,
  height: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Clear
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Apply pan and zoom
  ctx.save();
  ctx.translate(state.panX, state.panY);
  ctx.scale(state.zoom, state.zoom);

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // Draw edges
  for (let ei = 0; ei < graph.edges.length; ei++) {
    const edge = graph.edges[ei];
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const isCutHovered = state.interactionMode === 'cut' && state.hoveredEdgeIndex === ei;
    const isHighlighted =
      !isCutHovered && (
        state.ancestorEdgeKeys.has(edgeKey(edge.source, edge.target)) ||
        state.hoveredNodeId === edge.target ||
        state.hoveredNodeId === edge.source
      );

    const x1 = source.x + NODE_WIDTH / 2;
    const y1 = source.y + NODE_HEIGHT;
    const x2 = target.x + NODE_WIDTH / 2;
    const y2 = target.y;

    // Control point offset: half the vertical distance, clamped for short spans
    const dy = Math.abs(y2 - y1);
    const cpOffset = Math.max(20, dy * 0.4);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, y1 + cpOffset, x2, y2 - cpOffset, x2, y2);

    if (isCutHovered) {
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = EDGE_WIDTHS[edge.strength] + 2;
    } else {
      ctx.strokeStyle = isHighlighted ? COLORS.edgeHighlight : COLORS[`edge${capitalize(edge.strength)}` as keyof typeof COLORS] as string;
      ctx.lineWidth = isHighlighted ? EDGE_WIDTHS[edge.strength] + 1 : EDGE_WIDTHS[edge.strength];
    }
    ctx.stroke();
  }

  // Draw nodes
  for (const node of graph.nodes) {
    const isHovered = state.hoveredNodeId === node.id;
    const isSelected = state.selectedNodeId === node.id;
    const isAncestor = state.ancestorNodeIds.has(node.id);

    // Node rectangle
    ctx.beginPath();
    roundRect(ctx, node.x, node.y, NODE_WIDTH, NODE_HEIGHT, 8);
    ctx.fillStyle = isSelected || isAncestor ? '#eff6ff' : COLORS.nodeFill;
    ctx.fill();
    ctx.strokeStyle =
      isSelected ? COLORS.nodeAncestor :
      isAncestor ? COLORS.nodeHighlight :
      isHovered ? COLORS.nodeHighlight :
      COLORS.nodeStroke;
    ctx.lineWidth = isSelected || isAncestor ? 2 : 1;
    ctx.stroke();

    // Node title — word-wrapped to fit
    ctx.fillStyle = isSelected || isAncestor ? COLORS.nodeAncestor : COLORS.nodeText;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const padding = 12;
    const maxWidth = NODE_WIDTH - padding * 2;
    const lines = wrapText(ctx, node.title, maxWidth);
    const lineHeight = 14;
    const totalHeight = lines.length * lineHeight;
    const startY = node.y + (NODE_HEIGHT - totalHeight) / 2 + lineHeight / 2;

    for (let li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li], node.x + NODE_WIDTH / 2, startY + li * lineHeight);
    }
  }

  // Connect mode: highlight source node with green border
  if (state.connectSourceId) {
    const srcNode = nodeMap.get(state.connectSourceId);
    if (srcNode) {
      ctx.beginPath();
      roundRect(ctx, srcNode.x, srcNode.y, NODE_WIDTH, NODE_HEIGHT, 8);
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Rubber-band bezier from source to cursor
    if (state.rubberBandEnd && srcNode) {
      const x1 = srcNode.x + NODE_WIDTH / 2;
      const y1 = srcNode.y + NODE_HEIGHT;
      const x2 = state.rubberBandEnd.x;
      const y2 = state.rubberBandEnd.y;
      const dy = Math.abs(y2 - y1);
      const cpOffset = Math.max(20, dy * 0.4);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1, y1 + cpOffset, x2, y2 - cpOffset, x2, y2);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  // Limit to 3 lines, truncate last if needed
  if (lines.length > 3) {
    lines.length = 3;
    lines[2] = lines[2].slice(0, -1) + '\u2026';
  }

  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function hitTestNode(graph: MindNoteGraph, x: number, y: number): GraphNode | null {
  // Iterate in reverse so top-drawn nodes are hit first
  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    const node = graph.nodes[i];
    if (
      x >= node.x &&
      x <= node.x + NODE_WIDTH &&
      y >= node.y &&
      y <= node.y + NODE_HEIGHT
    ) {
      return node;
    }
  }
  return null;
}

function cubicBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

export function hitTestEdge(
  graph: MindNoteGraph,
  x: number,
  y: number,
  tolerance = 8,
): { edge: GraphEdge; index: number } | null {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (let i = graph.edges.length - 1; i >= 0; i--) {
    const edge = graph.edges[i];
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const x1 = source.x + NODE_WIDTH / 2;
    const y1 = source.y + NODE_HEIGHT;
    const x2 = target.x + NODE_WIDTH / 2;
    const y2 = target.y;
    const dy = Math.abs(y2 - y1);
    const cpOffset = Math.max(20, dy * 0.4);

    // Sample points along the cubic bezier and check distance
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const bx = cubicBezier(x1, x1, x2, x2, t);
      const by = cubicBezier(y1, y1 + cpOffset, y2 - cpOffset, y2, t);
      if (Math.hypot(bx - x, by - y) <= tolerance) {
        return { edge, index: i };
      }
    }
  }
  return null;
}
