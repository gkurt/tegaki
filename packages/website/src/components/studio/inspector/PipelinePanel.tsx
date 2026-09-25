import { Folder, SelectControl, Slider, Toggle } from 'dialkit';
import type { LineCap } from 'tegaki';
import {
  CHARSET_PRESETS,
  DEFAULT_GEOMETRY_OPTIONS,
  DEFAULT_OPTIONS,
  enumerateFontChars,
  type GeometryOptions,
  type ParsedFontInfo,
  type PipelineOptions,
  type SkeletonMethod,
} from 'tegaki-generator';
import { type Pipeline, SKELETON_METHODS } from '../../preview/constants.ts';
import { URL_DEFAULTS, type UrlState } from '../../url-state.ts';
import type { CharsetInfo } from '../charsets.ts';
import type { SetSetting } from '../state.ts';
import { Chip, Hint, Section, Segmented } from '../ui.tsx';
import { DialScope } from './dial.tsx';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Options every pipeline reads. */
const SHARED_KEYS = ['lineCap', 'bezierTolerance'] as const satisfies (keyof PipelineOptions)[];
/** Options only the raster pipeline reads. */
const RASTER_KEYS = [
  'resolution',
  'skeletonMethod',
  'dtMethod',
  'rdpTolerance',
  'spurLengthRatio',
  'mergeThresholdRatio',
  'traceLookback',
  'curvatureBias',
  'junctionCleanupIterations',
  'thinMaxIterations',
  'voronoiSamplingInterval',
  'drawingSpeed',
  'strokePause',
] as const satisfies (keyof PipelineOptions)[];

const differs = (opts: PipelineOptions, keys: readonly (keyof PipelineOptions)[]) => keys.some((k) => opts[k] !== DEFAULT_OPTIONS[k]);
const resetKeys = (opts: PipelineOptions, keys: readonly (keyof PipelineOptions)[]): PipelineOptions => ({
  ...opts,
  ...Object.fromEntries(keys.map((k) => [k, DEFAULT_OPTIONS[k]])),
});

const PIPELINE_HINTS: Record<Pipeline, string> = {
  geometry: 'Outline geometry → ink graph, ordered by KanjiVG / Make Me a Hanzi / Hershey / Hangul references. The shipped bundles use it.',
  raster: 'Rasterize → skeletonize → trace. The original pipeline, kept for comparison.',
};

