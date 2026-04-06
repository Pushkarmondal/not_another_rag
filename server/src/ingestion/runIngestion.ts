// src/ingestion/runIngestion.ts
import fs from "node:fs/promises";
import path from "node:path";
import { extractPdf } from "./pdfExtractor";

const INPUT_DIR = path.resolve("data/raw-pdf");
const OUTPUT_DIR = path.resolve("data/extracted");

async function main() {
      await fs.mkdir(OUTPUT_DIR, { recursive: true });

      const files = await fs.readdir(INPUT_DIR);
      const pdfFiles = files.filter((f) => f.toLowerCase().endsWith(".pdf"));

      for (const file of pdfFiles) {
            const fullPath = path.join(INPUT_DIR, file);
            const extracted = await extractPdf(fullPath);

            // One file per doc for now
            const outPath = path.join(OUTPUT_DIR, `${extracted.docId}.json`);
            await fs.writeFile(outPath, JSON.stringify(extracted, null, 2), "utf8");
            console.log(`Extracted: ${file} -> ${outPath}`);
      }

      console.log(`Done. Processed ${pdfFiles.length} PDF(s).`);
}

main().catch((err) => {
      console.error(err);
      process.exit(1);
});