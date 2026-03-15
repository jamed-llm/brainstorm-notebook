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
- If this is an entirely new topic with no connection, parents should be an empty array (new root node).
- Do not include more than 3 parents total.`;
}
