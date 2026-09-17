import type { ConnectorObject, NotebookObject, StrokeObject } from "../domain/notebook";
import type { NotebookPage } from "../domain/pages";
import type { AssetRecord } from "../persistence/notebookDatabase";
import { getStrokePath } from "../canvas/strokePath";
import { learningObjectAdapter, type LearningCardObject } from "../domain/learningObjectAdapters";
import { collectDiagrams, diagramAdapter, routeConnector, type ConnectorRoute } from "../domain/diagramAdapter";

type Bounds = { left: number; top: number; right: number; bottom: number };

const EXPORT_MARGIN = 32;
const CARD_PADDING = 18;
const FONT_FAMILY = "Inter, ui-sans-serif, system-ui, sans-serif";

const escapeXml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const finite = (value: number) => Number.isFinite(value) ? value : 0;

function objectBounds(object: NotebookObject, byId: Map<string, NotebookObject>): Bounds | undefined {
  if (object.kind === "connector") {
    const from = byId.get(object.fromId);
    const to = byId.get(object.toId);
    if (!from || !to) return undefined;
    const { x1, y1, x2, y2 } = routeConnector(from, to);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
  }

  if (object.kind === "stroke" && object.points.length > 0) {
    const xs = object.points.map((point) => finite(point.x));
    const ys = object.points.map((point) => finite(point.y));
    const radius = object.size / 2 + 2;
    return {
      left: Math.min(...xs) - radius,
      top: Math.min(...ys) - radius,
      right: Math.max(...xs) + radius,
      bottom: Math.max(...ys) + radius,
    };
  }

  return { left: object.x, top: object.y, right: object.x + object.width, bottom: object.y + object.height };
}

export function getStaticPageBounds(page: NotebookPage): Bounds {
  const byId = new Map(page.objects.map((object) => [object.id, object]));
  const bounds = page.objects.map((object) => objectBounds(object, byId)).filter((value): value is Bounds => Boolean(value));
  const content = bounds.reduce<Bounds>((result, item) => ({
    left: Math.min(result.left, item.left),
    top: Math.min(result.top, item.top),
    right: Math.max(result.right, item.right),
    bottom: Math.max(result.bottom, item.bottom),
  }), { left: 0, top: 0, right: page.width, bottom: page.height });
  return {
    left: Math.floor(content.left - EXPORT_MARGIN),
    top: Math.floor(content.top - EXPORT_MARGIN),
    right: Math.ceil(content.right + EXPORT_MARGIN),
    bottom: Math.ceil(content.bottom + EXPORT_MARGIN),
  };
}

