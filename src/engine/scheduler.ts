export interface ClosableFrame {
  close(): void;
}

/** Keeps one frame in flight and only the newest pending frame. */
export class LatestFrameScheduler<T extends ClosableFrame> {
  private active = false;
  private pending: T | null = null;
  private disposed = false;

  constructor(
    private readonly run: (frame: T) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  submit(frame: T): void {
    if (this.disposed) {
      frame.close();
      return;
    }
    if (this.active) {
      this.pending?.close();
      this.pending = frame;
      return;
    }
    void this.start(frame);
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.close();
    this.pending = null;
  }

  get queued(): number {
    return Number(this.active) + Number(this.pending !== null);
  }

  private async start(frame: T): Promise<void> {
    this.active = true;
    try {
      await this.run(frame);
    } catch (error) {
      this.onError(error);
    } finally {
      this.active = false;
      const next = this.pending;
      this.pending = null;
      if (next) {
        if (this.disposed) next.close();
        else void this.start(next);
      }
    }
  }
}
