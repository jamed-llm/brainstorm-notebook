export interface GraphNode {
  id: string;
  messageIndex: number;
  title: string;
  summary: string;
  level: number;
  x: number;
  y: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  strength: 'strong' | 'middle' | 'thin';
}

export interface MindNoteGraph {
  conversationId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ApiKeyEntry {
  id: string;
  name: string;
  encryptedKey: string;
  iv: string;
  enabled: boolean;
  order: number;
}

export interface ApiKeyStore {
  keys: ApiKeyEntry[];
  salt: string;
}
