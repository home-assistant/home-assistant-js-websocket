/**
 * Connection that wraps a socket and provides an interface to interact with
 * the Home Assistant websocket API.
 */
import * as messages from "./messages";
import { ERR_INVALID_AUTH, ERR_CONNECTION_LOST } from "./errors";
import { ConnectionOptions, HassEvent, MessageBase } from "./types";

const DEBUG = false;

export type ConnectionEventListener = (
  conn: Connection,
  eventData?: any
) => void;

type Events = "ready" | "disconnected" | "reconnect-error";

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

type SubscribeEventCommmandInFlight = {
  resolve: (result?: any) => void;
  reject: (err: any) => void;
  eventCallback: (ev: any) => void;
  eventType?: string;
  unsubscribe: () => Promise<void>;
};

type CommandWithAnswerInFlight = {
  resolve: (result?: any) => void;
  reject: (err: any) => void;
};

type CommandInFlight =
  | SubscribeEventCommmandInFlight
  | CommandWithAnswerInFlight;

export class Connection {
  options: ConnectionOptions;
  commandId: number;
  commands: {
    [commandId: number]: CommandInFlight;
  };
  eventListeners: {
    [eventType: string]: ConnectionEventListener[];
  };
  closeRequested: boolean;
  // @ts-ignore: incorrectly claiming it's not set in constructor.
  socket: WebSocket;

  constructor(socket: WebSocket, options: ConnectionOptions) {
    // connection options
    //  - setupRetry: amount of ms to retry when unable to connect on initial setup
    //  - createSocket: create a new Socket connection
    this.options = options;
    // id if next command to send
    this.commandId = 1;
    // info about active subscriptions and commands in flight
    this.commands = {};
    // map of event listeners
    this.eventListeners = {};
    // true if a close is requested by the user
    this.closeRequested = false;

    this.setSocket(socket);
  }

  setSocket(socket: WebSocket) {
    const oldSocket = this.socket;
    this.socket = socket;
    socket.addEventListener("message", ev => this._handleMessage(ev));
    socket.addEventListener("close", ev => this._handleClose(ev));

    if (oldSocket) {
      const oldCommands = this.commands;

      // reset to original state
      this.commandId = 1;
      this.commands = {};

      Object.keys(oldCommands).forEach(id => {
        const info: CommandInFlight = oldCommands[id];

        if ("eventCallback" in info) {
          this.subscribeEvents(info.eventCallback, info.eventType).then(
            unsub => {
              info.unsubscribe = unsub;
              // We need to resolve this in case it wasn't resolved yet.
              // This allows us to call subscribeEvents while we're disconnected
              // and recover properly.
              info.resolve();
            }
          );
        }
      });

      this.fireEvent("ready");
    }
  }

  addEventListener(eventType: Events, callback: ConnectionEventListener) {
    let listeners = this.eventListeners[eventType];

    if (!listeners) {
      listeners = this.eventListeners[eventType] = [];
    }

    listeners.push(callback);
  }

  removeEventListener(eventType: Events, callback: ConnectionEventListener) {
    const listeners = this.eventListeners[eventType];

    if (!listeners) {
      return;
    }

    const index = listeners.indexOf(callback);

    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  fireEvent(eventType: Events, eventData?: any) {
    (this.eventListeners[eventType] || []).forEach(callback =>
      callback(this, eventData)
    );
  }

  close() {
    this.closeRequested = true;
    this.socket.close();
  }

  // eventCallback will be called when a new event fires
  // Returned promise resolves to an unsubscribe function.
  async subscribeEvents<EventType>(
    eventCallback: (ev: EventType) => void,
    eventType?: string
  ) {
    // Command ID that will be used
    const commandId = this._genCmdId();
    let info: SubscribeEventCommmandInFlight;

    await new Promise((resolve, reject) => {
      // We store unsubscribe on info object. That way we can overwrite it in case
      // we get disconnected and we have to subscribe again.
      info = this.commands[commandId] = {
        resolve,
        reject,
        eventCallback: eventCallback as (ev: any) => void,
        eventType,
        unsubscribe: async () => {
          await this.sendMessagePromise(messages.unsubscribeEvents(commandId));
          delete this.commands[commandId];
        }
      };

      try {
        this.sendMessage(messages.subscribeEvents(eventType), commandId);
      } catch (err) {
        // Happens when the websocket is already closing.
        // Don't have to handle the error, reconnect logic will pick it up.
      }
    });

    return () => info.unsubscribe();
  }

  ping() {
    return this.sendMessagePromise(messages.ping());
  }

  sendMessage(message: MessageBase, commandId?: number): void {
    if (DEBUG) {
      console.log("Sending", message);
    }

    if (!commandId) {
      commandId = this._genCmdId();
    }
    message.id = commandId;

    this.socket.send(JSON.stringify(message));
  }

  sendMessagePromise<Result>(message: MessageBase): Promise<Result> {
    return new Promise((resolve, reject) => {
      const commandId = this._genCmdId();
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
        const eventInfo = this.commands[
          message.id
        ] as SubscribeEventCommmandInFlight;
        eventInfo.eventCallback(message.event);
        break;

      case "result":
        // If just sendMessage is used, we will not store promise for result
        if (message.id in this.commands) {
          const info = this.commands[message.id];

          if (message.success) {
            info.resolve(message.result);

            // Don't remove event subscriptions.
            if (!("eventCallback" in info)) {
              delete this.commands[message.id];
            }
          } else {
            info.reject(message.error);
            delete this.commands[message.id];
          }
        }
        break;

      case "pong":
        const pongInfo = this.commands[message.id] as CommandWithAnswerInFlight;
        pongInfo.resolve();
        delete this.commands[message.id];
        break;

      default:
        if (DEBUG) {
          console.warn("Unhandled message", message);
        }
    }
  }

  private _handleClose(ev: CloseEvent) {
    // Reject in-flight sendMessagePromise requests
    Object.keys(this.commands).forEach(id => {
      const info: CommandInFlight = this.commands[id];

      if ("reject" in info) {
        info.reject(messages.error(ERR_CONNECTION_LOST, "Connection lost"));
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
          const socket = await options.createSocket(options);
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
    return ++this.commandId;
  }
}
