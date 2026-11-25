import { Connection } from "../dist/connection.js";
import type { HaWebSocket } from "../dist/socket.js";

class MockWebSocket {
  addEventListener(eventType: string, callback: () => {}) {}
  removeEventListener(eventType: string, callback: () => {}) {}
  send(message: string) {}
  close() {}
}

export class MockConnection extends Connection {
  private _mockListeners: { [event: string]: ((data: any) => void)[] };
  private _mockResponses: {};

  constructor() {
    super(new MockWebSocket() as HaWebSocket, {} as any);
    this._mockListeners = {};
    this._mockResponses = {};
  }

  // hass events
  async subscribeEvents<EventType>(
    eventCallback: (ev: EventType) => void,
    eventType?: string,
  ) {
    if (!eventType) {
      throw new Error("mock all events not implemented");
    }
    if (!(eventType in this._mockListeners)) {
      this._mockListeners[eventType] = [];
    }
    this._mockListeners[eventType].push(eventCallback);
    return () => Promise.resolve();
  }

  async subscribeMessage<Result>(
    eventCallback: (result: Result) => void,
    subscribeMessage: { type: string },
  ) {
    if (!(subscribeMessage.type in this._mockListeners)) {
      this._mockListeners[subscribeMessage.type] = [];
    }
    this._mockListeners[subscribeMessage.type].push(eventCallback);
    return () => Promise.resolve();
  }

  mockEvent(event: any, data: any) {
    this._mockListeners[event].forEach((cb) => cb(data));
  }

  mockResponse(type: any, data: any) {
    // @ts-ignore
    this._mockResponses[type] = data;
  }

  async sendMessagePromise(message: any) {
    if (message.type in this._mockResponses) {
      // @ts-ignore
      return this._mockResponses[message.type];
    }
    throw new Error("Unexpected type");
  }
}

// Collect the unhandled rejections raised while `run` executes. Mocha's own
// handler is detached meanwhile, it would fail the test on the first one.
export const unhandledDuring = async (run: () => Promise<void> | void) => {
  const mochaHandlers = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const rejections: unknown[] = [];
  process.on("unhandledRejection", (reason) => rejections.push(reason));
  try {
    await run();
    // Rejections are reported after the current macrotask.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.removeAllListeners("unhandledRejection");
    mochaHandlers.forEach((h) => process.on("unhandledRejection", h));
  }
  return rejections;
};

export class AwaitableEvent {
  curPromise?: Promise<any>;
  curResolve?: (...args: any[]) => void;

  constructor() {
    this.set = this.set.bind(this);
  }

  set(...args: any[]): void {
    if (this.curResolve) this.curResolve(...args);
  }

  prime(): void {
    this.curPromise = new Promise((resolve) => {
      this.curResolve = resolve;
    });
  }

  wait() {
    return this.curPromise;
  }
}
