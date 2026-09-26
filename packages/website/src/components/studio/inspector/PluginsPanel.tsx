import { ColorControl, SelectControl, Slider, Toggle } from 'dialkit';
import { changedPluginOptions, type TegakiPluginParam, type TegakiPluginParams } from 'tegaki/core';
import { normalizePluginIds, type PluginOptions, SHOWCASE_PLUGINS, type ShowcasePlugin } from '../../plugins/index.ts';
import type { UrlState } from '../../url-state.ts';
import { ResetIcon } from '../icons.tsx';
import type { SetSetting } from '../state.ts';
import { Chip, Hint, Section } from '../ui.tsx';
import { DialScope, SeedControl, SmallIconButton, ToggleGroup } from './dial.tsx';

const DOCS = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/renderer/#plugins`;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Demo plugins: what the renderer's plugin API can draw, switched on over
 * the current text, each with a control per param its factory declares. For
 * showing only — Export and the agent prompt leave them out.
 */
export function PluginsPanel({ settings, set }: { settings: UrlState; set: SetSetting }) {
  const on = new Set(settings.plugins);
  const toggle = (id: string, enabled: boolean) =>
    set('plugins', (prev) => normalizePluginIds(enabled ? [...prev, id] : prev.filter((p) => p !== id)));
  const setOptions = (id: string, options: PluginOptions) =>
    set('pluginOptions', (prev) => {
      const { [id]: _, ...rest } = prev;
      return Object.keys(options).length > 0 ? { ...rest, [id]: options } : rest;
    });
  const modified = settings.plugins.length > 0 || Object.keys(settings.pluginOptions).length > 0;

  return (
    <Section
      title="Plugins"
      modified={modified}
      onReset={() => {
        set('plugins', []);
        set('pluginOptions', {});
      }}
    >
      <Hint>
        Demos of the{' '}
        <a className="underline hover:text-zinc-900 dark:hover:text-zinc-100" href={DOCS} target="_blank" rel="noreferrer">
          plugin API
        </a>{' '}
        — each is made with <code>createPlugin</code>, and its controls come from the params it declares. They're here to show what plugins
        can do, so Export and Ask an agent leave them out.
      </Hint>
      <DialScope className="mt-2 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <SeedControl value={settings.seed} onChange={(v) => set('seed', v)} />
          <Hint>What Variation strays by, and Brush lays its hairs by — the same seed draws the same every time.</Hint>
        </div>
        {SHOWCASE_PLUGINS.map((p) => (
          <PluginControls
            key={p.id}
            plugin={p}
            enabled={on.has(p.id)}
            options={settings.pluginOptions[p.id] ?? {}}
            onToggle={(v) => toggle(p.id, v)}
            onOptions={(o) => setOptions(p.id, o)}
          />
        ))}
      </DialScope>
      <Hint>Stroke order and Brush suit kanji best — try Klee One with 永 or 書. Sound starts once you've clicked on the page.</Hint>
    </Section>
  );
}

function PluginControls({
  plugin: { factory },
  enabled,
  options,
  onToggle,
  onOptions,
}: {
  plugin: ShowcasePlugin;
  enabled: boolean;
  /** The options changed from the defaults. */
  options: PluginOptions;
  onToggle: (enabled: boolean) => void;
  onOptions: (options: PluginOptions) => void;
}) {
  const params: TegakiPluginParams = factory.params;
  const values: PluginOptions = factory.resolve(options);
  const presets = Object.entries(factory.presets as Record<string, PluginOptions>);
  const change = (next: PluginOptions) => onOptions(changedPluginOptions(params, next));
  const hasParams = Object.keys(params).length > 0;
  const changed = Object.keys(options).length > 0;

  return (
    <div className="flex flex-col gap-1">
      <ToggleGroup
        label={factory.label}
        checked={enabled}
        onChange={onToggle}
        trailing={
          enabled && changed ? (
            <SmallIconButton label={`Reset ${factory.label}`} onClick={() => onOptions({})}>
              <ResetIcon size={12} />
            </SmallIconButton>
          ) : undefined
        }
      >
        {hasParams && (
          <>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1 py-0.5">
                <Chip selected={!changed} onClick={() => onOptions({})}>
                  Default
                </Chip>
                {presets.map(([name, preset]) => (
                  <Chip key={name} selected={changed && same(options, changedPluginOptions(params, preset))} onClick={() => change(preset)}>
                    {name}
                  </Chip>
                ))}
              </div>
            )}
            {Object.entries(params).map(([key, param]) => (
              <ParamControl key={key} name={key} param={param} value={values[key]} onChange={(v) => change({ ...values, [key]: v })} />
            ))}
          </>
        )}
      </ToggleGroup>
      {factory.description && <Hint>{factory.description}</Hint>}
    </div>
  );
}

/** The DialKit control for one param. */
function ParamControl({
  name,
  param,
  value,
  onChange,
}: {
  name: string;
  param: TegakiPluginParam;
  value: PluginOptions[string];
  onChange: (value: NonNullable<PluginOptions[string]>) => void;
}) {
  const label = param.label ?? name;
  switch (param.type) {
    case 'number':
      return <Slider label={label} value={Number(value)} min={param.min} max={param.max} step={param.step} onChange={onChange} />;
    case 'boolean':
      return <Toggle label={label} checked={Boolean(value)} onChange={onChange} />;
    case 'select':
      return <SelectControl label={label} value={String(value)} options={[...param.options]} onChange={onChange} />;
    case 'color':
      return <ColorControl label={label} value={String(value)} onChange={onChange} />;
  }
}
