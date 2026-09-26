import { describe, expect, test } from 'bun:test';
import { mdxToMarkdown } from './mdx-to-markdown.ts';

const ORIGIN = 'https://example.com';
const md = (source: string) => mdxToMarkdown(source, ORIGIN);

describe('mdxToMarkdown', () => {
  test('drops the frontmatter and the ESM imports', () => {
    expect(md("---\ntitle: T\n---\n\nimport X from './x';\n\nHello")).toBe('Hello');
  });

  test('turns InstallTabs into an npm install block, keeping its indent', () => {
    expect(md('<InstallTabs />')).toBe('```sh\nnpm install tegaki\n```');
    expect(md('   <InstallTabs pkg="tegaki-generator" />')).toBe('   ```sh\n   npm install tegaki-generator\n   ```');
  });

  test('drops live demos, including ones spanning several lines', () => {
    expect(md('A\n\n<LiveDemo client:load text="Hi" />\n\nB')).toBe('A\n\nB');
    expect(md('A\n\n<LiveDemo\n  client:only="vue"\n  effects={{ glow: true }}\n/>\n\nB')).toBe('A\n\nB');
    expect(md('A\n\n<LiveDemoControlled client:load />\n\nB')).toBe('A\n\nB');
  });

  test('labels each tab and dedents its content to the Tabs indent', () => {
    const source = ['<Tabs>', '  <TabItem label="React">', '    ```tsx', '    <A />', '    ```', '  </TabItem>', '</Tabs>'].join('\n');
    expect(md(source)).toBe('**React**\n\n```tsx\n<A />\n```');
  });

  test('separates consecutive tabs with a blank line', () => {
    const source = [
      '<Tabs>',
      '  <TabItem label="A">',
      '    a',
      '  </TabItem>',
      '  <TabItem label="B">',
      '    b',
      '  </TabItem>',
      '</Tabs>',
    ].join('\n');
    expect(md(source)).toBe('**A**\n\na\n\n**B**\n\nb');
  });

  test('keeps tabs nested in a list item inside that item', () => {
    const source = ['1. Step', '', '   <Tabs>', '     <TabItem label="Vue">', '       Text', '     </TabItem>', '   </Tabs>'].join('\n');
    expect(md(source)).toBe('1. Step\n\n   **Vue**\n\n   Text');
  });

  test('turns asides into blockquotes titled by their label', () => {
    expect(md(':::caution[Heads up]\nBe careful.\n:::')).toBe('> **Heads up**\n>\n> Be careful.');
    expect(md(':::note\nFYI.\n:::')).toBe('> **Note**\n>\n> FYI.');
    expect(md('   :::caution[Indented]\n   Body\n   :::')).toBe('   > **Indented**\n   >\n   > Body');
  });

  test('replaces a video with a link to its source', () => {
    const source = '<video controls>\n  <source src="/tegaki/videos/a.mp4" type="video/mp4" />\n</video>';
    expect(md(source)).toBe('[Watch the video (a.mp4)](https://example.com/tegaki/videos/a.mp4)');
  });

  test('makes root-relative links absolute, but not inside code', () => {
    expect(md('See [docs](/tegaki/x/#y) and `[a](/b)`.')).toBe('See [docs](https://example.com/tegaki/x/#y) and `[a](/b)`.');
    expect(md('```md\n[a](/b)\n```')).toBe('```md\n[a](/b)\n```');
  });

  test('leaves JSX-looking lines inside code fences alone', () => {
    const source = '```tsx\nimport x from "y";\n<Tabs>\n<LiveDemo />\n```';
    expect(md(source)).toBe(source);
  });

  test('collapses the blank lines a dropped component leaves behind', () => {
    expect(md('A\n\n<Steps>\n\n1. B\n\n</Steps>\n\nC')).toBe('A\n\n1. B\n\nC');
  });
});
