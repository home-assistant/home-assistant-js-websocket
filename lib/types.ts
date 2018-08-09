import { Auth } from "./auth";

export type Error = 1 | 2 | 3 | 4;

export type UnsubscribeFunc = () => void;

export type ConnectionOptions = {
  setupRetry: number;
  auth?: Auth;
  createSocket: (options: ConnectionOptions) => Promise<WebSocket>;
};

export type MessageBase = {
  id?: number;
  type: string;
  [key: string]: any;
};

export type HassEvent = {
  event_type: string;
  data: object;
  origin: string;
  time_fired: string;
  context: {
    id: string;
    user_id: string;
  };
};

export type HassConfig = {
  latitude: number;
  longitude: number;
  elevation: number;
  unit_system: {
    length: string;
    mass: string;
    volume: string;
    temperature: string;
  };
  location_name: string;
  time_zone: string;
  components: string[];
  config_dir: string;
  whitelist_external_dirs: string[];
  version: string;
};

export type HassEntity = {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
  attributes: { [s: string]: any };
};

export type HassEntities = { [entity_id: string]: HassEntity };

export type HassService = {
  description: string;
  fields: {
    [field_name: string]: {
      description: string;
      example: string;
    };
  };
};

export type HassDomainServices = {
  [service_name: string]: HassService;
};

export type HassServices = {
  [domain: string]: HassDomainServices;
};
