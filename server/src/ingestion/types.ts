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