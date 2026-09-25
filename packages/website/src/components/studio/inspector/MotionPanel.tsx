import { SelectControl, Slider, TextControl, Toggle } from 'dialkit';
import { EASING_PRESETS } from '../../preview/constants.ts';
import { type TimeMode, URL_DEFAULTS, type UrlState } from '../../url-state.ts';
import type { SetSetting } from '../state.ts';
import { Hint, Section } from '../ui.tsx';
import { DialScope, ToggleGroup } from './dial.tsx';

const TIME_MODE_HINTS: Record<TimeMode, string> = {
  controlled: 'The studio drives the time prop — play, pause and scrub from the transport bar.',
  uncontrolled: 'The engine runs its own clock, as a page would use it by default.',
  css: 'Progress comes from a CSS scroll timeline — scroll the bar under the canvas.',
};

const easingOptions = (defaultLabel: string) =>
  EASING_PRESETS.map((p) => ({ value: p.key, label: p.key === 'default' ? defaultLabel : p.label }));

export function MotionPanel({ settings, set }: { settings: UrlState; set: SetSetting }) {
  const playbackModified =
    settings.timeMode !== URL_DEFAULTS.timeMode ||
    settings.animSpeed !== URL_DEFAULTS.animSpeed ||
    settings.loop !== URL_DEFAULTS.loop ||
    settings.catchUp !== URL_DEFAULTS.catchUp;
  const timingModified =
    settings.strokeEasing !== URL_DEFAULTS.strokeEasing ||
    settings.glyphEasing !== URL_DEFAULTS.glyphEasing ||
    settings.deferDots !== URL_DEFAULTS.deferDots ||
    settings.staggerEnabled !== URL_DEFAULTS.staggerEnabled ||
    settings.staggerAdvance !== URL_DEFAULTS.staggerAdvance ||
    settings.staggerDuration !== URL_DEFAULTS.staggerDuration;

  return (
    <>
      <Section
        title="Playback"
        modified={playbackModified}
        onReset={() => {
          set('timeMode', URL_DEFAULTS.timeMode);
          set('animSpeed', URL_DEFAULTS.animSpeed);
          set('loop', URL_DEFAULTS.loop);
          set('catchUp', URL_DEFAULTS.catchUp);
        }}
      >
        <DialScope className="flex flex-col gap-1.5">
          <SelectControl
            label="Time"
            value={settings.timeMode}
            options={[
              { value: 'controlled', label: 'Controlled' },
              { value: 'uncontrolled', label: 'Uncontrolled' },
              { value: 'css', label: 'CSS scroll' },
            ]}
            onChange={(v) => set('timeMode', v as TimeMode)}
          />
          {settings.timeMode !== 'css' && (
            <Slider label="Speed" value={settings.animSpeed} min={0.1} max={5} step={0.1} unit="×" onChange={(v) => set('animSpeed', v)} />
          )}
          {settings.timeMode === 'uncontrolled' && (
            <>
              <Toggle label="Loop" checked={settings.loop} onChange={(v) => set('loop', v)} />
              <Slider label="Catch-up" value={settings.catchUp} min={0} max={2} step={0.1} onChange={(v) => set('catchUp', v)} />
            </>
          )}
        </DialScope>
        <Hint>{TIME_MODE_HINTS[settings.timeMode]}</Hint>
      </Section>

      <Section
        title="Timing"
        modified={timingModified}
        onReset={() => {
          set('strokeEasing', URL_DEFAULTS.strokeEasing);
          set('glyphEasing', URL_DEFAULTS.glyphEasing);
          set('deferDots', URL_DEFAULTS.deferDots);
          set('staggerEnabled', URL_DEFAULTS.staggerEnabled);
          set('staggerAdvance', URL_DEFAULTS.staggerAdvance);
          set('staggerDuration', URL_DEFAULTS.staggerDuration);
        }}
      >
        <DialScope className="flex flex-col gap-1.5">
          <SelectControl
            label="Stroke easing"
            value={settings.strokeEasing}
            options={easingOptions('Default (ease-out quad)')}
            onChange={(v) => set('strokeEasing', v)}
          />
          <SelectControl
            label="Glyph easing"
            value={settings.glyphEasing}
            options={easingOptions('Default (linear)')}
            onChange={(v) => set('glyphEasing', v)}
          />
          <Toggle label="Defer dots" checked={settings.deferDots} onChange={(v) => set('deferDots', v)} />
          <ToggleGroup label="Stagger" checked={settings.staggerEnabled} onChange={(v) => set('staggerEnabled', v)}>
            <TextControl
              label="Advance"
              value={settings.staggerAdvance}
              placeholder="0.3 or 20%"
              onChange={(v) => set('staggerAdvance', v)}
            />
            <TextControl label="Duration" value={settings.staggerDuration} placeholder="auto" onChange={(v) => set('staggerDuration', v)} />
          </ToggleGroup>
        </DialScope>
        <Hint>
          Defer dots draws i-dots, nuqṭa and other detached marks after the word's body strokes. Stagger starts each glyph a fixed advance
          (seconds, or % of the previous glyph) after the last; duration is seconds or <code>auto</code>.
        </Hint>
      </Section>
    </>
  );
}
