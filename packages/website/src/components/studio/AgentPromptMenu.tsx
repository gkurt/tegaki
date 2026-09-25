import { useEffect, useMemo, useState } from 'react';
import { CHARSET_PRESETS } from 'tegaki-generator';
import type { UrlState } from '../url-state.ts';
import { AGENT_GOALS, type AgentGoal, buildAgentPrompt } from './agent-prompt.ts';
import { type CharsetInfo, fontHasChar } from './charsets.ts';
import { CheckIcon, CopyIcon, SparklesIcon } from './icons.tsx';
import type { LoadedFont } from './state.ts';
import { cx, Hint, Popover, Segmented } from './ui.tsx';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const SITE_URL = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API blocked (permissions, insecure origin) — fall back to a selection copy.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/**
 * "Ask an agent": copies a prompt that hands a coding agent this font, the
 * studio's current state, and studio / preview links it can iterate on.
 */
export function AgentPromptMenu({
  open,
  onOpenChange: setOpen,
  font,
  settings,
  charsets,
  glyph,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  font: LoadedFont | null;
  settings: UrlState;
  charsets: CharsetInfo | null;
  glyph: { char: string; warnings: string[] } | null;
}) {
  const [goal, setGoal] = useState<AgentGoal>('generate');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);

  const prompt = useMemo(() => {
    if (!open) return '';
    const info = font?.info;
    const chars = [...segmenter.segment(settings.chars)].map((s) => s.segment);
    const hasChar = info ? fontHasChar(info) : null;
    return buildAgentPrompt({
      goal,
      note,
      settings,
      font: info
        ? {
            family: info.family,
            style: info.style,
            unitsPerEm: info.unitsPerEm,
            lineCap: info.lineCap,
            features: info.features,
            fileName: font?.fileName,
          }
        : null,
      charset: {
        preset: CHARSET_PRESETS.find((p) => p.chars === settings.chars)?.name ?? null,
        count: chars.length,
        mapped: hasChar ? chars.filter(hasChar).length : null,
        recommended: charsets?.recommended ?? null,
      },
      glyph,
      siteUrl: SITE_URL,
    });
  }, [open, goal, note, settings, font, charsets, glyph]);

  const placeholder = AGENT_GOALS.find((g) => g.value === goal)?.placeholder;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      panelClassName="w-[26rem]"
      fullWidthOnMobile
      trigger={({ open: isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          title="Copy a prompt for a coding agent"
          className={cx(
            'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors max-md:w-8 max-md:justify-center max-md:px-0 max-sm:hidden',
            'border-zinc-200 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
            isOpen && 'bg-zinc-100 dark:bg-zinc-800',
          )}
        >
          <SparklesIcon size={14} />
          <span className="max-md:hidden">Ask an agent</span>
        </button>
      )}
    >
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Agent prompt</span>
          <Hint>
            For Claude Code, Codex, Cursor and the like: it carries this font, your settings and live studio / preview links the agent can
            iterate on.
          </Hint>
        </div>
        <Segmented value={goal} onChange={setGoal} className="w-full [&>button]:flex-1" options={AGENT_GOALS} />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={placeholder}
          className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
        />
        <pre className="studio-scroll max-h-52 overflow-auto rounded-md bg-zinc-50 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-400 dark:ring-zinc-800">
          {prompt}
        </pre>
        <button
          type="button"
          onClick={() => copyText(prompt).then(() => setCopied(true))}
          className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-zinc-900 text-[13px] font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
    </Popover>
  );
}
