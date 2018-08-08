import * as messages from "./messages";
import {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,
  MSG_TYPE_AUTH_REQUIRED,
  MSG_TYPE_AUTH_INVALID,
  MSG_TYPE_AUTH_OK
} from "./const";
import {
  ConnectionOptions,
  HassEvent,
  HassEntities,
  HassServices,
  HassConfig
} from "./types";
import { Auth } from "./auth";

const DEBUG = true;

function getSocket(auth, options: ConnectionOptions): Promise<WebSocket> {
  // Convert from http:// -> ws://, https:// -> wss://
  const url = `ws${auth.hassUrl.substr(4)}/api/websocket`;

  if (DEBUG) {
    console.log("[Auth phase] Initializing", url);
  }

  function connect(triesLeft, promResolve, promReject) {
    if (DEBUG) {
      console.log("[Auth Phase] New connection", url);
    }

    const socket = new WebSocket(url);

    // If invalid auth, we will not try to reconnect.
    let invalidAuth = false;

    const closeMessage = () => {
      // If we are in error handler make sure close handler doesn't also fire.
      socket.removeEventListener("close", closeMessage);

      if (invalidAuth) {
        promReject(ERR_INVALID_AUTH);
        return;
      }

      // Reject if we no longer have to retry
      if (triesLeft === 0) {
        // We never were connected and will not retry
        promReject(ERR_CANNOT_CONNECT);
        return;
      }

      const newTries = triesLeft === -1 ? -1 : triesLeft - 1;
      // Try again in a second
      setTimeout(
        () =>
          connect(
            newTries,
            promResolve,
            promReject
          ),
        1000
      );
    };

    const handleMessage = async event => {
      const message = JSON.parse(event.data);

      if (DEBUG) {
        console.log("[Auth phase] Received", message);
      }
      switch (message.type) {
        case MSG_TYPE_AUTH_REQUIRED:
          try {
            if (auth.expired) await auth.refreshAccessToken();
            socket.send(
              JSON.stringify(messages.authAccessToken(auth.access_token))
            );
          } catch (err) {
            // Refresh token failed
            invalidAuth = true;
            socket.close();
          }
          break;

        case MSG_TYPE_AUTH_INVALID:
          invalidAuth = true;
          socket.close();
          break;

        case MSG_TYPE_AUTH_OK:
          socket.removeEventListener("message", handleMessage);
          socket.removeEventListener("close", closeMessage);
          socket.removeEventListener("error", closeMessage);
          promResolve(socket);
          break;

        default:
          if (DEBUG) {
            console.warn("[Auth phase] Unhandled message", message);
          }
      }
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", closeMessage);
    socket.addEventListener("error", closeMessage);
  }

  return new Promise((resolve, reject) =>
    connect(
      options.setupRetry || 0,
      resolve,
      reject
    )
  );
}

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
    this.options = options || {};
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
      setTimeout(() => {
        if (DEBUG) {
          console.log("Trying to reconnect");
        }
        getSocket(this.auth, options).then(
          socket => this.setSocket(socket),
          err =>
            err === ERR_INVALID_AUTH
              ? this.fireEvent("reconnect-error", err)
              : reconnect(tries + 1)
        );
      }, Math.min(tries, 5) * 1000);
    };

    reconnect(0);
  }

  private _genCmdId() {
    this.commandId += 1;
    return this.commandId;
  }
}

export default function createConnection(
  auth: Auth,
  options: ConnectionOptions = {}
) {
  return getSocket(auth, options).then(socket => {
    const conn = new Connection(auth, options);
    conn.setSocket(socket);
    return conn;
  });
}
