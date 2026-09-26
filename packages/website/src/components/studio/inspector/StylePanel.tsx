import { ColorControl, SelectControl, Slider, Toggle } from 'dialkit';
import { useState } from 'react';
import { buildEffects } from '../../preview/utils.ts';
import {
  type CustomEffect,
  DEFAULT_EFFECTS_STATE,
  defaultClipText,
  EFFECT_DEFAULTS,
  type EffectsState,
  URL_DEFAULTS,
  type UrlState,
} from '../../url-state.ts';
import { CheckIcon, CopyIcon, MinusIcon, PlusIcon } from '../icons.tsx';
import type { SetSetting } from '../state.ts';
import { IconButton, Section } from '../ui.tsx';
import { ColorStops, DialScope, SeedControl, SmallIconButton, ToggleGroup } from './dial.tsx';

/** Where the line-height slider starts when switched on from the font's `normal`. */
const CUSTOM_LINE_HEIGHT = 1.2;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function StylePanel({ settings, set }: { settings: UrlState; set: SetSetting }) {
  const { effectsState: fx, customEffects, quality } = settings;
  const [copied, setCopied] = useState(false);

  const patch = <K extends keyof EffectsState>(name: K, update: Partial<EffectsState[K]>) =>
    set('effectsState', (s) => ({ ...s, [name]: { ...s[name], ...update } }));

  const addGlow = () => {
    let n = customEffects.filter((e) => e.effect === 'glow').length + 1;
    while (customEffects.some((e) => e.key === `glow${n}`)) n++;
    set('customEffects', [...customEffects, { key: `glow${n}`, effect: 'glow', enabled: true, config: { ...EFFECT_DEFAULTS.glow } }]);
  };
  const updateCustom = (key: string, update: Partial<CustomEffect>) =>
    set('customEffects', (list) => list.map((e) => (e.key === key ? { ...e, ...update } : e)));
  const removeCustom = (key: string) => set('customEffects', (list) => list.filter((e) => e.key !== key));

  const copyEffects = () => {
    const effects = buildEffects(fx, customEffects);
    navigator.clipboard.writeText(effects ? JSON.stringify(effects, null, 2) : '{}');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const clipDefault = defaultClipText(settings.pipeline);
  const clipScale = typeof quality.clipText === 'number' ? quality.clipText : 1;
  const textModified =
    settings.fontSizePx !== URL_DEFAULTS.fontSizePx ||
    settings.lineHeightRatio !== URL_DEFAULTS.lineHeightRatio ||
    settings.letterSpacingPx !== URL_DEFAULTS.letterSpacingPx;
  const effectsModified = !same(fx, DEFAULT_EFFECTS_STATE) || customEffects.length > 0 || settings.seed !== URL_DEFAULTS.seed;
  const renderingModified =
    quality.pixelRatio !== URL_DEFAULTS.quality.pixelRatio ||
    quality.segmentSize !== URL_DEFAULTS.quality.segmentSize ||
    quality.smoothing !== URL_DEFAULTS.quality.smoothing ||
    quality.clipText !== clipDefault ||
    settings.useShaper !== URL_DEFAULTS.useShaper ||
    settings.showOverlay !== URL_DEFAULTS.showOverlay;

  return (
    <>
      <Section
        title="Text"
        modified={textModified}
        onReset={() => {
          set('fontSizePx', URL_DEFAULTS.fontSizePx);
          set('lineHeightRatio', URL_DEFAULTS.lineHeightRatio);
          set('letterSpacingPx', URL_DEFAULTS.letterSpacingPx);
        }}
      >
        <DialScope className="flex flex-col gap-1.5">
          <Slider label="Size" value={settings.fontSizePx} min={16} max={256} step={1} unit="px" onChange={(v) => set('fontSizePx', v)} />
          <ToggleGroup
            label="Custom line height"
            checked={settings.lineHeightRatio !== null}
            onChange={(v) => set('lineHeightRatio', v ? CUSTOM_LINE_HEIGHT : null)}
          >
            <Slider
              label="Line height"
              value={settings.lineHeightRatio ?? CUSTOM_LINE_HEIGHT}
              min={0.5}
              max={3}
              step={0.05}
              unit="×"
              onChange={(v) => set('lineHeightRatio', v)}
            />
          </ToggleGroup>
          <Slider
            label="Letter spacing"
            value={settings.letterSpacingPx}
            min={-20}
            max={40}
            step={1}
            unit="px"
            onChange={(v) => set('letterSpacingPx', v)}
          />
        </DialScope>
      </Section>

      <Section
        title="Effects"
        modified={effectsModified}
        onReset={() => {
          set('effectsState', DEFAULT_EFFECTS_STATE);
          set('customEffects', []);
          set('seed', URL_DEFAULTS.seed);
        }}
        actions={
          <IconButton label={copied ? 'Copied' : 'Copy effects prop as JSON'} onClick={copyEffects} className="size-7">
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </IconButton>
        }
      >
        <DialScope className="flex flex-col gap-1.5">
          <SeedControl value={settings.seed} onChange={(v) => set('seed', v)} />
          <ToggleGroup
            label="Glow"
            checked={fx.glow.enabled}
            onChange={(v) => patch('glow', { enabled: v })}
            trailing={
              <SmallIconButton label="Add another glow layer" onClick={addGlow}>
                <PlusIcon size={12} />
              </SmallIconButton>
            }
          >
            <GlowControls
              config={{ ...fx.glow, radius: Number.parseFloat(String(fx.glow.radius)) || 8 }}
              onChange={(u) => patch('glow', u)}
            />
          </ToggleGroup>
          {customEffects.map((ce) => (
            <ToggleGroup
              key={ce.key}
              label={ce.key}
              checked={ce.enabled}
              onChange={(v) => updateCustom(ce.key, { enabled: v })}
              trailing={
                <SmallIconButton label={`Remove ${ce.key}`} onClick={() => removeCustom(ce.key)}>
                  <MinusIcon size={12} />
                </SmallIconButton>
              }
            >
              <GlowControls
                config={{
                  radius: Number(ce.config.radius ?? 8),
                  color: String(ce.config.color ?? '#00ccff'),
                  offsetX: Number(ce.config.offsetX ?? 0),
                  offsetY: Number(ce.config.offsetY ?? 0),
                }}
                onChange={(u) => updateCustom(ce.key, { config: { ...ce.config, ...u } })}
              />
            </ToggleGroup>
          ))}

          <ToggleGroup label="Wobble" checked={fx.wobble.enabled} onChange={(v) => patch('wobble', { enabled: v })}>
            <SelectControl
              label="Mode"
              value={fx.wobble.mode}
              options={[
                { value: 'sine', label: 'Sine' },
                { value: 'noise', label: 'Noise' },
              ]}
              onChange={(v) => patch('wobble', { mode: v as 'sine' | 'noise' })}
            />
            <Slider
              label="Amplitude"
              value={fx.wobble.amplitude}
              min={0.5}
              max={10}
              step={0.5}
              onChange={(v) => patch('wobble', { amplitude: v })}
            />
            <Slider
              label="Frequency"
              value={fx.wobble.frequency}
              min={1}
              max={20}
              step={1}
              onChange={(v) => patch('wobble', { frequency: v })}
            />
          </ToggleGroup>

          <ToggleGroup label="Pressure width" checked={fx.pressureWidth.enabled} onChange={(v) => patch('pressureWidth', { enabled: v })}>
            <Slider
              label="Strength"
              value={fx.pressureWidth.strength}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => patch('pressureWidth', { strength: v })}
            />
          </ToggleGroup>

          <ToggleGroup label="Taper" checked={fx.taper.enabled} onChange={(v) => patch('taper', { enabled: v })}>
            <Slider
              label="Start"
              value={fx.taper.startLength}
              min={0}
              max={0.5}
              step={0.05}
              onChange={(v) => patch('taper', { startLength: v })}
            />
            <Slider
              label="End"
              value={fx.taper.endLength}
              min={0}
              max={0.5}
              step={0.05}
              onChange={(v) => patch('taper', { endLength: v })}
            />
          </ToggleGroup>

          <ToggleGroup
            label="Stroke gradient"
            checked={fx.strokeGradient.enabled}
            onChange={(v) => patch('strokeGradient', { enabled: v })}
          >
            <SelectControl
              label="Colors"
              value={fx.strokeGradient.colors === 'rainbow' ? 'rainbow' : 'custom'}
              options={[
                { value: 'rainbow', label: 'Rainbow' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(v) => patch('strokeGradient', { colors: v === 'rainbow' ? 'rainbow' : ['#ff0000', '#00ff00', '#0000ff'] })}
            />
            {fx.strokeGradient.colors === 'rainbow' ? (
              <>
                <Slider
                  label="Saturation"
                  value={fx.strokeGradient.saturation}
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                  onChange={(v) => patch('strokeGradient', { saturation: v })}
                />
                <Slider
                  label="Lightness"
                  value={fx.strokeGradient.lightness}
                  min={10}
                  max={90}
                  step={5}
                  unit="%"
                  onChange={(v) => patch('strokeGradient', { lightness: v })}
                />
              </>
            ) : (
              <ColorStops
                colors={Array.isArray(fx.strokeGradient.colors) ? fx.strokeGradient.colors : ['#ff0000', '#0000ff']}
                onChange={(colors) => patch('strokeGradient', { colors })}
              />
            )}
          </ToggleGroup>

          <ToggleGroup
            label="Global gradient"
            checked={fx.globalGradient.enabled}
            onChange={(v) => patch('globalGradient', { enabled: v })}
          >
            <ColorStops colors={fx.globalGradient.colors} onChange={(colors) => patch('globalGradient', { colors })} />
            <Slider
              label="Angle"
              value={fx.globalGradient.angle}
              min={0}
              max={360}
              step={5}
              unit="°"
              onChange={(v) => patch('globalGradient', { angle: v })}
            />
          </ToggleGroup>
        </DialScope>
      </Section>

      <Section
        title="Rendering"
        modified={renderingModified}
        onReset={() => {
          set('quality', { ...URL_DEFAULTS.quality, clipText: clipDefault });
          set('useShaper', URL_DEFAULTS.useShaper);
          set('showOverlay', URL_DEFAULTS.showOverlay);
        }}
      >
        <DialScope className="flex flex-col gap-1.5">
          <ToggleGroup
            label="Clip to text"
            checked={!!quality.clipText}
            onChange={(v) => set('quality', (q) => ({ ...q, clipText: v ? clipDefault || 2 : false }))}
          >
            <Slider
              label="Stroke scale"
              value={clipScale}
              min={1}
              max={5}
              step={0.05}
              unit="×"
              onChange={(v) => set('quality', (q) => ({ ...q, clipText: v === 1 ? true : v }))}
            />
          </ToggleGroup>
          <Toggle
            label="Smoothing (Catmull-Rom)"
            checked={quality.smoothing}
            onChange={(v) => set('quality', (q) => ({ ...q, smoothing: v }))}
          />
          <Slider
            label="Segment size"
            value={quality.segmentSize}
            min={0.5}
            max={10}
            step={0.5}
            unit="px"
            onChange={(v) => set('quality', (q) => ({ ...q, segmentSize: v }))}
          />
          <Slider
            label="Pixel ratio"
            value={quality.pixelRatio}
            min={0.5}
            max={4}
            step={0.25}
            unit="×"
            onChange={(v) => set('quality', (q) => ({ ...q, pixelRatio: v }))}
          />
          <Toggle label="HarfBuzz shaper" checked={settings.useShaper} onChange={(v) => set('useShaper', v)} />
          <Toggle label="Debug overlay" checked={settings.showOverlay} onChange={(v) => set('showOverlay', v)} />
        </DialScope>
      </Section>
    </>
  );
}

function GlowControls({
  config,
  onChange,
}: {
  config: { radius: number; color: string; offsetX: number; offsetY: number };
  onChange: (update: Partial<{ radius: number; color: string; offsetX: number; offsetY: number }>) => void;
}) {
  return (
    <>
      <Slider label="Radius" value={config.radius} min={1} max={30} step={1} onChange={(v) => onChange({ radius: v })} />
      <ColorControl label="Color" value={config.color} onChange={(v) => onChange({ color: v })} />
      <Slider label="Offset X" value={config.offsetX} min={-20} max={20} step={1} onChange={(v) => onChange({ offsetX: v })} />
      <Slider label="Offset Y" value={config.offsetY} min={-20} max={20} step={1} onChange={(v) => onChange({ offsetY: v })} />
    </>
  );
}
