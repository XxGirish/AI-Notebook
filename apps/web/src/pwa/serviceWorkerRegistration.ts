export interface ServiceWorkerCallbacks {
  onOfflineReady?: () => void;
  onUpdateReady: () => void;
  onError?: (message: string) => void;
}

export interface NotebookServiceWorker {
  applyUpdate(): boolean;
  checkForUpdate(): Promise<void>;
  dispose(): void;
}

export function registerNotebookServiceWorker(callbacks: ServiceWorkerCallbacks): NotebookServiceWorker | undefined {
  if (!("serviceWorker" in navigator)) return undefined;

  let registration: ServiceWorkerRegistration | undefined;
  let waitingWorker: ServiceWorker | undefined;
  let applyingUpdate = false;
  let reloading = false;

  const announceWorker = (worker: ServiceWorker, isUpdate: boolean) => {
    const handleStateChange = () => {
      if (worker.state !== "installed") return;
      if (isUpdate || navigator.serviceWorker.controller) {
        waitingWorker = worker;
        callbacks.onUpdateReady();
      } else {
        callbacks.onOfflineReady?.();
      }
    };
    worker.addEventListener("statechange", handleStateChange);
    handleStateChange();
  };

  const handleUpdateFound = () => {
    const worker = registration?.installing;
    if (worker) announceWorker(worker, Boolean(navigator.serviceWorker.controller));
  };

  const handleControllerChange = () => {
    if (!applyingUpdate || reloading) return;
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((nextRegistration) => {
    registration = nextRegistration;
    registration.addEventListener("updatefound", handleUpdateFound);
    if (registration.waiting) {
      waitingWorker = registration.waiting;
      callbacks.onUpdateReady();
    }
    return registration.update();
  }).catch((error: unknown) => {
    callbacks.onError?.(error instanceof Error ? error.message : "Offline support could not be started");
  });

  return {
    applyUpdate() {
      if (!waitingWorker) return false;
      applyingUpdate = true;
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      return true;
    },
    async checkForUpdate() {
      await registration?.update();
    },
    dispose() {
      registration?.removeEventListener("updatefound", handleUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    },
  };
}
