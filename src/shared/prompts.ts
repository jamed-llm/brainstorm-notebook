export function buildNodeAnalysisPrompt(
  existingNodes: { id: string; title: string; summary: string }[],
  humanMessage: string,
  assistantMessage: string,
): string {
  const nodesSection =
    existingNodes.length > 0
      ? existingNodes.map((n) => `- [${n.id}] "${n.title}": ${n.summary}`).join('\n')
      : '(none — this is the first turn)';

  return `You are analyzing a conversation turn to build a mind-map graph.

Existing nodes:
${nodesSection}

New conversation turn:
Human: ${humanMessage}
Assistant: ${assistantMessage}

Respond with ONLY valid JSON, no other text:
{
  "title": "short phrase describing this turn (max 6 words)",
  "summary": "one sentence summary of this turn",
  "parents": [
    { "nodeId": "id of parent node or LAST for the immediately previous turn", "strength": "strong|middle|thin" }
  ]
}

Rules for deciding parents:
- First decide if this turn directly continues the immediately previous turn. If yes, include it with "strong" strength and nodeId "LAST".
- Then check if this turn relates to any earlier nodes. Add them with "middle" or "thin" based on relevance strength.
- If this is an entirely new topic with no connection to ANY existing node, parents MUST be an empty array []. This creates a new root node at the top level of the graph. Do not force a connection — only connect nodes that are genuinely related in topic or context.
- Do not include more than 3 parents total.
- It is completely fine and expected to have multiple root nodes (empty parents). A conversation often covers several unrelated topics.`;
}

export interface BatchTurn {
  index: number;
  human: string;
  assistant: string;
}

export interface BatchNode {
  index: number;
  title: string;
  summary: string;
  parents: { index: number; strength: 'strong' | 'middle' | 'thin' }[];
}

export function buildBatchAnalysisPrompt(turns: BatchTurn[]): string {
  const turnsSection = turns
    .map((t) => `[Turn ${t.index}]\nHuman: ${t.human}\nAssistant: ${t.assistant}`)
    .join('\n\n');

  return `You are analyzing a conversation to build a mind-map graph. Below are all the turns. For each turn, decide a short title, a one-sentence summary, and which earlier turns it connects to.

${turnsSection}

Respond with ONLY a valid JSON array, no other text:
[
  {
    "index": 0,
    "title": "short phrase (max 6 words)",
    "summary": "one sentence summary",
    "parents": [
      { "index": 1, "strength": "strong|middle|thin" }
    ]
  }
]

Rules:
- "parents" references earlier turn indices that this turn is related to. Use "strong" for direct continuation, "middle" for same topic, "thin" for loosely related.
- If a turn starts an entirely new topic with no connection to ANY prior turn, parents MUST be an empty array []. Do not force connections.
- It is completely fine and expected to have multiple root nodes (empty parents). Conversations often cover several unrelated topics.
- Max 3 parents per node.
- Every turn in the conversation must appear exactly once in the output array, in order.`;
}

export function buildMergePrompt(
  allNodes: { index: number; title: string; summary: string }[],
  existingEdges: { source: number; target: number; strength: 'strong' | 'middle' | 'thin' }[],
): string {
  const nodesSection = allNodes
    .map((n) => `[${n.index}] "${n.title}": ${n.summary}`)
    .join('\n');

  const edgesSection = existingEdges
    .map((e) => `${e.source} -> ${e.target} (${e.strength})`)
    .join('\n');

  return `You are reviewing a mind-map built from a conversation. The nodes were analyzed in chunks, so cross-chunk connections may be missing. Review ALL nodes and add any missing connections.

Nodes:
${nodesSection}

Existing edges:
${edgesSection || '(none)'}

Respond with ONLY a valid JSON array of NEW edges to add (do not repeat existing edges). If no new edges are needed, respond with [].
[
  { "source": 0, "target": 5, "strength": "middle|thin" }
]

Rules:
- Only add edges where there is a genuine topical relationship.
- Do not duplicate existing edges.
- Use "middle" for same topic discussed in different parts of the conversation, "thin" for loosely related.
- Do not add "strong" edges — those were already determined within chunks.
- It is fine to return an empty array if no cross-connections exist.`;
}
