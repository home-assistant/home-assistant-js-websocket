import { Connection } from "../dist/connection";
import { HaWebSocket } from "../dist/socket";

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
    eventType?: string
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

  mockEvent(event: any, data: any) {
    this._mockListeners[event].forEach(cb => cb(data));
  }

  mockResponse(type: any, data: any) {
    this._mockResponses[type] = data;
  }

  async sendMessagePromise(message: any) {
    if (message.type in this._mockResponses) {
      return this._mockResponses[message.type];
    }
    throw new Error("Unexpected type");
  }
}

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
    this.curPromise = new Promise(resolve => {
      this.curResolve = resolve;
    });
  }

  wait() {
    return this.curPromise;
  }
}
