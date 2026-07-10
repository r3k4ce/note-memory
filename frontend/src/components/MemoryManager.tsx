import { Brain, Save, Trash2, X } from "lucide-react";
import { useState } from "react";

import {
  deleteAllMemories,
  deleteMemory,
  getMemorySettings,
  listMemories,
  updateMemory,
  updateMemorySettings,
} from "../api";
import type { MemoryRecord, MemorySettings } from "../types";

export function MemoryManager() {
  const [open, setOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openManager() {
    setOpen(true);
    setError(null);
    try {
      const [loadedMemories, loadedSettings] = await Promise.all([
        listMemories(),
        getMemorySettings(),
      ]);
      setMemories(loadedMemories);
      setSettings(loadedSettings);
    } catch {
      setError("Couldn't open memory right now.");
    }
  }

  async function saveMemory(memory: MemoryRecord) {
    const content = memory.content.trim();
    if (!content) return;
    try {
      const updated = await updateMemory(memory.id, content);
      setMemories((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      setError("Couldn't update that memory.");
    }
  }

  async function forgetMemory(memoryId: string) {
    try {
      await deleteMemory(memoryId);
      setMemories((current) => current.filter((memory) => memory.id !== memoryId));
    } catch {
      setError("Couldn't forget that memory.");
    }
  }

  async function forgetEverything() {
    if (!window.confirm("Forget every learned memory? This does not clear chat.")) return;
    try {
      await deleteAllMemories();
      setMemories([]);
    } catch {
      setError("Couldn't forget everything.");
    }
  }

  async function toggleLearning(enabled: boolean) {
    try {
      setSettings(await updateMemorySettings(enabled));
    } catch {
      setError("Couldn't change memory settings.");
    }
  }

  return (
    <div className="relative ml-auto">
      <button
        aria-label="Manage memory"
        className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
        onClick={() => void openManager()}
        type="button"
      >
        <Brain size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-30 w-80 rounded-xl border border-border bg-bg p-3 shadow-elevated">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-text-primary">Bun's memory</h3>
            <button aria-label="Close memory" className="ml-auto p-1" onClick={() => setOpen(false)} type="button">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
            <input
              aria-label="Learn from chats"
              checked={settings?.learning_enabled ?? false}
              disabled={!settings?.available}
              onChange={(event) => void toggleLearning(event.target.checked)}
              type="checkbox"
            />
            Learn from chats
          </label>
          {!settings?.available && settings ? (
            <p className="mt-2 text-xs text-text-muted">Memory is unavailable until it is enabled with an OpenAI key.</p>
          ) : null}
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {memories.map((memory) => (
              <div className="rounded-lg border border-border p-2" key={memory.id}>
                <textarea
                  aria-label="Memory content"
                  className="surface-input min-h-16 w-full resize-y bg-bg p-2 text-sm"
                  onChange={(event) =>
                    setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, content: event.target.value } : item))
                  }
                  value={memory.content}
                />
                <div className="mt-1 flex justify-end gap-1">
                  <button aria-label="Save memory" className="p-1 text-accent" onClick={() => void saveMemory(memory)} type="button">
                    <Save size={13} aria-hidden="true" />
                  </button>
                  <button aria-label="Forget memory" className="p-1 text-error" onClick={() => void forgetMemory(memory.id)} type="button">
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
            {memories.length === 0 && settings ? <p className="text-xs text-text-muted">No learned memories yet.</p> : null}
          </div>
          {error ? <p className="mt-2 text-xs text-error">{error}</p> : null}
          <button className="mt-3 text-xs font-medium text-error" onClick={() => void forgetEverything()} type="button">
            Forget everything
          </button>
        </div>
      ) : null}
    </div>
  );
}
