import { describe, expect, test } from 'bun:test';
import { tegakiProgram } from './index.ts';

describe('CLI Program', () => {
  test('should have generate command', () => {
    const generateCommand = tegakiProgram.find('generate');
    expect(generateCommand).toBeDefined();
  });
});
