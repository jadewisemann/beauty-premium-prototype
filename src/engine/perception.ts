import type { FrameMeta, Mat3, PerceptionRole, WorkerRequest, WorkerResponse } from './contracts';

type ResponseListener = (message: WorkerResponse) => void;

export interface PerceptionFrame {
  bitmap: ImageBitmap;
  meta: FrameMeta;
  poseAtSource?: Mat3 | null;
  close(): void;
}

export class PerceptionClient {
  private readonly worker: Worker;
  private readonly listeners = new Set<ResponseListener>();
  private readonly modeRequests = new Map<number, { resolve(): void; reject(error: Error): void }>();
  private readonly frameRequests = new Map<string, { resolve(): void; reject(error: Error): void }>();
  private initRequest: { resolve(): void; reject(error: Error): void } | null = null;
  private requestId = 0;

  constructor(private readonly role: PerceptionRole) {
    this.worker = new Worker(new URL('./perception.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event) => this.failAll(new Error(event.message || 'Perception worker failed'));
  }

  init(assetManifest = '/models/models.manifest.json'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.initRequest = { resolve, reject };
      this.post({ type: 'INIT', assetManifest, role: this.role });
    });
  }

  setMode(mode: 'IMAGE' | 'VIDEO', generation: number): Promise<void> {
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.modeRequests.set(requestId, { resolve, reject });
      this.post({ type: 'SET_MODE', requestId, mode, generation });
    });
  }

  analyze(frame: PerceptionFrame): Promise<void> {
    const key = frameKey(frame.meta);
    return new Promise((resolve, reject) => {
      this.frameRequests.set(key, { resolve, reject });
      this.post({
        type: 'FRAME',
        meta: frame.meta,
        bitmap: frame.bitmap,
        poseAtSource: frame.poseAtSource,
      }, [frame.bitmap]);
    });
  }

  recycle(buffer: ArrayBuffer): void {
    if (!buffer.byteLength) return;
    this.post({ type: 'RECYCLE_BUFFER', buffer }, [buffer]);
  }

  subscribe(listener: ResponseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.post({ type: 'DISPOSE' });
    this.worker.terminate();
    this.failAll(new Error('Perception client disposed'));
    this.listeners.clear();
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  private handle(message: WorkerResponse): void {
    if (message.type === 'READY') {
      this.initRequest?.resolve();
      this.initRequest = null;
    } else if (message.type === 'MODE_READY') {
      this.modeRequests.get(message.requestId)?.resolve();
      this.modeRequests.delete(message.requestId);
    } else if (message.type === 'FRAME_DONE') {
      this.frameRequests.get(frameKey(message.frame))?.resolve();
      this.frameRequests.delete(frameKey(message.frame));
    } else if (message.type === 'ERROR') {
      const error = new Error(`${message.code}: ${message.message}`);
      if (this.initRequest) {
        this.initRequest.reject(error);
        this.initRequest = null;
      }
      for (const [requestId, request] of this.modeRequests) {
        request.reject(error);
        this.modeRequests.delete(requestId);
      }
      if (message.frameId !== undefined) {
        const key = `${message.generation}:${message.frameId}`;
        this.frameRequests.get(key)?.reject(error);
        this.frameRequests.delete(key);
      }
    }
    this.listeners.forEach((listener) => listener(message));
  }

  private failAll(error: Error): void {
    this.initRequest?.reject(error);
    this.initRequest = null;
    this.modeRequests.forEach(({ reject }) => reject(error));
    this.modeRequests.clear();
    this.frameRequests.forEach(({ reject }) => reject(error));
    this.frameRequests.clear();
  }
}

function frameKey(frame: FrameMeta): string {
  return `${frame.generation}:${frame.frameId}`;
}
