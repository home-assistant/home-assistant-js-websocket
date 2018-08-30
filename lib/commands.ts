import { Connection } from "./connection";
import * as messages from "./messages";
import { HassEntity, HassServices, HassConfig } from "./types";

export const getStates = (connection: Connection) =>
  connection.sendMessagePromise<HassEntity[]>(messages.states());

export const getServices = (connection: Connection) =>
  connection.sendMessagePromise<HassServices>(messages.services());

export const getConfig = (connection: Connection) =>
  connection.sendMessagePromise<HassConfig>(messages.config());

export const getUser = (connection: Connection) =>
  connection.sendMessagePromise<HassConfig>(messages.user());

export const callService = (
  connection: Connection,
  domain: string,
  service: string,
  serviceData?: object
) =>
  connection.sendMessagePromise(
    messages.callService(domain, service, serviceData)
  );
