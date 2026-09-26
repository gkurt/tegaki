import { describe, expect, test } from 'bun:test';
import { quoteArg, tegakiProgram } from './index.ts';

describe('CLI Program', () => {
  test('should have generate command', () => {
    const generateCommand = tegakiProgram.find('generate');
    expect(generateCommand).toBeDefined();
  });
});

describe('quoteArg', () => {
  const parse = (argv: string[]) => tegakiProgram.parse(['generate', ...argv].map(quoteArg).join(' '));

  test('a value with spaces stays one argument', async () => {
    const { args } = await parse(['Dancing Script', '-c', 'Hello World', '-o', 'out dir']);
    expect(args).toMatchObject({ family: 'Dancing Script', chars: 'Hello World', output: 'out dir' });
  });

  test('quotes and backslashes in a value come through as typed', async () => {
    const { args } = await parse(['-c', `say "hi" it's a\\b`]);
    expect(args).toMatchObject({ chars: `say "hi" it's a\\b` });
  });

  test('a plain word is passed unquoted', () => {
    expect(quoteArg('--chars')).toBe('--chars');
    expect(quoteArg('Caveat')).toBe('Caveat');
  });
});
