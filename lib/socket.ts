/**
 * Create a web socket connection with a Home Assistant instance.
 */
import {
  ERR_INVALID_AUTH,
  ERR_CANNOT_CONNECT,
  ERR_HASS_HOST_REQUIRED
} from "./errors";
import { ConnectionOptions, Error } from "./types";
import * as messages from "./messages";

const DEBUG = false;

const MSG_TYPE_AUTH_REQUIRED = "auth_required";
const MSG_TYPE_AUTH_INVALID = "auth_invalid";
const MSG_TYPE_AUTH_OK = "auth_ok";

export function createSocket(options: ConnectionOptions): Promise<WebSocket> {
  if (!options.auth) {
    throw ERR_HASS_HOST_REQUIRED;
  }
  const auth = options.auth;

  // Convert from http:// -> ws://, https:// -> wss://
  const url = auth.wsUrl;

  if (DEBUG) {
    console.log("[Auth phase] Initializing", url);
  }

  function connect(
    triesLeft: number,
    promResolve: (socket: WebSocket) => void,
    promReject: (err: Error) => void
  ) {
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

    const handleMessage = async (event: MessageEvent) => {
      const message = JSON.parse(event.data);

      if (DEBUG) {
        console.log("[Auth phase] Received", message);
      }
      switch (message.type) {
        case MSG_TYPE_AUTH_REQUIRED:
          try {
            if (auth.expired) await auth.refreshAccessToken();
            socket.send(JSON.stringify(messages.auth(auth.accessToken)));
          } catch (err) {
            // Refresh token failed
            invalidAuth = err === ERR_INVALID_AUTH;
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
      options.setupRetry,
      resolve,
      reject
    )
  );
}
