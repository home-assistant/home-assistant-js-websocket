/**
 * Create a web socket connection with a Home Assistant instance.
 */
import {
  ERR_INVALID_AUTH,
  ERR_CANNOT_CONNECT,
  ERR_HASS_HOST_REQUIRED,
} from "./errors.js";
import { Error } from "./types.js";
import type { ConnectionOptions } from "./connection.js";
import * as messages from "./messages.js";
import { atLeastHaVersion } from "./util.js";

const DEBUG = false;

// A stalled connection can emit neither open nor close, which leaves the
// retry below unreachable. Bound how long we wait for the open event.
const DEFAULT_CONNECT_TIMEOUT = 10000;

export const MSG_TYPE_AUTH_REQUIRED = "auth_required";
export const MSG_TYPE_AUTH_INVALID = "auth_invalid";
export const MSG_TYPE_AUTH_OK = "auth_ok";

export interface HaWebSocket extends WebSocket {
  haVersion: string;
}

export function createSocket(options: ConnectionOptions): Promise<HaWebSocket> {
  if (!options.auth) {
    throw ERR_HASS_HOST_REQUIRED;
  }
  const auth = options.auth;

  // Start refreshing expired tokens even before the WS connection is open.
  // We know that we will need auth anyway.
  let authRefreshTask = auth.expired
    ? auth.refreshAccessToken().then(
        () => {
          authRefreshTask = undefined;
        },
        () => {
          authRefreshTask = undefined;
        },
      )
    : undefined;

  // Convert from http:// -> ws://, https:// -> wss://
  const url = auth.wsUrl;

  const connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;

  if (DEBUG) {
    console.log("[Auth phase] Initializing", url);
  }

  function connect(
    triesLeft: number,
    promResolve: (socket: HaWebSocket) => void,
    promReject: (err: Error) => void,
  ) {
    if (DEBUG) {
      console.log("[Auth Phase] New connection", url);
    }

    const socket = new WebSocket(url) as HaWebSocket;

    // If invalid auth, we will not try to reconnect.
    let invalidAuth = false;

    // Closing a socket that is still connecting fires close, so whatever
    // retry policy applies below takes it from here.
    const connectTimer =
      connectTimeout > 0
        ? setTimeout(() => {
            if (DEBUG) {
              console.log("[Auth phase] Connect timed out", url);
            }
            socket.close();
          }, connectTimeout)
        : undefined;

    const clearConnectTimer = () => {
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
      }
    };

    const closeMessage = () => {
      clearConnectTimer();
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
      setTimeout(() => connect(newTries, promResolve, promReject), 1000);
    };

    // Auth is mandatory, so we can send the auth message right away.
    const handleOpen = async (event: MessageEventInit) => {
      clearConnectTimer();
      try {
        if (auth.expired) {
          await (authRefreshTask ? authRefreshTask : auth.refreshAccessToken());
        }
        socket.send(JSON.stringify(messages.auth(auth.accessToken)));
      } catch (err) {
        // Refresh token failed
        invalidAuth = err === ERR_INVALID_AUTH;
        socket.close();
      }
    };

    const handleMessage = async (event: MessageEvent) => {
      const message = JSON.parse(event.data);

      if (DEBUG) {
        console.log("[Auth phase] Received", message);
      }
      switch (message.type) {
        case MSG_TYPE_AUTH_INVALID:
          invalidAuth = true;
          socket.close();
          break;

        case MSG_TYPE_AUTH_OK:
          socket.removeEventListener("open", handleOpen);
          socket.removeEventListener("message", handleMessage);
          socket.removeEventListener("close", closeMessage);
          socket.removeEventListener("error", closeMessage);
          socket.haVersion = message.ha_version;
          if (atLeastHaVersion(socket.haVersion, 2022, 9)) {
            socket.send(JSON.stringify(messages.supportedFeatures()));
          }

          promResolve(socket);
          break;

        default:
          if (DEBUG) {
            // We already send response to this message when socket opens
            if (message.type !== MSG_TYPE_AUTH_REQUIRED) {
              console.warn("[Auth phase] Unhandled message", message);
            }
          }
      }
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", closeMessage);
    socket.addEventListener("error", closeMessage);
  }

  return new Promise((resolve, reject) =>
    connect(options.setupRetry, resolve, reject),
  );
}
