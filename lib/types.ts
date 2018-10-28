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

export type HassEventBase = {
  origin: string;
  time_fired: string;
  context: {
    id: string;
    user_id: string;
  };
};

export type HassEvent = HassEventBase & {
  event_type: string;
  data: { [key: string]: any };
};

export type StateChangedEvent = HassEventBase & {
  event_type: "state_changed";
  data: {
    entity_id: string;
    new_state: HassEntity | null;
    old_state: HassEntity | null;
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

export type HassEntityBase = {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
};

export type HassEntityAttributeBase = {
  friendly_name?: string;
  unit_of_measurement?: string;
  icon?: string;
  entity_picture?: string;
  supported_features?: number;
  hidden: boolean;
  assumed_state?: boolean;
  device_class?: string;
};

export type HassEntity = HassEntityBase & {
  attributes: HassEntityAttributeBase & { [key: string]: any };
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
