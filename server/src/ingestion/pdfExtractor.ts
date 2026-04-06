import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import type { ExtractedDocument, ExtractPage } from './types';

export function toDocId(filePath: string): string {
      return path
            .basename(filePath, path.extname(filePath))
            .toLowerCase()
            .replace(/\s+/g, "-");
}

export function cleanText(input: string): string {
      return input
            .replace(/\u0000/g, "")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
}

export async function extractPdf(filePath: string): Promise<ExtractedDocument> {
      const buffer = await fs.readFile(filePath);
      const parser = new PDFParse({ data: buffer });

      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      await parser.destroy();

      const docId = toDocId(filePath);
      const extractedPages: ExtractPage[] = textResult.pages.map((page) => {
            const text = cleanText(page.text);
            return {
            docId,
            sourcePath: filePath,
            pageNumber: page.num,
            text,
            charCount: text.length,
            };
      });

      return {
            docId,
            sourcePath: filePath,
            title: infoResult.info?.Title || undefined,
            totalPages: textResult.total,
            extractedAt: new Date().toISOString(),
            pages: extractedPages,
      };
}