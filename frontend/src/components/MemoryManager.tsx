import { Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  deleteAllMemories,
  deleteMemory,
  getMemorySettings,
  listMemories,
  updateMemory,
  updateMemorySettings,
} from "../api";
import type { MemoryRecord, MemorySettings as MemorySettingsState } from "../types";

export function MemorySettings() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [settings, setSettings] = useState<MemorySettingsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function loadMemory() {
      setError(null);
      setIsLoading(true);
      try {
        const [loadedMemories, loadedSettings] = await Promise.all([listMemories(), getMemorySettings()]);
        if (active) {
          setMemories(loadedMemories);
          setSettings(loadedSettings);
        }
      } catch {
        if (active) setError("Couldn't open memory right now.");
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void loadMemory();
    return () => { active = false; };
  }, []);

  async function saveMemory(memory: MemoryRecord) {
    const content = memory.content.trim();
    if (!content) return;
    try {
      const updated = await updateMemory(memory.id, content);
      setMemories((current) => current.map((item) => item.id === updated.id ? updated : item));
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
    <section aria-labelledby="memory-settings-title" className="border-t border-border pt-6">
      <h3 className="font-semibold text-text-primary" id="memory-settings-title">Memory</h3>
      <p className="mt-1 text-xs text-text-muted">Manage what Bun learns from your chats.</p>

      {isLoading ? <p className="mt-4 text-sm text-text-muted">Loading memory…</p> : null}
      {!isLoading && settings ? (
        <>
          <label className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
            <input
              aria-label="Learn from chats"
              checked={settings.learning_enabled}
              disabled={!settings.available}
              onChange={(event) => void toggleLearning(event.target.checked)}
              type="checkbox"
            />
            Learn from chats
          </label>
          {!settings.available ? (
            <p className="mt-2 text-xs text-text-muted">Memory is unavailable until it is enabled with an OpenAI key.</p>
          ) : null}
          <div className="mt-4 space-y-2">
            {memories.map((memory) => (
              <div className="rounded-lg border border-border p-2" key={memory.id}>
                <textarea
                  aria-label="Memory content"
                  className="surface-input min-h-16 w-full resize-y bg-bg p-2 text-sm"
                  onChange={(event) => setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, content: event.target.value } : item))}
                  value={memory.content}
                />
                <div className="mt-1 flex justify-end gap-1">
                  <button aria-label="Save memory" className="rounded p-1 text-accent hover:bg-accent-muted" onClick={() => void saveMemory(memory)} type="button">
                    <Save size={13} aria-hidden="true" />
                  </button>
                  <button aria-label="Forget memory" className="rounded p-1 text-error hover:bg-error-muted" onClick={() => void forgetMemory(memory.id)} type="button">
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
            {memories.length === 0 ? <p className="text-xs text-text-muted">No learned memories yet.</p> : null}
          </div>
          <button className="mt-4 text-xs font-medium text-error" onClick={() => void forgetEverything()} type="button">
            Forget everything
          </button>
        </>
      ) : null}
      {error ? <p className="mt-3 text-xs text-error">{error}</p> : null}
    </section>
  );
}
