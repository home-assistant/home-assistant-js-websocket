/**
 * Create a web socket connection with a Home Assistant instance.
 */
import {
  MSG_TYPE_AUTH_OK,
  MSG_TYPE_AUTH_REQUIRED,
  ERR_INVALID_AUTH,
  ERR_CANNOT_CONNECT
} from "./const";
import { MSG_TYPE_AUTH_INVALID } from "./const";
import { ConnectionOptions } from "./types";

const DEBUG = false;

export default function createSocket(
  auth,
  options: ConnectionOptions
): Promise<WebSocket> {
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
              JSON.stringify(message.authAccessToken(auth.access_token))
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
      options.setupRetry,
      resolve,
      reject
    )
  );
}
