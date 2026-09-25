import { useEffect, useState } from 'react';
import type { ParsedFontInfo } from 'tegaki-generator';
import type { Pipeline, PreviewMode } from '../../preview/constants.ts';
import type { UrlState } from '../../url-state.ts';
import type { CharsetInfo } from '../charsets.ts';
import { CloseIcon } from '../icons.tsx';
import type { SetSetting } from '../state.ts';
import { cx, IconButton } from '../ui.tsx';
import { MotionPanel } from './MotionPanel.tsx';
import { PipelinePanel } from './PipelinePanel.tsx';
import { StylePanel } from './StylePanel.tsx';

type Tab = 'style' | 'motion' | 'pipeline';

const TABS: { key: Tab; label: string }[] = [
  { key: 'style', label: 'Style' },
  { key: 'motion', label: 'Motion' },
  { key: 'pipeline', label: 'Pipeline' },
];

/**
 * The properties panel. Style and Motion tune the renderer (text mode only);
 * Pipeline tunes stroke extraction and what goes into the bundle.
 */
export function Inspector({
  mode,
  settings,
  set,
  fontInfo,
  charsets,
  onPipelineChange,
  onClose,
  className,
}: {
  mode: PreviewMode;
  settings: UrlState;
  set: SetSetting;
  fontInfo: ParsedFontInfo | null;
  charsets: CharsetInfo | null;
  onPipelineChange: (p: Pipeline) => void;
  onClose?: () => void;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>(() => (mode === 'glyph' ? 'pipeline' : 'style'));
  // The glyph inspector has no renderer to style — only the pipeline applies.
  useEffect(() => {
    if (mode === 'glyph') setTab('pipeline');
  }, [mode]);
  const tabs = mode === 'glyph' ? TABS.filter((t) => t.key === 'pipeline') : TABS;

  return (
    <aside className={cx('flex min-h-0 flex-col bg-white dark:bg-zinc-900', className)} aria-label="Inspector">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-zinc-200 px-2 dark:border-zinc-800">
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
                tab === t.key
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {onClose && (
          <IconButton label="Close inspector" onClick={onClose}>
            <CloseIcon size={14} />
          </IconButton>
        )}
      </div>
      <div className="studio-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain" role="tabpanel">
        {tab === 'style' && <StylePanel settings={settings} set={set} />}
        {tab === 'motion' && <MotionPanel settings={settings} set={set} />}
        {tab === 'pipeline' && (
          <PipelinePanel settings={settings} set={set} fontInfo={fontInfo} charsets={charsets} onPipelineChange={onPipelineChange} />
        )}
      </div>
    </aside>
  );
}
