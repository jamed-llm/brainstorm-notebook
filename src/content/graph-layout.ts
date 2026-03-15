import { MindNoteGraph, GraphNode } from '../shared/types';

const NODE_WIDTH = 160;
const NODE_HEIGHT = 60;
const VERTICAL_GAP = 50;
const HORIZONTAL_GAP = 30;

export { NODE_WIDTH, NODE_HEIGHT };

export function layoutGraph(graph: MindNoteGraph, canvasWidth: number): MindNoteGraph {
  if (graph.nodes.length === 0) return graph;

  const nodes = graph.nodes.map((n) => ({ ...n }));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Build adjacency: parent -> children
  const parents = new Map<string, string[]>();
  for (const node of nodes) {
    parents.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const p = parents.get(edge.target);
    if (p) p.push(edge.source);
  }

  // Compute levels: longest path from any root to this node
  function computeLevel(nodeId: string, visited: Set<string>): number {
    if (visited.has(nodeId)) return 0; // cycle protection
    visited.add(nodeId);

    const pars = parents.get(nodeId) ?? [];
    if (pars.length === 0) return 0;

    let maxParentLevel = 0;
    for (const p of pars) {
      maxParentLevel = Math.max(maxParentLevel, computeLevel(p, visited));
    }
    return maxParentLevel + 1;
  }

  for (const node of nodes) {
    node.level = computeLevel(node.id, new Set());
  }

  // Group by level
  const levels = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const group = levels.get(node.level) ?? [];
    group.push(node);
    levels.set(node.level, group);
  }

  // Sort within each level by messageIndex for deterministic order
  for (const group of levels.values()) {
    group.sort((a, b) => a.messageIndex - b.messageIndex);
  }

  // Assign positions
  for (const [level, group] of levels) {
    const rowWidth = group.length * NODE_WIDTH + (group.length - 1) * HORIZONTAL_GAP;
    const startX = Math.max(0, (canvasWidth - rowWidth) / 2);

    for (let i = 0; i < group.length; i++) {
      const node = nodeMap.get(group[i].id);
      if (!node) continue;
      node.x = startX + i * (NODE_WIDTH + HORIZONTAL_GAP);
      node.y = level * (NODE_HEIGHT + VERTICAL_GAP) + 30;
    }
  }

  return { ...graph, nodes: Array.from(nodeMap.values()) };
}

export function getCanvasHeight(graph: MindNoteGraph): number {
  if (graph.nodes.length === 0) return 300;
  const maxLevel = Math.max(...graph.nodes.map((n) => n.level));
  return (maxLevel + 1) * (NODE_HEIGHT + VERTICAL_GAP) + 60;
}
