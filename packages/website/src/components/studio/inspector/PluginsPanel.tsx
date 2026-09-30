import { ColorControl, SelectControl, Slider, TextControl, Toggle } from 'dialkit';
import { useState } from 'react';
import { parseLength, type TegakiLength, type TegakiLengthParam, type TegakiPluginParam, type TegakiPluginParams } from 'tegaki/core';
import { normalizePluginIds, type PluginOptions, SHOWCASE_PLUGINS, type ShowcasePlugin } from '../../plugins/index.ts';
import type { UrlState } from '../../url-state.ts';
import { ChevronDownIcon, GithubIcon, ResetIcon } from '../icons.tsx';
import type { SetSetting } from '../state.ts';
import { Chip, Hint, Section } from '../ui.tsx';
import { ColorStops, DialScope, SeedControl, SmallIconButton, SmallIconLink, ToggleGroup } from './dial.tsx';

const DOCS = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/renderer/#plugins`;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const FEATURED = SHOWCASE_PLUGINS.filter((p) => p.featured);
const MORE = SHOWCASE_PLUGINS.filter((p) => !p.featured);

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
  const moreOn = MORE.filter((p) => on.has(p.id)).length;
  // Open from the start when the URL switched one of them on, so it isn't hidden.
  const [showMore, setShowMore] = useState(moreOn > 0);
  const controls = (p: ShowcasePlugin) => (
    <PluginControls
      key={p.id}
      plugin={p}
      fontSize={settings.fontSizePx}
      enabled={on.has(p.id)}
      options={settings.pluginOptions[p.id] ?? {}}
      onToggle={(v) => toggle(p.id, v)}
      onOptions={(o) => setOptions(p.id, o)}
    />
  );

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
        </a>
        . Each is made with <code>createPlugin</code>, and its controls come from the params it declares. They're here to show what plugins
        can do, so Export and Ask an agent leave them out.
      </Hint>
      <DialScope className="mt-2 flex flex-col gap-1.5">
        <div className="flex flex-col gap-1">
          <SeedControl value={settings.seed} onChange={(v) => set('seed', v)} />
          <Hint>
            The randomness in Variation, Boil, Annotate's marks and the random demos (Brush, Ballpoint, Shaky hand, Graphite, Chalk, Spray,
            Burn, Neon, Sparkles, shuffled Colors). The same seed draws the same every time.
          </Hint>
        </div>
        {FEATURED.map(controls)}
        <button
          type="button"
          className="mt-1 flex h-8 items-center gap-1.5 border-t border-zinc-200 pt-1 text-left text-[12px] font-medium text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
          onClick={() => setShowMore(!showMore)}
          aria-expanded={showMore}
        >
          <ChevronDownIcon size={12} className={showMore ? 'transition-transform' : '-rotate-90 transition-transform'} />
          <span className="flex-1">More plugins ({MORE.length})</span>
          {moreOn > 0 && <span className="text-indigo-500">{moreOn} on</span>}
        </button>
        {showMore && MORE.map(controls)}
      </DialScope>
      <Hint>
        Stroke order, Brush (try its Scroll preset) and Practice paper's 田字格 / 米字格 suit kanji best. Try Klee One with 永 or 書. Neon,
        Laser and Cathode tube (the last two under More) shine on the dark theme. Sound starts once you've clicked on the page; Haptics buzz
        on Android phones.
      </Hint>
    </Section>
  );
}

