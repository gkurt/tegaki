import { useEffect, useRef, useState } from 'react';
import { TegakiRenderer } from 'tegaki';
import { type FontName, useFont, useInView } from './shared.ts';

const FONTS: { name: FontName; label: string; size: number }[] = [
  { name: 'Caveat', label: 'Caveat', size: 1 },
  { name: 'Parisienne', label: 'Parisienne', size: 0.92 },
  { name: 'Italianno', label: 'Italianno', size: 1.3 },
  { name: 'Tangerine', label: 'Tangerine', size: 1.4 },
];

const QUALITY = { smoothing: true };

const START = 'Click these words\nand write your own.';

/**
 * Keep the caret at the end of `root`'s editable overlay while it has focus.
 * The pen writes whatever is new at the end of the timeline, so a letter typed
 * mid-line would draw at the end of the animation, not where it appears.
 */
function useCaretPinnedToEnd(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onSelectionChange = () => {
      const overlay = root.current?.querySelector<HTMLElement>('[data-tegaki="overlay"]');
      const sel = document.getSelection();
      if (!overlay || !sel || document.activeElement !== overlay || !sel.focusNode) return;
      const after = document.createRange();
      after.setStart(sel.focusNode, sel.focusOffset);
      after.setEnd(overlay, overlay.childNodes.length);
      if (sel.isCollapsed && after.toString() === '') return;
      sel.selectAllChildren(overlay);
      sel.collapseToEnd();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [root]);
}

/**
 * The renderer in `editable` mode: the handwriting *is* the text field. New
 * characters draw as they're typed; `catchUp` lets fast typists pull ahead
 * without the pen falling behind.
 */
export function TypeIt() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { once: true, rootMargin: '300px 0px' });
  const visible = useInView(ref);
  const [fontIndex, setFontIndex] = useState(0);
  const [text, setText] = useState(START);
  const choice = FONTS[fontIndex]!;
  const font = useFont(near ? choice.name : null);
  useCaretPinnedToEnd(ref);

  return (
    <div ref={ref} className="typeit">
      <div className="typeit-toolbar">
        <div className="typeit-fonts" role="radiogroup" aria-label="Pen">
          {FONTS.map((f, i) => (
            <button
              key={f.name}
              type="button"
              role="radio"
              aria-checked={i === fontIndex}
              className={i === fontIndex ? 'active' : undefined}
              onClick={() => setFontIndex(i)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="typeit-clear"
          onClick={() => {
            setText('');
            requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[data-tegaki="overlay"]')?.focus());
          }}
        >
          Clear the page
        </button>
      </div>
      <div className="typeit-card" style={{ fontSize: `calc(var(--typeit-size) * ${choice.size})` }}>
        {font && (
          <TegakiRenderer
            key={choice.name}
            font={font}
            text={text}
            editable
            onTextChange={setText}
            spellCheck={false}
            aria-label="Handwritten text — click to edit"
            time={{ mode: 'uncontrolled', speed: 2, catchUp: 0.8, playing: visible }}
            quality={QUALITY}
          />
        )}
        {font && text === '' && <span className="typeit-placeholder">Start typing…</span>}
      </div>
    </div>
  );
}
