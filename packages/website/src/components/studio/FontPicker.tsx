import { useCallback, useMemo, useRef, useState } from 'react';
import { EXAMPLE_FONTS, type ParsedFontInfo } from 'tegaki-generator';
import { CheckIcon, ChevronDownIcon, SearchIcon, UploadIcon } from './icons.tsx';
import { cx, Popover, Spinner } from './ui.tsx';

type FontListEntry = { family: string; category: string };

/** Lazily fetched Google Fonts catalog (via Fontsource) for the search box. */
function useFontCatalog() {
  const [fonts, setFonts] = useState<FontListEntry[]>([]);
  const fetched = useRef(false);
  const ensure = useCallback(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetch('https://api.fontsource.org/v1/fonts?type=google')
      .then((r) => r.json())
      .then((data: FontListEntry[]) => setFonts(data.map((f) => ({ family: f.family, category: f.category }))))
      .catch(() => {
        fetched.current = false;
      });
  }, []);
  return { fonts, ensure };
}

export function FontPicker({
  family,
  fontInfo,
  loading,
  error,
  onPickFamily,
  onPickFile,
}: {
  family: string;
  fontInfo: ParsedFontInfo | null;
  loading: boolean;
  error: string;
  /** `featured` is true for the curated example list (which also swaps in a sample phrase). */
  onPickFamily: (family: string, featured: boolean) => void;
  onPickFile: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const { fonts, ensure } = useFontCatalog();
  const fileRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EXAMPLE_FONTS.map((f) => ({ family: f, category: 'featured' }));
    const fromCatalog = fonts.filter((f) => f.family.toLowerCase().includes(q)).slice(0, 30);
    if (fromCatalog.length > 0) return fromCatalog;
    return EXAMPLE_FONTS.filter((f) => f.toLowerCase().includes(q)).map((f) => ({ family: f, category: 'featured' }));
  }, [query, fonts]);

  const pick = (f: string, featured: boolean) => {
    onPickFamily(f, featured);
    setOpen(false);
    setQuery('');
  };

  const currentName = fontInfo?.family ?? family;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) ensure();
      }}
      panelClassName="w-80"
      fullWidthOnMobile
      trigger={({ open: isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className={cx(
            'flex h-8 max-w-full min-w-0 items-center gap-2 rounded-md border px-2.5 text-left text-[13px] transition-colors',
            'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700',
            isOpen && 'border-zinc-300 dark:border-zinc-700',
          )}
        >
          <span className="text-[11px] font-medium text-zinc-400 max-sm:hidden">Font</span>
          <span className="min-w-0 flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">{currentName}</span>
          {loading ? (
            <Spinner className="size-3 text-zinc-400" />
          ) : error ? (
            <span className="size-1.5 rounded-full bg-red-500" title={error} />
          ) : null}
          <ChevronDownIcon size={14} className="shrink-0 text-zinc-400" />
        </button>
      )}
    >
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <SearchIcon size={14} className="shrink-0 text-zinc-400" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              const hit = results[active];
              if (hit) pick(hit.family, hit.category === 'featured');
              else if (query.trim()) pick(query.trim(), false);
            }
          }}
          placeholder="Search Google Fonts…"
          className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>
      <div className="max-h-[min(22rem,55vh)] overflow-y-auto p-1">
        {!query.trim() && <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-zinc-400">Featured handwriting fonts</div>}
        {results.map((f, i) => {
          const selected = f.family === currentName;
          return (
            <button
              type="button"
              key={f.family}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(f.family, f.category === 'featured')}
              className={cx(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]',
                i === active ? 'bg-zinc-100 dark:bg-zinc-800' : '',
                'text-zinc-700 dark:text-zinc-300',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{f.family}</span>
              {query.trim() && <span className="text-[11px] text-zinc-400">{f.category}</span>}
              {selected && <CheckIcon size={14} className="text-zinc-900 dark:text-zinc-100" />}
            </button>
          );
        })}
        {results.length === 0 && query.trim() && (
          <button
            type="button"
            onClick={() => pick(query.trim(), false)}
            className="flex h-8 w-full items-center rounded-md bg-zinc-100 px-2 text-left text-[13px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            Load “{query.trim()}”
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <UploadIcon size={14} />
          Upload .ttf / .otf
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.woff"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onPickFile(file);
              setOpen(false);
            }
            e.target.value = '';
          }}
        />
        {fontInfo && (
          <span className="ml-auto truncate text-[11px] text-zinc-400" title={`${fontInfo.family} ${fontInfo.style}`}>
            {fontInfo.unitsPerEm} UPM · {fontInfo.lineCap} caps
          </span>
        )}
      </div>
      {error && (
        <p className="border-t border-zinc-200 px-3 py-2 text-[11px] text-red-600 dark:border-zinc-800 dark:text-red-400">{error}</p>
      )}
    </Popover>
  );
}
