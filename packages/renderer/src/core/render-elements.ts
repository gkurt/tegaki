import { CSS_DURATION, CSS_PROGRESS, CSS_TIME } from '../lib/css-properties.ts';
import { computeTimeline } from '../lib/timeline.ts';
import { cssFontFamily } from '../lib/utils.ts';
import { resolveBundle } from './bundle-registry.ts';
import type { CreateElementFn, TegakiEngineOptions } from './types.ts';

export const PAD_V_CSS = 'max(0.2em, 0.9em - 0.5lh)';

export function buildRootProps(options: TegakiEngineOptions): Record<string, any> {
  const text = options.text ?? '';
  const font = resolveBundle(options.font);
  const fontFamily = font ? cssFontFamily(font) : undefined;

  const duration = text && font ? computeTimeline(text, font, options.timing).totalDuration : 0;
  const timeObj = typeof options.time === 'object' ? options.time : null;
  const rawTime =
    typeof options.time === 'number'
      ? options.time
      : timeObj?.mode === 'controlled'
        ? timeObj.unit === 'progress'
          ? timeObj.value * duration
          : timeObj.value
        : timeObj?.mode === 'uncontrolled'
          ? (timeObj.initialTime ?? 0)
          : 0;
  const easing = timeObj?.mode === 'uncontrolled' ? timeObj.easing : undefined;
  const time = easing && duration > 0 ? easing(rawTime / duration) * duration : rawTime;
  const progress = duration > 0 ? time / duration : 0;

  return {
    'data-tegaki': 'root',
    dir: options?.direction ?? 'auto',
    style: {
      position: 'relative',
      maxWidth: '100%',
      width: 'auto',
      height: 'auto',
      fontFamily,
      direction: options.direction ?? undefined,
      [CSS_DURATION]: duration,
      [CSS_TIME]: time,
      [CSS_PROGRESS]: progress,
    },
  };
}

export function buildChildren<T>(options: TegakiEngineOptions, h: CreateElementFn<T>): T {
  const text = options.text ?? '';
  const isCss = options.time === 'css' || (typeof options.time === 'object' && options.time?.mode === 'css');
  const showOverlay = options.showOverlay;

  return h(
    'span',
    { style: { display: 'block', position: 'relative' } },
    h('span', {
      'data-tegaki': 'sentinel',
      'aria-hidden': 'true',
      style: {
        position: 'absolute',
        width: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        visibility: 'hidden',
        transition: isCss
          ? `font-size 0.001s, line-height 0.001s, color 0.001s, ${CSS_PROGRESS} 0.001s`
          : 'font-size 0.001s, line-height 0.001s, color 0.001s',
      },
    }),
    h(
      'canvas',
      {
        'data-tegaki': 'canvas',
        'aria-hidden': 'true',
        style: {
          // `inset` shorthand not supported by Safari < 14.1 — expand to longhand.
          position: 'absolute',
          top: `calc(-1 * ${PAD_V_CSS})`,
          right: '-0.2em',
          bottom: `calc(-1 * ${PAD_V_CSS})`,
          left: '-0.2em',
          width: 'calc(100% + 0.4em)',
          height: `calc(100% + 2 * ${PAD_V_CSS})`,
          pointerEvents: 'none',
          overflow: 'visible',
        },
      },
      h(
        'span',
        {
          'data-tegaki': 'canvas-fallback',
          style: { display: 'inline-block', padding: `${PAD_V_CSS} 0.2em` },
        },
        text,
      ),
    ),
    h(
      'span',
      {
        'data-tegaki': 'overlay',
        style: {
          display: 'block',
          userSelect: 'auto',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          paddingInlineEnd: 1,
          textRendering: 'geometricPrecision',
          WebkitTextFillColor: showOverlay ? undefined : 'transparent',
          color: showOverlay ? 'rgba(255, 0, 0, 0.4)' : undefined,
        },
      },
      text,
    ),
  );
}

// ---------------------------------------------------------------------------
// DOM createElement helper (for vanilla JS constructor)
// ---------------------------------------------------------------------------

export function domCreateElement(tag: string, props: Record<string, any>, ...children: (HTMLElement | string)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'style' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, any>)) {
        if (v !== undefined && v !== null) {
          if (k.startsWith('--')) {
            el.style.setProperty(k, String(v));
          } else {
            (el.style as any)[k] = typeof v === 'number' && k !== 'opacity' && k !== 'zIndex' ? `${v}px` : v;
          }
        }
      }
    } else if (key === 'aria-hidden') {
      el.setAttribute('aria-hidden', String(value));
    } else if (key.startsWith('data-')) {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }
  return el;
}
