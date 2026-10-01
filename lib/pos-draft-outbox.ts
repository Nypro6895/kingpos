// Only replaceable receipt snapshots belong here. Never enqueue payments,
// attendance credentials, ticket finalization or booking confirmations.
export type DraftOperation<T> = { id: string; expectedVersion: number; payload: T };
export type DraftReply = { kind: "ok"; version: number } |
  { kind: "retry" } | { kind: "blocked"; message: string };
export type DraftOutboxState<T> = {
  schema: 1; version: number; head: DraftOperation<T> | null;
  next: T | null; blocked: string | null;
};

export class DraftOutbox<T> {
  state: DraftOutboxState<T>;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private stopped = false;
  private listeners = new Set<() => void>();
  storageError = false;

  constructor(private options: {
    version: number;
    restored?: DraftOutboxState<T>;
    persist: (state: DraftOutboxState<T>) => void;
    send: (operation: DraftOperation<T>) => Promise<DraftReply>;
    online: () => boolean;
    id: () => string;
  }) {
    this.state = options.restored ? structuredClone(options.restored) : {
      schema: 1, version: options.version, head: null, next: null, blocked: null,
    };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get pending() { return !!(this.state.head || this.state.next); }

  private save() {
    if (this.stopped) return;
    try { this.options.persist(this.state); this.storageError = false; }
    catch { this.storageError = true; }
    this.listeners.forEach((listener) => listener());
  }

  enqueue(payload: T) {
    if (this.stopped) return;
    const latest = this.state.next ?? this.state.head?.payload;
    if (latest && JSON.stringify(latest) === JSON.stringify(payload)) return;
    this.state.next = payload;
    this.save();
    this.wake();
  }

  // Adopt remote versions only when no local work could be overwritten.
  observeVersion(version: number, compatible = true) {
    if (!this.pending && version > this.state.version) {
      if (compatible) this.state.version = version;
      else this.state.blocked = "Receipt amounts changed on another screen. Review the server receipt before continuing.";
      this.save();
    }
  }

  wake(delay = 75) {
    if (this.stopped || this.running || this.timer || this.state.blocked || !this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.pump();
    }, delay);
  }

  async pump() {
    if (this.stopped || this.running || this.state.blocked || !this.pending || !this.options.online()) return;
    if (!this.state.head && this.state.next) {
      this.state.head = { id: this.options.id(), expectedVersion: this.state.version, payload: this.state.next };
      this.state.next = null;
      // Persist the exact operation BEFORE dispatch, including its identity.
      this.save();
    }
    this.running = true;
    let result: DraftReply;
    try { result = await this.options.send(this.state.head!); }
    catch { result = { kind: "retry" }; }
    this.running = false;
    if (this.stopped) return;
    if (result.kind === "ok") {
      this.state.version = result.version;
      this.state.head = null;
      this.attempts = 0;
    } else if (result.kind === "blocked") {
      this.state.blocked = result.message;
    } else {
      this.attempts += 1;
    }
    this.save();
    this.wake(result.kind === "retry" ? Math.min(30_000, 1000 * 2 ** Math.min(this.attempts - 1, 5)) : 0);
  }

  async flush(timeoutMs = 10_000): Promise<boolean> {
    if (!this.pending) return !this.state.blocked;
    if (!this.options.online() || this.state.blocked) return false;
    void this.pump();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { unsubscribe(); resolve(false); }, timeoutMs);
      const unsubscribe = this.subscribe(() => {
        if (!this.pending || this.state.blocked) {
          clearTimeout(timeout); unsubscribe(); resolve(!this.pending && !this.state.blocked);
        }
      });
    });
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }
}
