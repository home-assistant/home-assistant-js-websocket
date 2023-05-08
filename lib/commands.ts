import { Connection } from "./connection.js";
import * as messages from "./messages.js";
import {
  HassEntityState,
  HassServices,
  HassConfig,
  HassUser,
  HassServiceTarget,
} from "./types.js";

export const getStates = (connection: Connection) =>
  connection.sendMessagePromise<HassEntityState[]>(messages.states());

export const getServices = (connection: Connection) =>
  connection.sendMessagePromise<HassServices>(messages.services());

export const getConfig = (connection: Connection) =>
  connection.sendMessagePromise<HassConfig>(messages.config());

export const getUser = (connection: Connection) =>
  connection.sendMessagePromise<HassUser>(messages.user());

export const callService = (
  connection: Connection,
  domain: string,
  service: string,
  serviceData?: object,
  target?: HassServiceTarget
) =>
  connection.sendMessagePromise(
    messages.callService(domain, service, serviceData, target)
  );