function wrapText(text: string, maxCharacters: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (!line) {
        line = word;
      } else if (`${line} ${word}`.length <= maxCharacters) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function textLines(text: string, x: number, y: number, width: number, options: { size?: number; weight?: number; lineHeight?: number; fill?: string; maxLines?: number } = {}): string {
  const size = options.size ?? 14;
  const lineHeight = options.lineHeight ?? Math.round(size * 1.45);
  const maxCharacters = Math.max(8, Math.floor(width / (size * 0.56)));
  const lines = wrapText(text, maxCharacters).slice(0, options.maxLines ?? 50);
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${options.weight ?? 400}" fill="${options.fill ?? "#506064"}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function cardSvg(object: LearningCardObject): string {
  const model = learningObjectAdapter.toExport(object);
  const background = object.kind === "quiz-card" ? "#fff8ea" : "#ffffff";
  const border = object.kind === "quiz-card" ? "#dbb986" : "#c8c3b7";
  const contentWidth = Math.max(40, object.width - CARD_PADDING * 2);
  const frame = `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" rx="16" fill="${background}" stroke="${border}"/>`;
  const x = object.x + CARD_PADDING;
  const top = object.y + 28;

  if (model.kind === "text") {
    return `<g>${frame}${textLines(model.title, x, top, contentWidth, { size: 16, weight: 700, fill: "#25373b", maxLines: 2 })}${textLines(model.body, x, top + 30, contentWidth, { size: 13, maxLines: Math.max(1, Math.floor((object.height - 66) / 19)) })}</g>`;
  }
  if (model.kind === "equation") {
    return `<g>${frame}${textLines(model.title, x, top, contentWidth, { size: 16, weight: 700, fill: "#25373b", maxLines: 2 })}<text x="${object.x + object.width / 2}" y="${object.y + object.height * 0.68}" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="#25373b">${escapeXml(model.latex)}</text></g>`;
  }

  let cursor = top;
  const parts = [`<g>${frame}<text x="${x}" y="${cursor}" font-family="${FONT_FAMILY}" font-size="10" font-weight="800" letter-spacing="1.5" fill="#9d4e26">QUICK CHECK</text>`];
  cursor += 25;
  const promptLines = wrapText(model.prompt, Math.max(8, Math.floor(contentWidth / 8))).slice(0, 4);
  parts.push(`<text x="${x}" y="${cursor}" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="#25373b">${promptLines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : 20}">${escapeXml(line)}</tspan>`).join("")}</text>`);
  cursor += promptLines.length * 20 + 12;
  for (const option of model.options) {
    if (cursor + 32 > object.y + object.height - 10) break;
    parts.push(`<rect x="${x}" y="${cursor}" width="${contentWidth}" height="30" rx="8" fill="#ffffff" stroke="#d7c6a9"/><text x="${x + 10}" y="${cursor + 20}" font-family="${FONT_FAMILY}" font-size="12" fill="#35474a">${escapeXml(option.label)}</text>`);
    cursor += 37;
  }
  parts.push("</g>");
  return parts.join("");
}

function connectorSvg({ x1, y1, x2, y2 }: ConnectorRoute, label?: string): string {
  const text = label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="11" fill="#537188">${escapeXml(label)}</text>` : "";
  return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#537188" stroke-width="2.5" marker-end="url(#arrow)"/>${text}</g>`;
}

async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function strokeSvg(stroke: StrokeObject): string {
  const opacity = stroke.tool === "highlighter" ? 0.3 : 1;
  return `<path d="${getStrokePath(stroke.points, stroke.size, stroke.tool)}" fill="${escapeXml(stroke.color)}" opacity="${opacity}"/>`;
}

export async function createStaticPageSvg(page: NotebookPage, assets: AssetRecord[]): Promise<string> {
  const bounds = getStaticPageBounds(page);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const byId = new Map(page.objects.map((object) => [object.id, object]));
  const assetByHash = new Map(assets.map((asset) => [asset.hash, asset]));
  const imageUrls = new Map<string, string>();
  for (const object of page.objects) {
    if (object.kind !== "image" || imageUrls.has(object.assetHash)) continue;
    const asset = assetByHash.get(object.assetHash);
    if (!asset) throw new Error(`Static export failed: image asset ${object.assetHash} is missing`);
    imageUrls.set(object.assetHash, await blobDataUrl(asset.blob));
  }

  const diagrams = collectDiagrams(page.objects);
  const diagramMemberIds = new Set(diagrams.flatMap((diagram) => [...diagram.nodes, ...diagram.connectors].map((object) => object.id)));
  const connectors = page.objects.filter((object): object is ConnectorObject => object.kind === "connector" && !diagramMemberIds.has(object.id)).map((connector) => {
    const from = byId.get(connector.fromId);
    const to = byId.get(connector.toId);
    if (!from || !to) return "";
    return connectorSvg(routeConnector(from, to), connector.label);
  }).join("");

  const shapes = page.objects.filter((object) => object.kind === "shape").map((shape) => shape.shape === "ellipse"
    ? `<ellipse cx="${shape.x + shape.width / 2}" cy="${shape.y + shape.height / 2}" rx="${shape.width / 2}" ry="${shape.height / 2}" fill="${escapeXml(shape.fill)}" stroke="${escapeXml(shape.stroke)}" stroke-width="2"/>`
    : `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="12" fill="${escapeXml(shape.fill)}" stroke="${escapeXml(shape.stroke)}" stroke-width="2"/>`).join("");
  const images = page.objects.filter((object) => object.kind === "image").map((object) => `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" href="${imageUrls.get(object.assetHash)}" preserveAspectRatio="xMidYMid meet"/><rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" fill="none" stroke="rgba(44,95,93,0.35)"/>`).join("");
  const diagramGroups = diagrams.map((diagram) => {
    const model = diagramAdapter.toExport(diagram);
    const edges = model.edges.map((item) => connectorSvg(item.route, item.label)).join("");
    const nodes = model.nodes.map((node) => `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="18" fill="#e7f0ef" stroke="#2c5f5d" stroke-width="2"/>${textLines(node.label, node.x + 12, node.y + node.height / 2 + 5, node.width - 24, { size: 16, weight: 600, fill: "#163b3a", maxLines: 2 })}</g>`).join("");
    return `<g role="group"><title>${escapeXml(diagramAdapter.toPlainText(diagram))}</title>${edges}${nodes}</g>`;
  }).join("");
  const cards = page.objects.filter((object): object is LearningCardObject => object.kind === "text-card" || object.kind === "equation-card" || object.kind === "quiz-card").map(cardSvg).join("");
  const highlighters = page.objects.filter((object): object is StrokeObject => object.kind === "stroke" && object.tool === "highlighter").map(strokeSvg).join("");
  const pens = page.objects.filter((object): object is StrokeObject => object.kind === "stroke" && object.tool === "pen").map(strokeSvg).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.left} ${bounds.top} ${width} ${height}" role="img" aria-label="${escapeXml(page.title)}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#537188"/></marker></defs><rect x="${bounds.left}" y="${bounds.top}" width="${width}" height="${height}" fill="#fbfaf5"/>${connectors}${shapes}${images}${diagramGroups}${cards}${highlighters}${pens}</svg>`;
}

export function safeExportFilename(title: string): string {
  const slug = title.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${slug || "notebook-page"}.svg`;
}
