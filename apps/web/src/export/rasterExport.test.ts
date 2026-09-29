import { describe, expect, it } from "vitest";
import { MAX_PNG_PIXELS, pngScaleFor, printDocumentFor } from "./rasterExport";
import { safeExportFilename } from "./staticPageExport";

describe("PNG and print export", () => {
  it("renders at twice the page size unless that would exceed the canvas limit", () => {
    expect(pngScaleFor(1280, 820)).toBe(2);
    const huge = pngScaleFor(20_000, 10_000);
    expect(huge).toBeLessThan(1);
    expect(20_000 * huge * 10_000 * huge).toBeLessThanOrEqual(MAX_PNG_PIXELS + 1);
  });

  it("names PNG files like SVG ones", () => {
    expect(safeExportFilename("Forces & motion", "png")).toBe("forces-motion.png");
    expect(safeExportFilename("Forces & motion")).toBe("forces-motion.svg");
  });

  it("wraps the page in a printable document without letting the title inject markup", () => {
    const html = printDocumentFor("<svg></svg>", "<script>alert(1)</script> & notes");
    expect(html).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; notes</title>");
    expect(html).toContain("@page");
    expect(html).toContain("<body><svg></svg></body>");
  });
});