export function PipelinePanel({
  settings,
  set,
  fontInfo,
  charsets,
  onPipelineChange,
}: {
  settings: UrlState;
  set: SetSetting;
  fontInfo: ParsedFontInfo | null;
  charsets: CharsetInfo | null;
  onPipelineChange: (p: Pipeline) => void;
}) {
  const { options, geometryOptions: geo, pipeline } = settings;
  const opt = <K extends keyof PipelineOptions>(key: K, value: PipelineOptions[K]) => set('options', (o) => ({ ...o, [key]: value }));
  const geoOpt = <K extends keyof GeometryOptions>(key: K, value: GeometryOptions[K]) =>
    set('geometryOptions', (g) => ({ ...g, [key]: value }));

  const geoModified = JSON.stringify(geo) !== JSON.stringify(DEFAULT_GEOMETRY_OPTIONS);
  const features = fontInfo?.features ?? [];
  const disabled = options.disabledFeatures;
  const charCount = [...segmenter.segment(settings.chars)].length;
  const rec = charsets?.recommended ?? null;

  return (
    <>
      <Section title="Pipeline" modified={differs(options, SHARED_KEYS)} onReset={() => set('options', (o) => resetKeys(o, SHARED_KEYS))}>
        <Segmented
          value={pipeline}
          onChange={onPipelineChange}
          className="w-full [&>button]:flex-1"
          options={[
            { value: 'geometry', label: 'Geometry' },
            { value: 'raster', label: 'Raster' },
          ]}
        />
        <Hint>{PIPELINE_HINTS[pipeline]}</Hint>
        <DialScope className="mt-1 flex flex-col gap-1.5">
          <SelectControl
            label="Line cap"
            value={options.lineCap}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'round', label: 'Round' },
              { value: 'butt', label: 'Butt' },
              { value: 'square', label: 'Square' },
            ]}
            onChange={(v) => opt('lineCap', v as LineCap | 'auto')}
          />
          <Slider
            label="Bezier tolerance"
            value={options.bezierTolerance}
            min={0.1}
            max={5}
            step={0.1}
            onChange={(v) => opt('bezierTolerance', v)}
          />
        </DialScope>
      </Section>

      {pipeline === 'geometry' ? (
        <Section title="Geometry" modified={geoModified} onReset={() => set('geometryOptions', DEFAULT_GEOMETRY_OPTIONS)}>
          <DialScope className="flex flex-col gap-1.5">
            <SelectControl
              label="Extraction"
              value={geo.extraction}
              options={[
                { value: 'ink-graph', label: 'Ink graph' },
                { value: 'partition', label: 'Partition' },
              ]}
              onChange={(v) => geoOpt('extraction', v as GeometryOptions['extraction'])}
            />
            {geo.extraction === 'partition' && (
              <SelectControl
                label="Medial axis"
                value={geo.medialMethod}
                options={[
                  { value: 'chain', label: 'Chain' },
                  { value: 'voronoi', label: 'Voronoi' },
                  { value: 'straight-skeleton', label: 'Straight skeleton' },
                ]}
                onChange={(v) => geoOpt('medialMethod', v as GeometryOptions['medialMethod'])}
              />
            )}
            <SelectControl
              label="Stroke order"
              value={geo.strokeOrder}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'dataset', label: 'Dataset' },
                { value: 'heuristic', label: 'Heuristic' },
              ]}
              onChange={(v) => geoOpt('strokeOrder', v as GeometryOptions['strokeOrder'])}
            />
            <SelectControl
              label="Han order"
              value={geo.hanLocale}
              options={[
                { value: 'ja', label: 'Japanese (KanjiVG)' },
                { value: 'zh', label: 'Chinese (Make Me a Hanzi)' },
              ]}
              onChange={(v) => geoOpt('hanLocale', v as GeometryOptions['hanLocale'])}
            />
            {geo.extraction === 'ink-graph' ? (
              <>
                <Slider
                  label="Ink sample step"
                  value={geo.inkSampleRatio}
                  min={0.002}
                  max={0.02}
                  step={0.001}
                  unit="em"
                  onChange={(v) => geoOpt('inkSampleRatio', v)}
                />
                <Slider
                  label="Spur tolerance"
                  value={geo.inkSpurTolerance}
                  min={0}
                  max={1.5}
                  step={0.05}
                  unit="r"
                  onChange={(v) => geoOpt('inkSpurTolerance', v)}
                />
                <Slider
                  label="Junction reach"
                  value={geo.inkJunctionReach}
                  min={0.3}
                  max={2}
                  step={0.1}
                  unit="r"
                  onChange={(v) => geoOpt('inkJunctionReach', v)}
                />
                <Toggle label="Absorb serifs" checked={geo.inkSerifs} onChange={(v) => geoOpt('inkSerifs', v)} />
              </>
            ) : (
              <>
                <Slider
                  label="Corner angle"
                  value={geo.cornerAngleThresholdDeg}
                  min={10}
                  max={90}
                  step={1}
                  unit="°"
                  onChange={(v) => geoOpt('cornerAngleThresholdDeg', v)}
                />
                <Slider
                  label="Corner window"
                  value={geo.cornerWindowRatio}
                  min={0.005}
                  max={0.08}
                  step={0.005}
                  unit="em"
                  onChange={(v) => geoOpt('cornerWindowRatio', v)}
                />
                <Slider
                  label="Cut align tolerance"
                  value={geo.cutAlignToleranceDeg}
                  min={10}
                  max={80}
                  step={1}
                  unit="°"
                  onChange={(v) => geoOpt('cutAlignToleranceDeg', v)}
                />
                <Slider
                  label="Max cut length"
                  value={geo.maxCutLengthFactor}
                  min={1}
                  max={6}
                  step={0.1}
                  unit="w"
                  onChange={(v) => geoOpt('maxCutLengthFactor', v)}
                />
                <Slider
                  label="Lobe extent"
                  value={geo.junctionCompactness}
                  min={0.5}
                  max={4}
                  step={0.1}
                  unit="×"
                  onChange={(v) => geoOpt('junctionCompactness', v)}
                />
              </>
            )}
            <Slider
              label="Continuation bend"
              value={geo.continuationMaxBendDeg}
              min={20}
              max={120}
              step={5}
              unit="°"
              onChange={(v) => geoOpt('continuationMaxBendDeg', v)}
            />
            <Slider
              label="Axis spacing"
              value={geo.resampleSpacingRatio}
              min={0.005}
              max={0.06}
              step={0.005}
              unit="em"
              onChange={(v) => geoOpt('resampleSpacingRatio', v)}
            />
          </DialScope>
          <Hint>
            Units: em = fraction of the em square, r = stroke radius, w = stroke width. The ink-graph extraction is the default; partition
            is the earlier face-partition prototype.
          </Hint>
        </Section>
      ) : (
        <Section title="Raster" modified={differs(options, RASTER_KEYS)} onReset={() => set('options', (o) => resetKeys(o, RASTER_KEYS))}>
          <DialScope className="flex flex-col gap-1.5">
            <Slider
              label="Resolution"
              value={options.resolution}
              min={50}
              max={800}
              step={10}
              unit="px"
              onChange={(v) => opt('resolution', v)}
            />
            <SelectControl
              label="Skeleton"
              value={options.skeletonMethod}
              options={SKELETON_METHODS}
              onChange={(v) => opt('skeletonMethod', v as SkeletonMethod)}
            />
            <SelectControl
              label="Distance transform"
              value={options.dtMethod}
              options={[
                { value: 'chamfer', label: 'Chamfer' },
                { value: 'euclidean', label: 'Euclidean' },
              ]}
              onChange={(v) => opt('dtMethod', v as 'euclidean' | 'chamfer')}
            />
            <Folder title="Tracing" defaultOpen={false}>
              <Slider
                label="RDP tolerance"
                value={options.rdpTolerance}
                min={0.1}
                max={10}
                step={0.1}
                onChange={(v) => opt('rdpTolerance', v)}
              />
              <Slider
                label="Spur length"
                value={options.spurLengthRatio}
                min={0}
                max={0.3}
                step={0.01}
                onChange={(v) => opt('spurLengthRatio', v)}
              />
              <Slider
                label="Merge threshold"
                value={options.mergeThresholdRatio}
                min={0}
                max={0.3}
                step={0.01}
                onChange={(v) => opt('mergeThresholdRatio', v)}
              />
              <Slider
                label="Trace lookback"
                value={options.traceLookback}
                min={1}
                max={30}
                step={1}
                onChange={(v) => opt('traceLookback', v)}
              />
              <Slider
                label="Curvature bias"
                value={options.curvatureBias}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => opt('curvatureBias', v)}
              />
              <Slider
                label="Junction cleanup"
                value={options.junctionCleanupIterations}
                min={0}
                max={20}
                step={1}
                onChange={(v) => opt('junctionCleanupIterations', v)}
              />
              {options.skeletonMethod === 'thin' && (
                <Slider
                  label="Thin iterations"
                  value={options.thinMaxIterations}
                  min={1}
                  max={100}
                  step={1}
                  onChange={(v) => opt('thinMaxIterations', v)}
                />
              )}
              {options.skeletonMethod === 'voronoi' && (
                <Slider
                  label="Voronoi sampling"
                  value={options.voronoiSamplingInterval}
                  min={1}
                  max={10}
                  step={0.5}
                  onChange={(v) => opt('voronoiSamplingInterval', v)}
                />
              )}
            </Folder>
            <Folder title="Timing" defaultOpen={false}>
              <Slider
                label="Drawing speed"
                value={options.drawingSpeed}
                min={500}
                max={10000}
                step={100}
                onChange={(v) => opt('drawingSpeed', v)}
              />
              <Slider
                label="Stroke pause"
                value={options.strokePause}
                min={0}
                max={1}
                step={0.01}
                unit="s"
                onChange={(v) => opt('strokePause', v)}
              />
            </Folder>
          </DialScope>
        </Section>
      )}

      <Section title="Characters" modified={settings.chars !== URL_DEFAULTS.chars} onReset={() => set('chars', URL_DEFAULTS.chars)}>
        <div className="flex flex-wrap gap-1">
          {CHARSET_PRESETS.map((p) => {
            const cov = charsets?.coverage.find((c) => c.name === p.name);
            const recommended = charsets?.recommended?.name === p.name;
            return (
              <Chip
                key={p.name}
                selected={settings.chars === p.chars}
                onClick={() => set('chars', p.chars)}
                title={cov ? `${cov.covered}/${cov.total} in this font${recommended ? ' · recommended' : ''}` : undefined}
              >
                {p.name}
                {recommended && <span className="ml-1 text-amber-500">★</span>}
              </Chip>
            );
          })}
          {fontInfo && (
            <Chip
              onClick={() => set('chars', enumerateFontChars(fontInfo.font, fontInfo.extraFonts))}
              title="Every character the font maps"
            >
              All in font
            </Chip>
          )}
        </div>
        <textarea
          aria-label="Characters to generate"
          className="mt-1 h-24 resize-y rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 font-mono text-[12px] leading-relaxed text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
          value={settings.chars}
          onChange={(e) => {
            const seen = new Set<string>();
            const unique: string[] = [];
            for (const { segment } of segmenter.segment(e.target.value)) {
              if (!seen.has(segment)) {
                seen.add(segment);
                unique.push(segment);
              }
            }
            set('chars', unique.join(''));
          }}
        />
        <Hint>
          {charCount} characters go into the downloaded bundle and the glyph list.
          {rec && fontInfo && (
            <>
              {' '}
              <span className="text-amber-500">★</span> {rec.name} is recommended for {fontInfo.family} ({rec.covered}/{rec.total} mapped)
              {settings.chars !== rec.chars && (
                <>
                  {' — '}
                  <button
                    type="button"
                    className="font-medium text-zinc-900 underline dark:text-zinc-100"
                    onClick={() => set('chars', rec.chars)}
                  >
                    use it
                  </button>
                </>
              )}
              .
            </>
          )}
        </Hint>
      </Section>

      <Section
        title="OpenType features"
        defaultOpen={features.length > 0}
        modified={disabled.length > 0}
        onReset={() => opt('disabledFeatures', [])}
        actions={
          features.length > 0 ? (
            <button
              type="button"
              className="h-7 rounded-md px-2 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              onClick={() => opt('disabledFeatures', disabled.length === 0 ? [...features] : [])}
            >
              {disabled.length === 0 ? 'Disable all' : 'Enable all'}
            </button>
          ) : null
        }
      >
        {features.length === 0 ? (
          <Hint>{fontInfo ? 'This font declares no GSUB features.' : 'Load a font to see its features.'}</Hint>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {features.map((f) => {
                const on = !disabled.includes(f);
                return (
                  <Chip
                    key={f}
                    mono
                    selected={on}
                    onClick={() => opt('disabledFeatures', on ? [...disabled, f] : disabled.filter((d) => d !== f))}
                  >
                    {f}
                  </Chip>
                );
              })}
            </div>
            <Hint>Enabled features bring their variant glyphs (ligatures, contextual forms) into the bundle.</Hint>
          </>
        )}
      </Section>
    </>
  );
}
