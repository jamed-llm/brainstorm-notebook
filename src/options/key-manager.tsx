import { useState, useRef } from 'preact/hooks';
import { ApiKeyEntry } from '../shared/types';

interface KeyManagerProps {
  keys: ApiKeyEntry[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function KeyManager({ keys, onToggle, onDelete, onReorder }: KeyManagerProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const sorted = [...keys].sort((a, b) => a.order - b.order);

  function onDragStart(e: DragEvent, index: number) {
    setDragIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  function onDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function onDragEnd() {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      onReorder(dragIndex, dragOverIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }

  if (sorted.length === 0) {
    return <div class="empty-state">No API keys added yet</div>;
  }

  return (
    <ul class="key-list">
      {sorted.map((key, index) => (
        <li
          key={key.id}
          class={`key-item${dragIndex === index ? ' dragging' : ''}${dragOverIndex === index ? ' drag-over' : ''}`}
          draggable
          onDragStart={(e) => onDragStart(e as unknown as DragEvent, index)}
          onDragOver={(e) => onDragOver(e as unknown as DragEvent, index)}
          onDragEnd={onDragEnd}
        >
          <span class="drag-handle">:::</span>
          <input
            type="checkbox"
            checked={key.enabled}
            onChange={() => onToggle(key.id)}
          />
          <span class="key-name">{key.name}</span>
          <span class="key-preview">****{key.id.slice(-4)}</span>
          <button class="danger" onClick={() => onDelete(key.id)}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
