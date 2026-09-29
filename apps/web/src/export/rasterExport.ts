/**
 * PNG and print output, both made from the same document-driven SVG as the
 * SVG export, so every format shows the same content: off-screen objects,
 * cards, equations as their LaTeX source, ink and embedded images.
 */

/** Below the smallest canvas limit among target browsers (iOS Safari, about 16.7 million pixels). */
export const MAX_PNG_PIXELS = 16_000_000;

/** Twice the page size for sharp text, reduced when that would exceed the canvas limit. */
export function pngScaleFor(width: number, height: number, preferred = 2): number {
  const area = Math.max(1, width * height);
  return Math.min(preferred, Math.sqrt(MAX_PNG_PIXELS / area));
}

export async function svgToPngBlob(svg: string, width: number, height: number, scale = pngScaleFor(width, height)): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot draw the page to an image");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The page image could not be encoded"))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A standalone document that prints one page scaled to the paper's width. */
export function printDocumentFor(svg: string, title: string): string {
  const escapedTitle = title.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapedTitle}</title><style>@page { margin: 12mm; } html, body { margin: 0; background: white; } svg { display: block; width: 100%; height: auto; }</style></head><body>${svg}</body></html>`;
}

/**
 * Prints through a hidden frame, so the application itself is not what gets
 * printed and no pop-up window is needed. The frame is removed afterwards.
 */
export function printSvg(svg: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position: fixed; right: 0; bottom: 0; width: 0; height: 0; border: 0; visibility: hidden;";
    const cleanUp = () => window.setTimeout(() => frame.remove(), 1_000);
    frame.onload = () => {
      const view = frame.contentWindow;
      if (!view) {
        cleanUp();
        reject(new Error("The page could not be prepared for printing"));
        return;
      }
      view.addEventListener("afterprint", cleanUp, { once: true });
      view.focus();
      view.print();
      resolve();
    };
    frame.srcdoc = printDocumentFor(svg, title);
    document.body.append(frame);
  });
}
