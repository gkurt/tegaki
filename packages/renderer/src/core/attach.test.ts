import { describe, expect, test } from 'bun:test';
import { type Attachment, type PluginErrorHandler, syncAttachments } from './plugins.ts';
import type { TegakiAttachContext, TegakiPlugin } from './types.ts';

/** A plugin that logs when it's attached and detached, and keeps the context it was given. */
function logged(name: string, log: string[]): TegakiPlugin & { ctx?: TegakiAttachContext } {
  const plugin: TegakiPlugin & { ctx?: TegakiAttachContext } = {
    name,
    attach(ctx) {
      plugin.ctx = ctx;
      log.push(`+${name}`);
      return () => log.push(`-${name}`);
    },
  };
  return plugin;
}

const noError: PluginErrorHandler = (plugin, hook, error) => {
  throw new Error(`${plugin.name}.${hook}: ${error}`);
};

/** An engine's bookkeeping: its attachments and the redraws its plugins ask for. */
function engine() {
  const attached = new Map<TegakiPlugin, Attachment>();
  let redraws = 0;
  const context = (a: Attachment): TegakiAttachContext => ({
    redraw: () => {
      if (a.live) redraws++;
    },
  });
  return {
    attached,
    sync: (plugins: TegakiPlugin[], onError = noError) => syncAttachments(attached, plugins, context, onError),
    redraws: () => redraws,
  };
}

describe('attach', () => {
  test('a plugin is attached once when the engine starts running it, and detached when it stops', () => {
    const log: string[] = [];
    const a = logged('a', log);
    const b = logged('b', log);
    const e = engine();
    e.sync([a]);
    e.sync([a, b]);
    e.sync([b]);
    expect(log).toEqual(['+a', '+b', '-a']);
  });

  test('removed plugins are detached before new ones are attached', () => {
    const log: string[] = [];
    const [a, b, c] = ['a', 'b', 'c'].map((n) => logged(n, log));
    const e = engine();
    e.sync([a!, b!]);
    e.sync([c!]);
    expect(log).toEqual(['+a', '+b', '-a', '-b', '+c']);
  });

  test('a plugin listed twice is attached once', () => {
    const log: string[] = [];
    const a = logged('a', log);
    const e = engine();
    e.sync([a, a]);
    expect(log).toEqual(['+a']);
  });

  test('a destroyed engine detaches every plugin', () => {
    const log: string[] = [];
    const e = engine();
    e.sync([logged('a', log), logged('b', log)]);
    e.sync([]);
    expect(log).toEqual(['+a', '+b', '-a', '-b']);
    expect(e.attached.size).toBe(0);
  });

  test('a plugin two engines share is attached to each, and released by each', () => {
    const log: string[] = [];
    const a = logged('a', log);
    const one = engine();
    const two = engine();
    one.sync([a]);
    two.sync([a]);
    one.sync([]);
    expect(log).toEqual(['+a', '+a', '-a']);
  });

  test('redraw works while the plugin is attached, and does nothing after', () => {
    const a = logged('a', []);
    const e = engine();
    e.sync([a]);
    const ctx = a.ctx!;
    ctx.redraw();
    e.sync([]);
    ctx.redraw();
    expect(e.redraws()).toBe(1);
  });

  test('a plugin without attach is left alone, and one that throws is reported and still detached', () => {
    const errors: string[] = [];
    const log: string[] = [];
    const broken: TegakiPlugin = {
      name: 'broken',
      attach: () => () => {
        throw new Error('no');
      },
    };
    const e = engine();
    const report: PluginErrorHandler = (p, hook) => {
      errors.push(`${p.name}.${hook}`);
    };
    e.sync([{ name: 'plain' }, broken, logged('a', log)], report);
    expect([...e.attached.keys()].map((p) => p.name)).toEqual(['broken', 'a']);
    e.sync([], report);
    expect(errors).toEqual(['broken.attach']);
    expect(log).toEqual(['+a', '-a']);
  });
});
