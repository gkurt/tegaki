import { useCallback, useEffect, useRef, useState } from 'react';
import { type ParsedFontInfo, parseFont } from 'tegaki-generator';
import { fetchFontFromCDN } from '../preview/font-cdn.ts';
import { parseUrlState, syncUrlState, type UrlState } from '../url-state.ts';

export type SetSetting = <K extends keyof UrlState>(key: K, value: UrlState[K] | ((prev: UrlState[K]) => UrlState[K])) => void;

/**
 * Every URL-persisted studio setting in one object, parsed once from the URL
 * on mount and written back (debounced, so slider drags don't thrash history)
 * whenever it changes.
 */
export function useStudioSettings() {
  const [settings, setSettings] = useState<UrlState>(parseUrlState);
  const set = useCallback<SetSetting>((key, value) => {
    setSettings((prev) => {
      const next = typeof value === 'function' ? (value as (p: UrlState[typeof key]) => UrlState[typeof key])(prev[key]) : value;
      return Object.is(next, prev[key]) ? prev : { ...prev, [key]: next };
    });
  }, []);
  useEffect(() => {
    const id = setTimeout(() => syncUrlState(settings), 300);
    return () => clearTimeout(id);
  }, [settings]);
  return { settings, set, setSettings };
}

export interface LoadedFont {
  info: ParsedFontInfo;
  buffer: ArrayBuffer;
  extraBuffers: ArrayBuffer[] | undefined;
  /** Set when the font was uploaded rather than fetched from Google Fonts. */
  fileName?: string;
}

/**
 * Font loading from Google Fonts (via the CDN) or a local file. Each load takes
 * a ticket; a load that finishes after a newer one started (fonts fetch at very
 * different speeds) is dropped rather than replacing the newer font.
 */
export function useFontLoader(onLoaded: (font: LoadedFont) => void) {
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const run = useCallback(async (load: () => Promise<LoadedFont>) => {
    const ticket = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const loaded = await load();
      if (ticket !== seq.current) return;
      setFont(loaded);
      onLoadedRef.current(loaded);
    } catch (e) {
      if (ticket !== seq.current) return;
      setError((e as Error).message);
      setFont(null);
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  }, []);

  const loadFamily = useCallback(
    (family: string) =>
      run(async () => {
        const { primary, extra } = await fetchFontFromCDN(family);
        // Google Fonts' subsets carry no name table, so the family is passed in.
        const info = await parseFont(primary, extra.length > 0 ? extra : undefined, family);
        return { info, buffer: primary, extraBuffers: extra.length > 0 ? extra : undefined };
      }),
    [run],
  );

  const loadFile = useCallback(
    (file: File) =>
      run(async () => {
        const buffer = await file.arrayBuffer();
        const info = await parseFont(buffer);
        return { info, buffer, extraBuffers: undefined, fileName: file.name };
      }),
    [run],
  );

  return { font, loading, error, loadFamily, loadFile };
}

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * The page theme, shared with the docs: Starlight keeps the choice in
 * `localStorage['starlight-theme']` ('' = follow the system) and mirrors it on
 * `<html data-theme>`, which the studio page seeds before first paint.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      let stored = '';
      try {
        stored = localStorage.getItem('starlight-theme') ?? '';
      } catch {}
      if (stored) return;
      applyTheme(mql.matches ? 'dark' : 'light');
      setThemeState(currentTheme());
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('starlight-theme', next);
    } catch {}
    setThemeState(next);
  }, []);
  return { theme, toggle };
}
