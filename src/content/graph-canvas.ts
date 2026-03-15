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
}

export function createRenderState(): RenderState {
  return {
    hoveredNodeId: null,
    selectedNodeId: null,
    ancestorNodeIds: new Set(),
    ancestorEdgeKeys: new Set(),
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

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // Draw edges
  for (const edge of graph.edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const isHighlighted =
      state.ancestorEdgeKeys.has(edgeKey(edge.source, edge.target)) ||
      state.hoveredNodeId === edge.target ||
      state.hoveredNodeId === edge.source;

    ctx.beginPath();
    ctx.moveTo(source.x + NODE_WIDTH / 2, source.y + NODE_HEIGHT);
    ctx.lineTo(target.x + NODE_WIDTH / 2, target.y);
    ctx.strokeStyle = isHighlighted ? COLORS.edgeHighlight : COLORS[`edge${capitalize(edge.strength)}` as keyof typeof COLORS] as string;
    ctx.lineWidth = isHighlighted ? EDGE_WIDTHS[edge.strength] + 1 : EDGE_WIDTHS[edge.strength];
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

    // Node title
    ctx.fillStyle = isSelected || isAncestor ? COLORS.nodeAncestor : COLORS.nodeText;
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxChars = 18;
    const title = node.title.length > maxChars ? node.title.slice(0, maxChars - 1) + '\u2026' : node.title;
    ctx.fillText(title, node.x + NODE_WIDTH / 2, node.y + NODE_HEIGHT / 2);
  }
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
