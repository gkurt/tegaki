import { useRef, useState } from 'react';
import { drawnDatasets, useDrawnDatasets } from '../../preview/drawn-datasets.ts';
import { DownloadIcon, PenIcon, PlusIcon, TrashIcon, UploadIcon } from '../icons.tsx';
import { Chip, cx, IconButton } from '../ui.tsx';

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'strokes';

/** Saves `text` as a file the browser downloads. */
function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The drawn datasets in Pipeline › References: each switched on or off like a
 * built-in one, the one strokes are drawn into marked, and New / Upload /
 * Download / Rename / Delete.
 */
export function DrawnDatasets() {
  const { entries, selectedId } = useDrawnDatasets();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    try {
      drawnDatasets.upload(await file.text());
      setError('');
    } catch (e) {
      setError(`${file.name}: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 px-1 pt-1">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Drawn by hand</span>
        <span className="ml-auto flex items-center">
          <IconButton label="New drawn dataset" className="size-6" onClick={() => drawnDatasets.create()}>
            <PlusIcon size={12} />
          </IconButton>
          <IconButton label="Upload a drawn dataset (.json)" className="size-6" onClick={() => fileRef.current?.click()}>
            <UploadIcon size={12} />
          </IconButton>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          multiple
          className="hidden"
          onChange={async (e) => {
            for (const file of e.target.files ?? []) await upload(file);
            e.target.value = '';
          }}
        />
      </div>
      {entries.map((entry) => {
        const { id, enabled, dataset } = entry;
        const count = Object.keys(dataset.glyphs).length;
        const isSelected = id === selectedId;
        return (
          <div key={id} className="flex min-w-0 items-center gap-1">
            {editing === id ? (
              <input
                autoFocus
                aria-label="Dataset name"
                defaultValue={dataset.name}
                className="h-6 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                onBlur={(e) => {
                  drawnDatasets.rename(id, e.target.value);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <Chip
                selected={enabled}
                title={`${enabled ? 'On' : 'Off'} — ${count} glyph${count === 1 ? '' : 's'} drawn. Click to switch ${enabled ? 'off' : 'on'}; double-click to rename.`}
                onClick={() => drawnDatasets.setEnabled(id, !enabled)}
                onDoubleClick={() => setEditing(id)}
              >
                {dataset.name}
              </Chip>
            )}
            <span className="shrink-0 font-mono text-[10px] text-zinc-400">{count}</span>
            <span className="ml-auto flex shrink-0 items-center">
              <IconButton
                label={isSelected ? 'Strokes drawn in Glyphs › Reference go here' : 'Draw into this dataset'}
                active={isSelected}
                className={cx('size-6', !isSelected && 'opacity-60')}
                onClick={() => drawnDatasets.select(id)}
              >
                <PenIcon size={11} />
              </IconButton>
              <IconButton
                label="Download (.json)"
                className="size-6"
                onClick={() => download(drawnDatasets.serialize(id), `${slug(dataset.name)}.strokes.json`)}
              >
                <DownloadIcon size={12} />
              </IconButton>
              <IconButton
                label="Delete"
                className="size-6"
                onClick={() => {
                  if (
                    count === 0 ||
                    window.confirm(
                      `Delete "${dataset.name}" and its ${count} drawn glyph${count === 1 ? '' : 's'}? Download it first to keep a copy.`,
                    )
                  ) {
                    drawnDatasets.remove(id);
                  }
                }}
              >
                <TrashIcon size={12} />
              </IconButton>
            </span>
          </div>
        );
      })}
      {entries.length === 0 && (
        <p className="px-1 text-[11px] text-zinc-400">None yet — draw one in Glyphs › Reference, or upload a downloaded one.</p>
      )}
      {error && <p className="px-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
