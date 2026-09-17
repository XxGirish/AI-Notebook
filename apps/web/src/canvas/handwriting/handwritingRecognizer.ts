import type { InkRaster } from "./rasterizeInk";
import type { RecognizerResponse } from "./recognizerProtocol";

type PendingRequest = {
  resolve: (texts: string[]) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
};

let worker: Worker | undefined;
const pending = new Map<string, PendingRequest>();

function getWorker(): Worker {
  if (worker) return worker;
  // Inference runs off the main thread so writing stays smooth while a word converts.
  worker = new Worker(new URL("./recognizer.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<RecognizerResponse>) => {
    const message = event.data;
    const request = pending.get(message.requestId);
    if (!request) return;
    if (message.type === "progress") {
      request.onProgress?.(message.progress);
      return;
    }
    pending.delete(message.requestId);
    if (message.type === "result") request.resolve(message.texts);
    else request.reject(new Error(message.message));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "The handwriting recognizer stopped unexpectedly.");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

/** Recognizes one text line per image entirely on this device. */
export function recognizeHandwriting(images: InkRaster[], onProgress?: (progress: number) => void): Promise<string[]> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress });
    getWorker().postMessage({ requestId, images }, images.map((image) => image.data.buffer as ArrayBuffer));
  });
}
