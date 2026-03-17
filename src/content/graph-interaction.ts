import { MindNoteGraph } from '../shared/types';

/**
 * Find all ancestor node IDs and edge keys from a given node back to all roots.
 */
export function findAncestors(
  graph: MindNoteGraph,
  nodeId: string,
): { nodeIds: Set<string>; edgeKeys: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();

  // Build reverse adjacency: child -> parents
  const parentMap = new Map<string, { parentId: string; edgeKey: string }[]>();
  for (const edge of graph.edges) {
    const list = parentMap.get(edge.target) ?? [];
    list.push({ parentId: edge.source, edgeKey: `${edge.source}->${edge.target}` });
    parentMap.set(edge.target, list);
  }

  // BFS backwards from nodeId
  const queue = [nodeId];
  nodeIds.add(nodeId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const parents = parentMap.get(current) ?? [];
    for (const { parentId, edgeKey } of parents) {
      edgeKeys.add(edgeKey);
      if (!nodeIds.has(parentId)) {
        nodeIds.add(parentId);
        queue.push(parentId);
      }
    }
  }

  return { nodeIds, edgeKeys };
}

/**
 * Check whether a directed path exists from `source` to `target` in the graph.
 */
export function hasPath(
  graph: MindNoteGraph,
  source: string,
  target: string,
): boolean {
  // BFS forward from source
  const visited = new Set<string>();
  const queue = [source];
  visited.add(source);

  // Build forward adjacency: parent -> children
  const childMap = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = childMap.get(edge.source) ?? [];
    list.push(edge.target);
    childMap.set(edge.source, list);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childMap.get(current) ?? [];
    for (const child of children) {
      if (child === target) return true;
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }

  return false;
}

/**
 * Find directly connected parent node IDs for hover highlight.
 */
export function findDirectParents(
  graph: MindNoteGraph,
  nodeId: string,
): Set<string> {
  const parentIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.target === nodeId) {
      parentIds.add(edge.source);
    }
  }
  return parentIds;
}
