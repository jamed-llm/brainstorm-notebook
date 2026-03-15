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
