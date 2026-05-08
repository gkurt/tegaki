declare module 'harfbuzzjs' {
  export interface HbBlob {
    ptr: number;
    destroy(): void;
  }

  export interface HbFace {
    ptr: number;
    upem: number;
    destroy(): void;
    collectUnicodes(): Uint32Array;
    getTableFeatureTags(table: 'GSUB' | 'GPOS'): string[];
    reference_table(table: string): Uint8Array | undefined;
  }

  export interface HbFont {
    ptr: number;
    setScale(xScale: number, yScale: number): void;
    glyphToPath(glyphId: number): string;
    glyphName(glyphId: number): string;
    glyphHAdvance(glyphId: number): number;
    destroy(): void;
  }

  export interface HbShapedGlyph {
    g: number;
    cl: number;
    ax: number;
    ay: number;
    dx: number;
    dy: number;
    flags: number;
  }

  export interface HbBuffer {
    ptr: number;
    addText(text: string, itemOffset?: number, itemLength?: number | null): void;
    guessSegmentProperties(): void;
    setDirection(dir: 'ltr' | 'rtl' | 'ttb' | 'btt'): void;
    setLanguage(lang: string): void;
    setScript(script: string): void;
    getLength(): number;
    json(): HbShapedGlyph[];
    destroy(): void;
  }

  export interface Hb {
    createBlob(data: ArrayBuffer | Uint8Array): HbBlob;
    createFace(blob: HbBlob, index: number): HbFace;
    createFont(face: HbFace): HbFont;
    createBuffer(): HbBuffer;
    shape(font: HbFont, buffer: HbBuffer, features?: string): void;
  }

  const hbPromise: Promise<Hb>;
  export default hbPromise;
}

declare module 'harfbuzzjs/hb.js' {
  interface HbModuleOptions {
    locateFile?: (path: string) => string;
  }
  const createHarfBuzz: (options?: HbModuleOptions) => Promise<unknown>;
  export default createHarfBuzz;
}

declare module 'harfbuzzjs/hbjs.js' {
  import type { Hb } from 'harfbuzzjs';

  const hbjs: (instance: unknown) => Hb;
  export default hbjs;
}
