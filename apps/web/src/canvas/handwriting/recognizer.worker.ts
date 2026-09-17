/// <reference lib="webworker" />
import { env, pipeline, RawImage } from "@huggingface/transformers";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortFactoryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import { HANDWRITING_MODEL, HANDWRITING_MODEL_REVISION, type RecognizerRequest, type RecognizerResponse } from "./recognizerProtocol";

type ImageToText = (image: RawImage, options: { max_new_tokens: number }) => Promise<Array<{ generated_text: string }>>;

// Weights come from the pinned hub revision and are kept in the browser's
// Cache Storage, so recognition keeps working offline after the first download.
env.allowLocalModels = false;
env.useBrowserCache = true;
// Serve the inference runtime from this app instead of transformers.js's
// default third-party CDN; it is same-origin and cached like the app shell.
const onnxWasm = env.backends.onnx.wasm;
if (onnxWasm) onnxWasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.href).href, mjs: new URL(ortFactoryUrl, self.location.href).href };

let recognizer: Promise<ImageToText> | undefined;
let activeRequestId = "";
const post = (message: RecognizerResponse) => self.postMessage(message);

function loadRecognizer(): Promise<ImageToText> {
  recognizer ??= (pipeline("image-to-text", HANDWRITING_MODEL, {
    revision: HANDWRITING_MODEL_REVISION,
    dtype: "q8",
    device: "wasm",
    progress_callback: (info: { status: string; progress?: number }) => {
      if (info.status === "progress_total" && typeof info.progress === "number") {
        post({ type: "progress", requestId: activeRequestId, progress: info.progress });
      }
    },
  }) as unknown as Promise<ImageToText>).catch((error: unknown) => {
    recognizer = undefined;
    throw error;
  });
  return recognizer;
}

function toRgb({ data, width, height }: RecognizerRequest["images"][number]): RawImage {
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let source = 0, target = 0; source < data.length; source += 4, target += 3) {
    rgb[target] = data[source];
    rgb[target + 1] = data[source + 1];
    rgb[target + 2] = data[source + 2];
  }
  return new RawImage(rgb, width, height, 3);
}

self.onmessage = async (event: MessageEvent<RecognizerRequest>) => {
  const { requestId, images } = event.data;
  activeRequestId = requestId;
  try {
    const recognize = await loadRecognizer();
    const texts: string[] = [];
    for (const image of images) {
      const [output] = await recognize(toRgb(image), { max_new_tokens: 64 });
      texts.push(output?.generated_text ?? "");
    }
    post({ type: "result", requestId, texts });
  } catch (error) {
    post({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
