/**
 * Turns a docs page's MDX source into plain Markdown for agents (the `.md`
 * mirrors and llms-full.txt). The docs use a handful of components; each is
 * rewritten to what it shows as text, or dropped when it is only a live demo:
 *
 * - `import` / `export` lines are dropped.
 * - `<InstallTabs pkg="x" />` becomes an `npm install x` block.
 * - `<LiveDemo … />` / `<LiveDemoControlled … />` (possibly spanning lines) are dropped.
 * - `<Tabs>` / `<Steps>` wrappers are dropped; each `<TabItem label="X">` becomes a
 *   bold `X` label, its content dedented to the `<Tabs>` indent.
 * - `:::note` / `:::caution[Title]` asides become blockquotes.
 * - `<video>` blocks become a link to their source.
 * - Root-relative links (`](/tegaki/…)`) become absolute, so the text stands on its own.
 *
 * Code fences pass through untouched, apart from that dedent inside a tab.
 */
export function mdxToMarkdown(source: string, siteOrigin: string): string {
  const lines = stripFrontmatter(source).split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  let tabsIndent = 0;
  let dedent = 0;
  let dedentPending = false;
  let aside: string | null = null; // the aside's indent while inside one

  const emit = (line: string) => {
    if (aside === null) out.push(line);
    else out.push(line.trim() ? `${aside}> ${line.slice(Math.min(aside.length, indentOf(line)))}` : `${aside}>`);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (dedentPending && raw.trim()) {
      dedent = Math.max(0, indentOf(raw) - tabsIndent);
      dedentPending = false;
    }
    const line = raw.slice(Math.min(dedent, indentOf(raw)));
    const trimmed = line.trim();
    const indent = ' '.repeat(indentOf(line));

    if (fence !== null) {
      emit(line);
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    const fenceOpen = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceOpen) {
      fence = fenceOpen[1] ?? '```';
      emit(line);
      continue;
    }

    if (/^(import|export)\s/.test(raw)) continue;

    const asideOpen = trimmed.match(/^:::(note|tip|caution|danger)(?:\[(.+)\])?$/);
    if (asideOpen) {
      const kind = asideOpen[1] ?? 'note';
      out.push(`${indent}> **${asideOpen[2] ?? kind.charAt(0).toUpperCase() + kind.slice(1)}**`, `${indent}>`);
      aside = indent;
      continue;
    }
    if (aside !== null && trimmed === ':::') {
      aside = null;
      continue;
    }

    const install = trimmed.match(/^<InstallTabs(?:\s+pkg="([^"]+)")?\s*\/>$/);
    if (install) {
      out.push(`${indent}\`\`\`sh`, `${indent}npm install ${install[1] ?? 'tegaki'}`, `${indent}\`\`\``);
      continue;
    }
    if (/^<LiveDemo\w*(\s|\/|>|$)/.test(trimmed)) {
      while (i < lines.length && !(lines[i] ?? '').includes('/>')) i++;
      continue;
    }
    if (/^<Tabs(\s|>)/.test(trimmed)) {
      tabsIndent = indent.length;
      continue;
    }
    const tab = trimmed.match(/^<TabItem\s+label="([^"]+)"[^>]*>$/);
    if (tab) {
      if (out.at(-1)?.trim()) out.push('');
      out.push(`${' '.repeat(tabsIndent)}**${tab[1]}**`, '');
      dedent = 0;
      dedentPending = true;
      continue;
    }
    if (trimmed === '</TabItem>' || trimmed === '</Tabs>') {
      dedent = 0;
      continue;
    }
    if (/^<\/?Steps>$/.test(trimmed)) continue;
    if (/^<video(\s|>)/.test(trimmed)) {
      let src = '';
      for (; i < lines.length; i++) {
        src ||= (lines[i] ?? '').match(/src="([^"]+)"/)?.[1] ?? '';
        if ((lines[i] ?? '').includes('</video>')) break;
      }
      if (src) out.push(`${indent}[Watch the video (${src.split('/').pop()})](${absolutize(src, siteOrigin)})`);
      continue;
    }

    emit(absolutizeLinks(line, siteOrigin));
  }

  return out
    .join('\n')
    .replace(/\n[ \t]*(\n[ \t]*)+\n/g, '\n\n')
    .replace(/^(\s*\n)+|\s+$/g, '');
}

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function absolutize(href: string, siteOrigin: string): string {
  return href.startsWith('/') ? `${siteOrigin}${href}` : href;
}

/** `](/path)` → `](https://site/path)`, leaving inline code alone. */
function absolutizeLinks(line: string, siteOrigin: string): string {
  return line
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith('`') ? part : part.replace(/\]\((\/[^)\s]*)\)/g, (_, href: string) => `](${siteOrigin}${href})`)))
    .join('');
}
