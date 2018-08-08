/**
 * Connection that wraps a socket and provides an interface to interact with
 * the Home Assistant websocket API.
 */
import * as messages from "./messages";
import { ERR_INVALID_AUTH, ERR_CONNECTION_LOST } from "./const";
import {
  ConnectionOptions,
  HassEvent,
  HassEntities,
  HassServices,
  HassConfig
} from "./types";
import { Auth } from "./auth";
import createSocket from "./socket";

const DEBUG = false;

type EventListener = (conn: Connection, eventData?: any) => void;

type WebSocketPongResponse = {
  id: number;
  type: "pong";
};

type WebSocketEventResponse = {
  id: number;
  type: "event";
  event: HassEvent;
};

type WebSocketResultResponse = {
  id: number;
  type: "result";
  success: true;
  result: any;
};

type WebSocketResultErrorResponse = {
  id: number;
  type: "result";
  success: false;
  error: {
    code: string;
    message: string;
  };
};

type WebSocketResponse =
  | WebSocketPongResponse
  | WebSocketEventResponse
  | WebSocketResultResponse
  | WebSocketResultErrorResponse;

export class Connection {
  auth: Auth;
  options: ConnectionOptions;
  commandId: number;
  commands: {
    [commandId: number]: any;
  };
  eventListeners: {
    [eventType: string]: EventListener[];
  };
  closeRequested: boolean;
  socket: WebSocket;

  constructor(auth: Auth, options: ConnectionOptions) {
    this.auth = auth;
    // connection options
    //  - setupRetry: amount of ms to retry when unable to connect on initial setup
    this.options = options;
    // id if next command to send
    this.commandId = 1;
    // info about active subscriptions and commands in flight
    this.commands = {};
    // map of event listeners
    this.eventListeners = {};
    // true if a close is requested by the user
    this.closeRequested = false;

    this._handleClose = this._handleClose.bind(this);
  }

  setSocket(socket: WebSocket) {
    const oldSocket = this.socket;
    this.socket = socket;
    socket.addEventListener("message", ev => this._handleMessage(ev));
    socket.addEventListener("close", this._handleClose);

    if (oldSocket) {
      const oldCommands = this.commands;

      // reset to original state
      this.commandId = 1;
      this.commands = {};

      Object.keys(oldCommands).forEach(id => {
        const info = oldCommands[id];

        if (info.eventType) {
          this.subscribeEvents(info.eventCallback, info.eventType).then(
            unsub => {
              info.unsubscribe = unsub;
            }
          );
        }
      });

      this.fireEvent("ready");
    }
  }

  addEventListener(eventType, callback) {
    let listeners = this.eventListeners[eventType];

    if (!listeners) {
      listeners = this.eventListeners[eventType] = [];
    }

    listeners.push(callback);
  }

  removeEventListener(eventType, callback) {
    const listeners = this.eventListeners[eventType];

    if (!listeners) {
      return;
    }

    const index = listeners.indexOf(callback);

    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  fireEvent(eventType, eventData?) {
    (this.eventListeners[eventType] || []).forEach(callback =>
      callback(this, eventData)
    );
  }

  close() {
    this.closeRequested = true;
    this.socket.close();
  }

  getStates() {
    return this.sendMessagePromise<HassEntities>(messages.states());
  }

  getServices() {
    return this.sendMessagePromise<HassServices>(messages.services());
  }

  getConfig() {
    return this.sendMessagePromise<HassConfig>(messages.config());
  }

  callService(domain, service, serviceData) {
    return this.sendMessagePromise(
      messages.callService(domain, service, serviceData)
    );
  }

  // eventCallback will be called when a new event fires
  // Returned promise resolves to an unsubscribe function.
  async subscribeEvents<EventType>(
    eventCallback: (ev: EventType) => void,
    eventType: string
  ) {
    // Command ID that will be used
    const commandId = this._genCmdId();

    await this.sendMessagePromise(
      messages.subscribeEvents(eventType),
      commandId
    );

    // We store unsubscribe on info object. That way we can overwrite it in case
    // we get disconnected and we have to subscribe again.
    const info = {
      eventCallback,
      eventType,
      unsubscribe: async () => {
        await this.sendMessagePromise(messages.unsubscribeEvents(commandId));
        delete this.commands[commandId];
      }
    };

    this.commands[commandId] = info;

    return () => info.unsubscribe();
  }

  ping() {
    return this.sendMessagePromise(messages.ping());
  }

  sendMessage(message, commandId?: number): void {
    if (DEBUG) {
      console.log("Sending", message);
    }

    if (!commandId) {
      commandId = this._genCmdId();
    }
    message.id = commandId;

    this.socket.send(JSON.stringify(message));
  }

  sendMessagePromise<Result>(message, commandId?: number): Promise<Result> {
    return new Promise((resolve, reject) => {
      if (!commandId) {
        commandId = this._genCmdId();
      }
      this.commands[commandId] = { resolve, reject };
      this.sendMessage(message, commandId);
    });
  }

  private _handleMessage(event: MessageEvent) {
    const message: WebSocketResponse = JSON.parse(event.data);

    if (DEBUG) {
      console.log("Received", message);
    }

    switch (message.type) {
      case "event":
        this.commands[message.id].eventCallback(message.event);
        break;

      case "result":
        // If just sendMessage is used, we will not store promise for result
        if (message.id in this.commands) {
          if (message.success == true) {
            this.commands[message.id].resolve(message.result);
          } else {
            this.commands[message.id].reject(message.error);
          }
          delete this.commands[message.id];
        }
        break;

      case "pong":
        break;

      default:
        if (DEBUG) {
          console.warn("Unhandled message", message);
        }
    }
  }

  private _handleClose() {
    // Reject in-flight requests
    Object.keys(this.commands).forEach(id => {
      const { reject } = this.commands[id];
      if (reject) {
        reject(messages.error(ERR_CONNECTION_LOST, "Connection lost"));
      }
    });

    if (this.closeRequested) {
      return;
    }

    this.fireEvent("disconnected");

    // Disable setupRetry, we control it here with auto-backoff
    const options = Object.assign({}, this.options, { setupRetry: 0 });

    const reconnect = (tries: number) => {
      setTimeout(async () => {
        if (DEBUG) {
          console.log("Trying to reconnect");
        }
        try {
          const socket = await options.createSocket(this.auth, options);
          this.setSocket(socket);
        } catch (err) {
          if (err === ERR_INVALID_AUTH) {
            this.fireEvent("reconnect-error", err);
          } else {
            reconnect(tries + 1);
          }
        }
      }, Math.min(tries, 5) * 1000);
    };

    reconnect(0);
  }

  private _genCmdId() {
    this.commandId += 1;
    return this.commandId;
  }
}

const defaultConnectionOptions: ConnectionOptions = {
  setupRetry: 0,
  createSocket
};

export default async function createConnection(
  auth: Auth,
  options?: Partial<ConnectionOptions>
) {
  const connOptions: ConnectionOptions = Object.assign(
    {},
    defaultConnectionOptions,
    options
  );
  const socket = await options.createSocket(auth, connOptions);
  const conn = new Connection(auth, connOptions);
  conn.setSocket(socket);
  return conn;
}
