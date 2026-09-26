import { describe, expect, test } from 'bun:test';
import { DOC_SLUGS, SITE_URL } from '../site.ts';
import { type DocPage, docMarkdown, llmsFullTxt, llmsTxt, orderDocs, sitemapMd, skillMd } from './content.ts';

const docs: DocPage[] = DOC_SLUGS.map((slug) => ({
  slug,
  title: `Title ${slug}`,
  description: `About ${slug}.`,
  body: `Body of ${slug}.`,
}));
const shuffled = [...docs].reverse();

describe('llms.txt', () => {
  const text = llmsTxt(shuffled);

  test('opens with an H1 and a blockquote summary, as llmstxt.org specifies', () => {
    const [h1, blank, quote] = text.split('\n');
    expect(h1).toBe('# Tegaki');
    expect(blank).toBe('');
    expect(quote?.startsWith('> ')).toBe(true);
  });

  test('links every docs page to its Markdown mirror, in sidebar order', () => {
    const linked = [...text.matchAll(/\]\((https:\/\/[^)]+\.md)\)/g)].map((m) => m[1]);
    const mirrors = DOC_SLUGS.map((slug) => `${SITE_URL}${slug}.md`);
    expect(linked.filter((url) => mirrors.includes(url as string))).toEqual(mirrors);
  });

  test('lists the studio and the full-text companion', () => {
    expect(text).toContain(`](${SITE_URL}studio/)`);
    expect(text).toContain(`](${SITE_URL}llms-full.txt)`);
  });
});

test('orderDocs follows the sidebar and puts unlisted pages last', () => {
  const extra = { slug: 'zzz/unlisted', title: 'X', description: '', body: '' };
  expect(orderDocs([extra, ...shuffled]).map((d) => d.slug)).toEqual([...DOC_SLUGS, 'zzz/unlisted']);
});

test('a docs page mirror carries its title, summary and HTML source', () => {
  const md = docMarkdown({ slug: 'guides/streaming', title: 'Streaming Text', description: 'Stream it.', body: 'Hello' });
  expect(md).toBe(`# Streaming Text\n\n> Stream it.\n\nSource: ${SITE_URL}guides/streaming/\n\nHello\n`);
});

test('llms-full.txt holds every docs page', () => {
  const full = llmsFullTxt(shuffled);
  for (const slug of DOC_SLUGS) expect(full).toContain(`Body of ${slug}.`);
});

test('sitemap.md pairs every page with its Markdown mirror', () => {
  const md = sitemapMd(docs);
  for (const slug of DOC_SLUGS)
    expect(md).toContain(`- [Title ${slug}](${SITE_URL}${slug}/): About ${slug}. ([Markdown](${SITE_URL}${slug}.md))`);
});

test('skill.md has the Agent Skills frontmatter', () => {
  const [open, name, description] = skillMd().split('\n');
  expect(open).toBe('---');
  expect(name).toMatch(/^name: [a-z0-9-]+$/);
  expect(description?.startsWith('description: ')).toBe(true);
});
