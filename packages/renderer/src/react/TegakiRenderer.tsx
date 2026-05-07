'use client';

import {
  type ComponentPropsWithoutRef,
  createElement,
  type ElementType,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { TegakiEngine } from '../core/engine.ts';
import type { TegakiEngineOptions } from '../core/types.ts';
import type { Coercible } from '../lib/utils.ts';
import { coerceToString } from '../lib/utils.ts';
import type { TegakiEffects } from '../types.ts';

/** Imperative handle exposed via the `ref` prop. */
export interface TegakiRendererHandle {
  /** The underlying engine instance. `null` before mount and after unmount. */
  readonly engine: TegakiEngine | null;
  /** The container DOM element. */
  readonly element: HTMLElement | null;
}

interface TegakiRendererBaseProps<E extends TegakiEffects<E> = Record<string, never>> extends Omit<TegakiEngineOptions, 'effects'> {
  /** Imperative handle ref for playback controls and DOM access. */
  ref?: Ref<TegakiRendererHandle>;

  /** Children coerced to string. Strings and numbers are kept; everything else is ignored. */
  children?: Coercible;

  /** Visual effects applied during canvas rendering. */
  effects?: E;

  /** When true, the rendered text is editable via contentEditable. */
  editable?: boolean;

  /** Called when the user edits the text (only when `editable` is true). */
  onTextChange?: (text: string) => void;
}

export type TegakiRendererProps<C extends ElementType = 'div', E extends TegakiEffects<E> = Record<string, never>> = {
  as?: C;
} & TegakiRendererBaseProps<E> &
  Omit<ComponentPropsWithoutRef<C>, keyof TegakiRendererBaseProps<Record<string, never>> | 'as'>;

function reactCreateElement(tag: string, props: Record<string, any>, ...children: (ReactNode | string)[]): ReactNode {
  return createElement(tag, { ...props, key: props['data-tegaki'] }, ...children);
}

export function TegakiRenderer<const C extends ElementType = 'div', const E extends TegakiEffects<E> = Record<string, never>>(
  props: TegakiRendererProps<C, E>,
) {
  const {
    as: Tag = 'div' as ElementType,
    ref,
    font,
    text,
    children,
    time: timeProp,
    onComplete,
    onChangeTimeline,
    effects,
    quality,
    timing,
    showOverlay,
    direction,
    shaper,
    editable,
    onTextChange,
    ...elementProps
  } = props as TegakiRendererProps<ElementType, E>;

  const containerRef = useRef<HTMLElement>(null);
  const engineRef = useRef<TegakiEngine | null>(null);
  const resolvedText = text ?? coerceToString(children);

  // --- Editable: internal text state that resets when controlled text changes ---
  const [internalText, setInternalText] = useState(resolvedText);
  const [prevResolvedText, setPrevResolvedText] = useState(resolvedText);
  if (prevResolvedText !== resolvedText) {
    setPrevResolvedText(resolvedText);
    setInternalText(resolvedText);
  }

  const displayText = editable ? internalText : resolvedText;

  // Render the element tree via the engine's static method (SSR-safe)
  const engineOptions: TegakiEngineOptions = {
    text: displayText,
    font,
    time: timeProp,
    effects: effects as Record<string, any>,
    quality,
    timing,
    showOverlay,
    direction,
    shaper,
    onComplete,
    onChangeTimeline,
  };
  const { rootProps, content } = TegakiEngine.renderElements(engineOptions, reactCreateElement);
  const { style: rootStyle, ...rootAttrs } = rootProps;

  // Create engine on mount, adopting the pre-rendered elements
  useEffect(() => {
    const engine = new TegakiEngine(containerRef.current!, { adopt: true });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Update engine with current props every render
  useEffect(() => {
    engineRef.current?.update(engineOptions);
  });

  // --- Editable: contentEditable + input handling ---
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;

  useEffect(() => {
    if (!editable) return;
    const container = containerRef.current;
    if (!container) return;
    const overlay = container.querySelector<HTMLElement>('[data-tegaki="overlay"]');
    if (!overlay) return;

    overlay.contentEditable = 'plaintext-only';
    overlay.style.caretColor = 'auto';

    const handleInput = () => {
      const newText = overlay.textContent ?? '';
      setInternalText(newText);
      onTextChangeRef.current?.(newText);
    };

    overlay.addEventListener('input', handleInput);
    return () => {
      overlay.removeEventListener('input', handleInput);
      overlay.contentEditable = 'inherit';
      overlay.style.caretColor = '';
    };
  }, [editable]);

  // Imperative handle
  useImperativeHandle(
    ref,
    () => ({
      get engine() {
        return engineRef.current;
      },
      get element() {
        return containerRef.current;
      },
    }),
    [],
  );

  // Merge engine root styles with user-provided styles
  const mergedStyle = { ...rootStyle, ...elementProps.style };

  return createElement(Tag, { ...rootAttrs, ...elementProps, ref: containerRef, style: mergedStyle } as any, content);
}
