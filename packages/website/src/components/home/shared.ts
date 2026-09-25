import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react';
import type { TegakiBundle } from 'tegaki';
import { TegakiEngine } from 'tegaki/core';
import harfbuzzShaper from 'tegaki/shaper-harfbuzz';

// Every home-page island imports this module, so the shaper registers once for
// the page. It's what gives Amiri its positional forms and Caveat its `calt`
// alternates — without it those bundles draw only the nominal glyphs.
TegakiEngine.registerShaper(harfbuzzShaper);

const FONT_IMPORTS = {
  Caveat: () => import('tegaki/fonts/caveat'),
  Italianno: () => import('tegaki/fonts/italianno'),
  Tangerine: () => import('tegaki/fonts/tangerine'),
  Parisienne: () => import('tegaki/fonts/parisienne'),
  'Suez One': () => import('tegaki/fonts/suez-one'),
  Amiri: () => import('tegaki/fonts/amiri'),
  Tillana: () => import('tegaki/fonts/tillana'),
  Atma: () => import('tegaki/fonts/atma'),
  'Klee One': () => import('tegaki/fonts/klee-one'),
  'Nanum Pen Script': () => import('tegaki/fonts/nanum-pen-script'),
  'LXGW WenKai': () => import('tegaki/fonts/lxgw-wenkai'),
} as const;

export type FontName = keyof typeof FONT_IMPORTS;

const loaded = new Map<FontName, TegakiBundle>();
const pending = new Map<FontName, Promise<TegakiBundle>>();

/** Load a bundled font once; later calls share the same promise. */
export function loadFont(name: FontName): Promise<TegakiBundle> {
  let promise = pending.get(name);
  if (!promise) {
    promise = FONT_IMPORTS[name]().then((mod) => {
      const bundle = mod.default as unknown as TegakiBundle;
      loaded.set(name, bundle);
      return bundle;
    });
    pending.set(name, promise);
  }
  return promise;
}

/** The bundle for `name` once it has loaded; `null` while loading or when `name` is `null`. */
export function useFont(name: FontName | null): TegakiBundle | null {
  const [state, setState] = useState<{ name: FontName; bundle: TegakiBundle } | null>(() => {
    const bundle = name ? loaded.get(name) : undefined;
    return name && bundle ? { name, bundle } : null;
  });

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    loadFont(name).then((bundle) => {
      if (!cancelled) setState({ name, bundle });
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return name && state?.name === name ? state.bundle : null;
}

/**
 * Whether the element is on screen. With `once`, it latches `true` the first
 * time it's seen — for loading and first draws; without it, it follows the
 * element in and out — for pausing loops nobody can see.
 */
export function useInView(ref: RefObject<Element | null>, { once = false, rootMargin = '0px', threshold = 0 } = {}): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, once, rootMargin, threshold]);

  return inView;
}

export type Theme = 'light' | 'dark';

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** The page's theme, from `<html data-theme>` (set before first paint and by the nav toggle). */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => 'light',
  );
}

/** The ink palette, mirrored from home.css for canvas effects (which can't read CSS variables). */
export const INK = {
  light: { ink: '#1c1d2b', seal: '#d33a26' },
  dark: { ink: '#f1e9da', seal: '#ff6a4d' },
} as const;

// The hero headline finishing is the cue for the rest of the fold to fetch its
// multi-MB bundles (Klee One, Nanum Pen Script), so they don't compete with it.
let headlineWritten = false;
const headlineListeners = new Set<() => void>();

export function markHeadlineWritten(): void {
  if (headlineWritten) return;
  headlineWritten = true;
  for (const listener of headlineListeners) listener();
}

/** Whether the hero headline has finished writing. */
export function useHeadlineWritten(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      headlineListeners.add(onChange);
      return () => headlineListeners.delete(onChange);
    },
    () => headlineWritten,
    () => false,
  );
}
