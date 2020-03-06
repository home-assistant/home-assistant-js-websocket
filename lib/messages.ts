import { Error } from "./types.js";

export function auth(accessToken: string) {
  return {
    type: "auth",
    access_token: accessToken
  };
}

export function states() {
  return {
    type: "get_states"
  };
}

export function config() {
  return {
    type: "get_config"
  };
}

export function services() {
  return {
    type: "get_services"
  };
}

export function user() {
  return {
    type: "auth/current_user"
  };
}

type ServiceCallMessage = {
  type: "call_service";
  domain: string;
  service: string;
  service_data?: object;
};

export function callService(
  domain: string,
  service: string,
  serviceData?: object
) {
  const message: ServiceCallMessage = {
    type: "call_service",
    domain,
    service
  };

  if (serviceData) {
    message.service_data = serviceData;
  }

  return message;
}

type SubscribeEventMessage = {
  type: "subscribe_events";
  event_type?: string;
};

export function subscribeEvents(eventType?: string) {
  const message: SubscribeEventMessage = {
    type: "subscribe_events"
  };

  if (eventType) {
    message.event_type = eventType;
  }

  return message;
}

export function unsubscribeEvents(subscription: number) {
  return {
    type: "unsubscribe_events",
    subscription
  };
}

export function ping() {
  return {
    type: "ping"
  };
}

export function error(code: Error, message: string) {
  return {
    type: "result",
    success: false,
    error: {
      code,
      message
    }
  };
}
