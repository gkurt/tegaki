import { Toggle } from 'dialkit';
import { normalizePluginIds, SHOWCASE_PLUGINS } from '../../plugins/index.ts';
import type { UrlState } from '../../url-state.ts';
import type { SetSetting } from '../state.ts';
import { Hint, Section } from '../ui.tsx';
import { DialScope } from './dial.tsx';

const DOCS = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/renderer/#plugins`;

/**
 * Demo plugins: what the renderer's plugin API can draw, switched on over
 * the current text. For showing only — Export and the agent prompt leave
 * them out.
 */
export function PluginsPanel({ settings, set }: { settings: UrlState; set: SetSetting }) {
  const on = new Set(settings.plugins);
  const toggle = (id: string, enabled: boolean) =>
    set('plugins', (prev) => normalizePluginIds(enabled ? [...prev, id] : prev.filter((p) => p !== id)));

  return (
    <Section title="Plugins" modified={settings.plugins.length > 0} onReset={() => set('plugins', [])}>
      <Hint>
        Demos of the{' '}
        <a className="underline hover:text-zinc-900 dark:hover:text-zinc-100" href={DOCS} target="_blank" rel="noreferrer">
          plugin API
        </a>{' '}
        — each is a <code>TegakiPlugin</code> a page could pass to <code>plugins</code>. They're here to show what plugins can do, so Export
        and Ask an agent leave them out.
      </Hint>
      <DialScope className="mt-2 flex flex-col gap-3">
        {SHOWCASE_PLUGINS.map((p) => (
          <div key={p.id} className="flex flex-col gap-1">
            <Toggle label={p.label} checked={on.has(p.id)} onChange={(v) => toggle(p.id, v)} />
            <Hint>{p.description}</Hint>
          </div>
        ))}
      </DialScope>
      <Hint>Stroke order and Brush suit kanji best — try Klee One with 永 or 書. Sound starts once you've clicked on the page.</Hint>
    </Section>
  );
}
