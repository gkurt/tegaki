import { useEffect, useRef, useState } from 'react';
import { TegakiRenderer } from 'tegaki';
import { useFont, useInView } from './shared.ts';

const TURNS = [
  { ask: 'Write me two lines about ink.', reply: 'A drop of night upon the page,\nit learns your hand, and starts to speak.' },
  { ask: 'And two about the morning?', reply: 'The kettle hums, the window glows,\nand every word begins in light.' },
];

type Message = { role: 'user' | 'assistant'; text: string };

/**
 * A fake model streams its reply in uneven token-sized chunks, and the
 * renderer — in uncontrolled mode with `catchUp` — keeps writing as the text
 * grows, exactly like wiring it to a real streaming API.
 */
export function ChatStream() {
  const ref = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const started = useInView(ref, { once: true, threshold: 0.35 });
  const visible = useInView(ref);
  const font = useFont(started ? 'Caveat' : null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [thinking, setThinking] = useState(false);
  const [run, setRun] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` is the replay trigger
  useEffect(() => {
    if (!started || !font) return;
    let cancelled = false;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    (async () => {
      setMessages([]);
      for (const turn of TURNS) {
        await wait(700);
        if (cancelled) return;
        setMessages((m) => [...m, { role: 'user', text: turn.ask }]);
        setThinking(true);
        await wait(1100);
        if (cancelled) return;
        setThinking(false);
        setMessages((m) => [...m, { role: 'assistant', text: '' }]);
        // Stream the reply a few characters at a time, at an uneven pace.
        let sent = 0;
        while (sent < turn.reply.length) {
          sent = Math.min(turn.reply.length, sent + 2 + Math.floor(Math.random() * 5));
          const text = turn.reply.slice(0, sent);
          setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text }]);
          await wait(45 + Math.random() * 90);
          if (cancelled) return;
        }
        await wait(4200);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [started, font, run]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the log as messages arrive
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  }, [messages.length, thinking]);

  return (
    <div ref={ref} className="chat">
      <div className="chat-head">
        <span className="chat-dot" />
        <span>assistant</span>
        <button type="button" onClick={() => setRun((r) => r + 1)} disabled={!font}>
          Replay
        </button>
      </div>
      <div ref={logRef} className="chat-log">
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={`${run}-${i}`} className="chat-msg chat-user">
              {m.text}
            </div>
          ) : (
            <div key={`${run}-${i}`} className="chat-msg chat-assistant">
              {font && (
                <TegakiRenderer font={font} text={m.text} time={{ mode: 'uncontrolled', speed: 3, catchUp: 0.6, playing: visible }} />
              )}
            </div>
          ),
        )}
        {thinking && (
          <div className="chat-thinking" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <div className="chat-input" aria-hidden="true">
        Ask anything…
      </div>
    </div>
  );
}
