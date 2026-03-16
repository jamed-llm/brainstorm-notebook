export type ExtensionMessage =
  | { type: 'TOGGLE_PANEL' }
  | { type: 'ANALYZE_TURN'; payload: AnalyzeTurnPayload }
  | { type: 'ANALYZE_TURN_RESULT'; payload: AnalyzeTurnResult }
  | { type: 'ANALYZE_BATCH'; payload: AnalyzeBatchPayload }
  | { type: 'ANALYZE_BATCH_RESULT'; payload: AnalyzeBatchResult }
  | { type: 'API_ERROR'; error: string };

export interface AnalyzeTurnPayload {
  existingNodes: { id: string; title: string; summary: string }[];
  humanMessage: string;
  assistantMessage: string;
}

export interface AnalyzeTurnResult {
  title: string;
  summary: string;
  parents: { nodeId: string; strength: 'strong' | 'middle' | 'thin' }[];
}

export interface AnalyzeBatchPayload {
  turns: { index: number; human: string; assistant: string }[];
}

export interface AnalyzeBatchResult {
  nodes: {
    index: number;
    title: string;
    summary: string;
    parents: { index: number; strength: 'strong' | 'middle' | 'thin' }[];
  }[];
}
