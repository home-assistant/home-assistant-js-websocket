// This file has no imports on purpose
// So it can easily be consumed by other TS projects

export type Error = 1 | 2 | 3 | 4;

export type UnsubscribeFunc = () => void;

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
  allowlist_external_dirs: string[];
  allowlist_external_urls: string[];
  version: string;
  config_source: string;
  safe_mode: boolean;
  state: "NOT_RUNNING" | "STARTING" | "RUNNING" | "STOPPING" | "FINAL_WRITE";
  external_url: string | null;
  internal_url: string | null;
};

export enum Domain {
  MEDIA_PLAYER = "media_player",
  ALARM_CONTROL_PANEL = "alarm_control_panel",
  BINARY_SENSOR = "binary_sensor",
  COVER = "cover",
  LOCK = "lock",
  HUMIDIFIER = "humidifier",
  ZWAVE = "zwave",
  ALERT = "alert",
  ALEXA = "alexa",
  AIR_QUALITY = "air_quality",
  AUTOMATION = "automation",
  CALENDAR = "calendar",
  CAMERA = "camera",
  CLIMATE = "climate",
  CONFIGURATOR = "configurator",
  CONVERSATION = "conversation",
  COUNTER = "counter",
  DEVICE_TRACKER = "device_tracker",
  FAN = "fan",
  GOOGLE_ASSISTANT = "google_assistant",
  GROUP = "group",
  HOMEASSISTANT = "homeassistant",
  HOMEKIT = "homekit",
  IMAGE_PROCESSING = "image_processing",
  INPUT_BOOLEAN = "input_boolean",
  INPUT_DATETIME = "input_datetime",
  INPUT_NUMBER = "input_number",
  INPUT_SELECT = "input_select",
  INPUT_TEXT = "input_text",
  LIGHT = "light",
  MAILBOX = "mailbox",
  NOTIFY = "notify",
  NUMBER = "number",
  PERSISTENT_NOTIFICATION = "persistent_notification",
  PERSON = "person",
  PLANT = "plant",
  PROXIMITY = "proximity",
  REMOTE = "remote",
  SCENE = "scene",
  SCRIPT = "script",
  SENSOR = "sensor",
  SIMPLE_ALARM = "simple_alarm",
  SUN = "sun",
  SWITCH = "switch",
  TIMER = "timer",
  UPDATER = "updater",
  VACUUM = "vacuum",
  WATER_HEATER = "water_heater",
  WEATHER = "weather",
  ZONE = "zone",
  GEO_LOCATION = "geo_location",
  TTS = "tts",
}

export enum DeviceClass {
  CURRENT = "current",
  CARBON_DIOXIDE = "carbon_dioxide",
  TEMPERATURE = "temperature",
  PRESSURE = "pressure",
  ILLUMINANCE = "illuminance",
  HUMIDITY = "humidity",
  CARBON_MONOXIDE = "carbon_monoxide",
  ENERGY = "energy",
  BATTERY = "battery",
  CONNECTIVITY = "connectivity",
  GARAGE_DOOR = "garage_door",
  OPENING = "opening",
  WINDOW = "window",
  LOCK = "lock",
  PLUG = "plug",
  PRESENCE = "presence",
  SAFETY = "safety",
  COLD = "cold",
  GAS = "gas",
  HEAT = "heat",
  COLIGHTLD = "colightld",
  MOISTURE = "moisture",
  MOTION = "motion",
  OCCUPANCY = "occupancy",
  POWER = "power",
  POWER_FACTOR = "power_factor",
  PROBLEM = "problem",
  SIGNAL_STRENGTH = "signal_strength",
  SMOKE = "smoke",
  SOUND = "sound",
  VIBRATION = "vibration",
  TIMESTAMP = "timestamp",
  VOLTAGE = "voltage",
  BATTERY_CHARGING = "battery_charging",
  MOON_PHASE = "moon_phase",
  GATE = "gate",
  AWNING = "awning",
  DOOR = "door",
  SHADE = "shade",
  BLIND = "blind",
  CURTAIN = "curtain",
  SHUTTER = "shutter",
  LIGHT = "light",
  MOVING = "moving",
  DAMPER = "damper",
  ALPR = "alpr",
  FACE = "face",
}

export type HassEntityBase = {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
  attributes: HassEntityAttributeBase;
  context: { id: string; user_id: string | null };
};

export type HassEntityAttributeBase = {
  friendly_name?: string;
  unit_of_measurement?: string;
  icon?: string;
  entity_picture?: string;
  supported_features?: number;
  hidden?: boolean;
  assumed_state?: boolean;
  device_class?: DeviceClass;
};

export type HassEntity = HassEntityBase & {
  attributes: { [key: string]: any };
};

export type HassEntities = { [entity_id: string]: HassEntity };

export type HassService = {
  name?: string;
  description: string;
  target?: {} | null;
  fields: {
    [field_name: string]: {
      name?: string;
      description: string;
      example: string | boolean | number;
      selector?: {};
    };
  };
};

export type HassDomainServices = {
  [service_name: string]: HassService;
};

export type HassServices = Record<Domain, HassDomainServices>;

export type HassUser = {
  id: string;
  is_owner: boolean;
  name: string;
};

export type HassServiceTarget = {
  entity_id?: string | string[];
  device_id?: string | string[];
  area_id?: string | string[];
};
