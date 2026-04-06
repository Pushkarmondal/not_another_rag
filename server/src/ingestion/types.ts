export type ExtractPage = {
      docId: string,
      sourcePath: string,
      pageNumber: number,
      text: string,
      charCount: number
}

export type ExtractedDocument = {
      docId: string,
      sourcePath: string,
      title?: string,
      totalPages: number,
      extractedAt: string,
      pages: ExtractPage[]
}

export type ChunkRecord = {
      chunkId: string,
      docId: string,
      sourcePath: string,
      title?: string,
      pageNumber: number,
      chunkIndex: number,
      text: string,
      charCount: number,
      startChar: number,
      endChar: number
}