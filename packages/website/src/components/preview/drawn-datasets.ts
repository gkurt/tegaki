import { useSyncExternalStore } from 'react';
import {
  createDrawnDataset,
  createDrawnDatasetProvider,
  DRAWN_DATASET_FORMAT,
  type DrawnDataset,
  parseDrawnDataset,
  type StrokeOrderProvider,
} from 'tegaki-generator';

// The stroke-order datasets drawn by hand in the Studio's Reference stage.
// They live in this browser's localStorage, not the URL (they're far too big
// for one), so /studio and /preview on the same origin share them; the file
// Download writes is how they travel — Upload here, `--reference-file` in the
// CLI. Switched on, they order the characters they have ahead of the built-in
// datasets (see createReferenceSet); strokes drawn go to the selected one.

const STORAGE_KEY = 'tegaki-studio:drawn-datasets';

export interface DrawnDatasetEntry {
  /** Local id (the dataset's name can change). */
  id: string;
  enabled: boolean;
  dataset: DrawnDataset;
}

export interface DrawnDatasetsState {
  entries: DrawnDatasetEntry[];
  /** The dataset strokes are drawn into. */
  selectedId: string | null;
  /** Bumped on every change — what refetches the references. */
  revision: number;
}

type Stroke = [number, number][];

const EMPTY: DrawnDatasetsState = { entries: [], selectedId: null, revision: 0 };

let state: DrawnDatasetsState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function read(): DrawnDatasetsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const stored = JSON.parse(raw) as { entries?: unknown; selectedId?: unknown };
    const entries: DrawnDatasetEntry[] = [];
    for (const e of Array.isArray(stored.entries) ? stored.entries : []) {
      try {
        const dataset = parseDrawnDataset(JSON.stringify(e?.dataset));
        entries.push({ id: String(e.id), enabled: e.enabled !== false, dataset });
      } catch {
        // A damaged entry is dropped rather than taking the rest with it.
      }
    }
    const selectedId = entries.some((e) => e.id === stored.selectedId) ? (stored.selectedId as string) : (entries[0]?.id ?? null);
    return { entries, selectedId, revision: state.revision + 1 };
  } catch {
    return EMPTY;
  }
}

function ensureLoaded() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  state = read();
  // Another tab drew or uploaded something.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    state = read();
    for (const l of listeners) l();
  });
}

function commit(next: Omit<DrawnDatasetsState, 'revision'>) {
  state = { ...next, revision: state.revision + 1 };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: state.entries, selectedId: state.selectedId }));
  } catch {
    // Storage full or blocked: the datasets still work for this session.
  }
  for (const l of listeners) l();
}

export function getDrawnDatasets(): DrawnDatasetsState {
  ensureLoaded();
  return state;
}

function subscribe(listener: () => void) {
  ensureLoaded();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The drawn datasets, re-rendering on every change. */
export function useDrawnDatasets(): DrawnDatasetsState {
  return useSyncExternalStore(subscribe, getDrawnDatasets, () => EMPTY);
}

/** A name no other drawn dataset has: `name`, else `name 2`, `name 3`… */
function uniqueName(name: string, exceptId?: string): string {
  const taken = new Set(state.entries.filter((e) => e.id !== exceptId).map((e) => e.dataset.name));
  const base = name.trim() || 'My hand';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

const newId = () => Math.random().toString(36).slice(2, 10);

function update(id: string, change: (dataset: DrawnDataset) => DrawnDataset) {
  commit({ ...state, entries: state.entries.map((e) => (e.id === id ? { ...e, dataset: change(e.dataset) } : e)) });
}

function updateGlyph(id: string, char: string, change: (strokes: Stroke[]) => Stroke[]) {
  update(id, (dataset) => {
    const { [char]: strokes = [], ...rest } = dataset.glyphs;
    const next = change(strokes);
    return { ...dataset, glyphs: next.length > 0 ? { ...rest, [char]: next } : rest };
  });
}

export const drawnDatasets = {
  /** A new empty dataset, switched on and selected. */
  create(name = 'My hand'): string {
    ensureLoaded();
    const id = newId();
    commit({ entries: [...state.entries, { id, enabled: true, dataset: createDrawnDataset(uniqueName(name)) }], selectedId: id });
    return id;
  },
  /** Adds a downloaded dataset (renamed if the name is taken), switched on and selected. */
  upload(json: string): string {
    ensureLoaded();
    const dataset = parseDrawnDataset(json);
    const id = newId();
    commit({
      entries: [...state.entries, { id, enabled: true, dataset: { ...dataset, name: uniqueName(dataset.name) } }],
      selectedId: id,
    });
    return id;
  },
  remove(id: string) {
    const entries = state.entries.filter((e) => e.id !== id);
    commit({ entries, selectedId: state.selectedId === id ? (entries[0]?.id ?? null) : state.selectedId });
  },
  rename(id: string, name: string) {
    update(id, (dataset) => ({ ...dataset, name: uniqueName(name, id) }));
  },
  setEnabled(id: string, enabled: boolean) {
    commit({ ...state, entries: state.entries.map((e) => (e.id === id ? { ...e, enabled } : e)) });
  },
  select(id: string) {
    commit({ ...state, selectedId: id });
  },
  addStroke(id: string, char: string, stroke: Stroke) {
    updateGlyph(id, char, (strokes) => [...strokes, stroke]);
  },
  undoStroke(id: string, char: string) {
    updateGlyph(id, char, (strokes) => strokes.slice(0, -1));
  },
  clearGlyph(id: string, char: string) {
    updateGlyph(id, char, () => []);
  },
  /** The file Download writes: one glyph per line, so it reads (and diffs) glyph by glyph. */
  serialize(id: string): string {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) throw new Error(`No drawn dataset ${id}`);
    const { glyphs, ...head } = entry.dataset;
    const fields = Object.entries({ ...head, format: DRAWN_DATASET_FORMAT }).map(
      ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`,
    );
    const lines = Object.entries(glyphs).map(([char, strokes]) => `    ${JSON.stringify(char)}: ${JSON.stringify(strokes)}`);
    return `{\n${fields.join('\n')}\n  "glyphs": {${lines.length > 0 ? `\n${lines.join(',\n')}\n  ` : ''}}\n}\n`;
  },
};

// One live provider per dataset, reading its current strokes on every lookup.
const providers = new Map<string, StrokeOrderProvider>();

function providerFor(id: string): StrokeOrderProvider {
  let provider = providers.get(id);
  if (!provider) {
    provider = createDrawnDatasetProvider(() => state.entries.find((e) => e.id === id)?.dataset ?? null);
    providers.set(id, provider);
  }
  return provider;
}

/** Providers for the drawn datasets that are switched on. */
export function drawnProviders(): StrokeOrderProvider[] {
  return getDrawnDatasets()
    .entries.filter((e) => e.enabled)
    .map((e) => providerFor(e.id));
}

/** Which drawn datasets are on, for a reference set's key. */
export function drawnSetKey(): string {
  return getDrawnDatasets()
    .entries.filter((e) => e.enabled)
    .map((e) => e.id)
    .join(',');
}
