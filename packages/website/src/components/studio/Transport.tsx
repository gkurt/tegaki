import type { ReactNode } from 'react';
import { PauseIcon, PlayIcon, RestartIcon } from './icons.tsx';
import { IconButton } from './ui.tsx';

/** Play/pause + scrubber for a seekable timeline. */
export function Transport({
  time,
  duration,
  playing,
  onPlayPause,
  onRestart,
  onSeek,
  trailing,
}: {
  time: number;
  duration: number;
  playing: boolean;
  onPlayPause: () => void;
  onRestart: () => void;
  onSeek: (t: number) => void;
  trailing?: ReactNode;
}) {
  const pct = duration > 0 ? Math.min(time / duration, 1) * 100 : 0;
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-t border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-900">
      <IconButton label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={onPlayPause} disabled={duration <= 0}>
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </IconButton>
      <IconButton label="Back to start" onClick={onRestart} disabled={duration <= 0}>
        <RestartIcon size={14} />
      </IconButton>
      <input
        type="range"
        aria-label="Timeline position"
        className="studio-scrubber mx-2 min-w-0 flex-1"
        min={0}
        max={duration || 1}
        step={0.0001}
        value={Math.min(time, duration)}
        disabled={duration <= 0}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span className="shrink-0 font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
        {time.toFixed(2)}
        <span className="text-zinc-300 dark:text-zinc-600"> / </span>
        {duration.toFixed(2)}s
      </span>
      {trailing}
    </div>
  );
}
