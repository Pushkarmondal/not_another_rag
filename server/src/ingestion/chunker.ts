import type { ChunkRecord, ExtractedDocument } from "./types";

export type ChunkOptions = {
      chunkSize?: number;
      overlap?: number;
      minChunkSize?: number;
};

const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_OVERLAP = 150;
const DEFAULT_MIN_CHUNK_SIZE = 120;

function normalizeWhitespace(text: string): string {
      return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function splitIntoWindows( text: string, chunkSize: number, overlap: number, minChunkSize: number): { text: string; startChar: number; endChar: number }[] {
      const clean = normalizeWhitespace(text);
      if (!clean) return [];

      const chunks: { text: string; startChar: number; endChar: number }[] = [];
      const step = Math.max(1, chunkSize - overlap);
      let start = 0;

      while (start < clean.length) {
            let end = Math.min(start + chunkSize, clean.length);

            if (end < clean.length) {
                  const lastSpace = clean.lastIndexOf(" ", end);
                  if (lastSpace > start + Math.floor(chunkSize * 0.6)) {
                        end = lastSpace;
                  }
            }

            const windowText = clean.slice(start, end).trim();
            if (windowText.length >= minChunkSize) {
                  chunks.push({
                        text: windowText,
                        startChar: start,
                        endChar: end,
                  });
            }

            if (end >= clean.length) break;
            start += step;
      }

      return chunks;
}

export function chunkDocument( document: ExtractedDocument, options: ChunkOptions = {} ): ChunkRecord[] {
      const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const overlap = options.overlap ?? DEFAULT_OVERLAP;
      const minChunkSize = options.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;

      if (overlap >= chunkSize) {
            throw new Error("Chunk overlap must be smaller than chunk size.");
      }

      const chunks: ChunkRecord[] = [];

      for (const page of document.pages) {
            const pageWindows = splitIntoWindows(page.text, chunkSize, overlap, minChunkSize);

            for (let i = 0; i < pageWindows.length; i++) {
                  const pageChunk = pageWindows[i];
                  chunks.push({
                        chunkId: `${document.docId}-p${page.pageNumber}-c${i}`,
                        docId: document.docId,
                        sourcePath: document.sourcePath,
                        title: document.title,
                        pageNumber: page.pageNumber,
                        chunkIndex: i,
                        text: pageChunk!.text,
                        charCount: pageChunk!.text.length,
                        startChar: pageChunk!.startChar,
                        endChar: pageChunk!.endChar,
                  });
            }
      }

      return chunks;
}
