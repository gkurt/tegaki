import { useEffect, useRef } from 'react';
import { CloseIcon } from './icons.tsx';
import { SHORTCUT_GROUPS } from './shortcuts.ts';
import { IconButton } from './ui.tsx';

/** The keyboard shortcuts, grouped — opened with `?` or the top bar's keyboard button. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => opener?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4 backdrop-blur-[2px] dark:bg-black/50"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-shortcuts-title"
        tabIndex={-1}
        // Keys pressed here work the dialog, not the studio behind it.
        data-shortcuts="off"
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === '?') {
            e.preventDefault();
            onClose();
          }
        }}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex h-12 items-center border-b border-zinc-200 pr-2 pl-4 dark:border-zinc-800">
          <h2 id="studio-shortcuts-title" className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Keyboard shortcuts
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon size={16} />
          </IconButton>
        </div>
        <div className="flex flex-col gap-5 px-4 pt-3 pb-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase dark:text-zinc-500">{group.title}</h3>
              <dl className="flex flex-col">
                {group.items.map((item) => (
                  <div key={item.label} className="flex min-h-8 items-center gap-3 text-[13px]">
                    <dt className="flex-1 text-zinc-600 dark:text-zinc-300">{item.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                      {item.keys.map((combo, i) => (
                        <span key={combo.join('+')} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[11px] text-zinc-300 dark:text-zinc-600">/</span>}
                          {combo.map((k) => (
                            <kbd
                              key={k}
                              className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-b-2 border-zinc-200 bg-zinc-50 px-1.5 font-sans text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
