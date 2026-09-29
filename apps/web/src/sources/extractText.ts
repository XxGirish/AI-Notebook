import type { TextSegment } from "./chunkText";

/**
 * Reads text out of an uploaded file entirely on the device. The PDF and Word
 * readers are loaded only when a file of that kind is added, so the notebook's
 * start-up bundle does not grow with them.
 */

export type SourceKind = "pdf" | "docx" | "text";

export const MAX_SOURCE_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 1_500;

export const ACCEPTED_SOURCE_TYPES = ".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

export class SourceExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceExtractionError";
  }
}

export function sourceKindOf(file: { name: string; type: string }): SourceKind | undefined {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) return "docx";
  if (file.type.startsWith("text/") || /\.(txt|md|markdown)$/.test(name)) return "text";
  return undefined;
}

async function extractPdf(data: ArrayBuffer, onProgress?: (fraction: number) => void): Promise<{ segments: TextSegment[]; pageCount: number }> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
  let document;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") throw new SourceExtractionError("This PDF is password protected. Remove the password and add it again.");
    throw new SourceExtractionError("This PDF could not be read. It may be damaged.");
  }
  try {
    if (document.numPages > MAX_PDF_PAGES) throw new SourceExtractionError(`This PDF has ${document.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
    const segments: TextSegment[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : (item.str.endsWith(" ") ? "" : " ");
      }
      segments.push({ page: pageNumber, text });
      page.cleanup();
      onProgress?.(pageNumber / document.numPages);
    }
    return { segments, pageCount: document.numPages };
  } finally {
    void loadingTask.destroy();
  }
}

async function extractDocx(data: ArrayBuffer): Promise<TextSegment[]> {
  const mammoth = await import("mammoth");
  try {
    const result = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: data });
    return [{ text: result.value }];
  } catch {
    throw new SourceExtractionError("This Word document could not be read. Only .docx files are supported.");
  }
}

export type ExtractedSource = {
  kind: SourceKind;
  segments: TextSegment[];
  pageCount?: number;
};

export async function extractSourceText(file: File, onProgress?: (fraction: number) => void): Promise<ExtractedSource> {
  const kind = sourceKindOf(file);
  if (!kind) throw new SourceExtractionError("Only PDF, Word (.docx), text and Markdown files can be added.");
  if (file.size > MAX_SOURCE_FILE_BYTES) throw new SourceExtractionError("This file is larger than the 50 MB limit.");
  if (file.size === 0) throw new SourceExtractionError("This file is empty.");

  if (kind === "text") return { kind, segments: [{ text: await file.text() }] };
  const data = await file.arrayBuffer();
  if (kind === "docx") return { kind, segments: await extractDocx(data) };
  const pdf = await extractPdf(data, onProgress);
  return { kind, segments: pdf.segments, pageCount: pdf.pageCount };
}