function PluginControls({
  plugin: { factory, source },
  fontSize,
  enabled,
  options,
  onToggle,
  onOptions,
}: {
  plugin: ShowcasePlugin;
  /** The text's font size in px, what a length param's em and px convert by. */
  fontSize: number;
  enabled: boolean;
  /** The options changed from the defaults. */
  options: PluginOptions;
  onToggle: (enabled: boolean) => void;
  onOptions: (options: PluginOptions) => void;
}) {
  const params: TegakiPluginParams = factory.params;
  const values: PluginOptions = factory.resolve(options);
  const presets = Object.entries(factory.presets as Record<string, PluginOptions>);
  const change = (next: PluginOptions) => onOptions(factory.changed(next));
  const hasParams = Object.keys(params).length > 0;
  const changed = Object.keys(options).length > 0;

  return (
    <ToggleGroup
      label={factory.label}
      info={factory.description}
      checked={enabled}
      onChange={onToggle}
      trailing={
        <>
          {enabled && changed && (
            <SmallIconButton label={`Reset ${factory.label}`} onClick={() => onOptions({})}>
              <ResetIcon size={12} />
            </SmallIconButton>
          )}
          <SmallIconLink label={`${factory.label} source on GitHub`} href={source}>
            <GithubIcon size={12} />
          </SmallIconLink>
        </>
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
                <Chip key={name} selected={changed && same(options, factory.changed(preset))} onClick={() => change(preset)}>
                  {name}
                </Chip>
              ))}
            </div>
          )}
          {Object.entries(params).map(([key, param]) => (
            <ParamControl
              key={key}
              name={key}
              param={param}
              value={values[key]}
              fontSize={fontSize}
              onChange={(v) => change({ ...values, [key]: v })}
            />
          ))}
        </>
      )}
    </ToggleGroup>
  );
}

/** The DialKit control for one param. */
function ParamControl({
  name,
  param,
  value,
  fontSize,
  onChange,
}: {
  name: string;
  param: TegakiPluginParam;
  value: PluginOptions[string];
  fontSize: number;
  onChange: (value: NonNullable<PluginOptions[string]>) => void;
}) {
  const label = param.label ?? name;
  switch (param.type) {
    case 'number':
      return <Slider label={label} value={Number(value)} min={param.min} max={param.max} step={param.step} onChange={onChange} />;
    case 'length':
      return <LengthControl label={label} param={param} value={value as TegakiLength} fontSize={fontSize} onChange={onChange} />;
    case 'boolean':
      return <Toggle label={label} checked={Boolean(value)} onChange={onChange} />;
    case 'select':
      return <SelectControl label={label} value={String(value)} options={[...param.options]} onChange={onChange} />;
    case 'color':
      return <ColorControl label={label} value={String(value)} onChange={onChange} />;
    case 'text':
      return <TextControl label={label} value={String(value ?? '')} placeholder={param.placeholder} onChange={onChange} />;
    case 'colors':
      return <ColorStops colors={Array.isArray(value) ? value : [...param.default]} onChange={onChange} />;
  }
}

/**
 * A length param: a slider in the unit the value is in, and a switch between
 * em and px that converts it at the text's font size, so the size on screen
 * stays put. A px value's slider spans the param's em range at that size.
 */
function LengthControl({
  label,
  param,
  value,
  fontSize,
  onChange,
}: {
  label: string;
  param: TegakiLengthParam;
  value: TegakiLength;
  fontSize: number;
  onChange: (value: TegakiLength) => void;
}) {
  const own = param.unit ?? 'em';
  const parsed = parseLength(value) ?? { value: 0, unit: undefined };
  const unit = parsed.unit ?? own;
  // The param's range is in its own unit; in the other, it's that range at this font size.
  const factor = unit === own ? 1 : unit === 'px' ? fontSize : 1 / fontSize;
  const range = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * factor * 100) / 100);
  const step = unit === own ? param.step : unit === 'px' ? 1 : 0.01;
  const write = (n: number, u: 'em' | 'px'): TegakiLength => (u === own ? n : `${n}${u}`);
  const round = (n: number, u: 'em' | 'px') => (u === 'px' ? Math.round(n) : Math.round(n * 1000) / 1000);
  return (
    <>
      <Slider
        label={`${label} (${unit})`}
        value={parsed.value}
        min={range(param.min)}
        max={range(param.max)}
        step={step}
        onChange={(n) => onChange(write(n, unit))}
      />
      <SelectControl
        label={`${label} unit`}
        value={unit}
        options={[
          { value: 'em', label: 'em — grows with the text' },
          { value: 'px', label: 'px — fixed' },
        ]}
        onChange={(u) => {
          if (u === unit) return;
          const next = u === 'px' ? parsed.value * fontSize : parsed.value / fontSize;
          onChange(write(round(next, u as 'em' | 'px'), u as 'em' | 'px'));
        }}
      />
    </>
  );
}
