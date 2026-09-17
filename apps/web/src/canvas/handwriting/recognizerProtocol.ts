import type { InkRaster } from "./rasterizeInk";

// Pinned so a notebook's conversions are reproducible and a model update is a
// deliberate change rather than something the hub can swap underneath us.
export const HANDWRITING_MODEL = "Xenova/trocr-small-handwritten";
export const HANDWRITING_MODEL_REVISION = "2432e24d184b1d964d07ed04f5d9e21d31a59141";
export const HANDWRITING_RECOGNIZER_ID = `trocr-small-handwritten-q8@${HANDWRITING_MODEL_REVISION.slice(0, 8)}`;

export type RecognizerRequest = { requestId: string; images: InkRaster[] };

export type RecognizerResponse =
  | { type: "progress"; requestId: string; progress: number }
  | { type: "result"; requestId: string; texts: string[] }
  | { type: "error"; requestId: string; message: string };
