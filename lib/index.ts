// JS extensions in imports allow tsc output to be consumed by browsers.
import { createSocket } from "./socket.js";
import { Connection, ConnectionOptions } from "./connection.js";

export * from "./auth.js";
export * from "./collection.js";
export * from "./connection.js";
export * from "./config.js";
export * from "./services.js";
export * from "./states.js";
export * from "./errors.js";
export * from "./socket.js";
export * from "./types.js";
export * from "./commands.js";

export async function createConnection(options?: Partial<ConnectionOptions>) {
  const connOptions: ConnectionOptions = {
    setupRetry: 0,
    createSocket,
    ...options,
  };

  const socket = await connOptions.createSocket(connOptions);
  const conn = new Connection(socket, connOptions);
  return conn;
}
