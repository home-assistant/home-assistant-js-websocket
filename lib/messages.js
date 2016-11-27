export function auth(authToken) {
  return {
    type: 'auth',
    api_password: authToken,
  };
}

export function states() {
  return {
    type: 'get_states',
  };
}

export function config() {
  return {
    type: 'get_config',
  };
}

export function services() {
  return {
    type: 'get_services',
  };
}

export function panels() {
  return {
    type: 'get_panels',
  };
}

export function callService(domain, service, serviceData) {
  const message = {
    type: 'call_service',
    domain,
    service,
  };

  if (serviceData) {
    message.service_data = serviceData;
  }

  return message;
}

export function subscribeEvents(eventType) {
  const message = {
    type: 'subscribe_events',
  };

  if (eventType) {
    message.event_type = eventType;
  }

  return message;
}

export function unsubscribeEvents(subscription) {
  return {
    type: 'unsubscribe_events',
    subscription,
  };
}

export function ping() {
  return {
    type: 'ping',
  };
}
