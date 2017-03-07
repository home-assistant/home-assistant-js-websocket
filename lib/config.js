export default function subscribeConfig(conn, configChanged) {
  if (conn._subscribeConfig) {
    return conn._subscribeConfig(configChanged);
  }

  return new Promise((resolve, reject) => {
    let config = null;
    let configUnsub = null;
    const listeners = [];
    let initPromise = null;

    if (configChanged) {
      listeners.push(configChanged);
    }

    function updateConfig(updates) {
      config = Object.assign({}, config, updates);

      for (let i = 0; i < listeners.length; i++) {
        listeners[i](config);
      }
    }

    function processComponentLoaded(event) {
      if (config === null) return;

      const core = Object.assign(
        {}, config.core,
        { components: config.core.components.concat(event.data.component) }
      );

      updateConfig({ core });
    }

    function processServiceRegistered(event) {
      if (config === null) return;

      const { domain, service } = event.data;

      const domainInfo = Object.assign(
        {}, config.services[domain] || {},
        { [service]: { description: '', fields: {} } }
      );

      updateConfig({ services: Object.assign({}, config.services, { [domain]: domainInfo }) });
    }

    function processServiceRemoved(event) {
      if (config === null) return;

      const { domain, service } = event.data;

      updateConfig({ services: Object.assign({}, config.services, Object.assign({}, config.services.[domain], { [service]: null} )) });
    }

    function fetchAll() {
      return Promise.all([
        conn.getConfig(),
        conn.getPanels(),
        conn.getServices(),
      ]).then(([core, panels, services]) => {
        updateConfig({ core, panels, services });
      });
    }

    function removeListener(listener) {
      if (listener) {
        listeners.splice(listeners.indexOf(listener), 1);
      }

      if (listeners.length === 0) {
        configUnsub();
      }
    }

    conn._subscribeConfig = (listener) => {
      if (listener) {
        listeners.push(listener);

        // If config is null, fetching promise still has to resolve
        if (config !== null) {
          listener(config);
        }
      }
      return initPromise.then(() => () => removeListener(listener));
    };

    initPromise = Promise.all([
      conn.subscribeEvents(processComponentLoaded, 'component_loaded'),
      conn.subscribeEvents(processServiceRegistered, 'service_registered'),
      conn.subscribeEvents(processServiceRemoved, 'service_removed'),
      fetchAll(),
    ]);

    initPromise.then(
      ([unsubComp, unsubServReg, unsubServRem]) => {
        configUnsub = () => {
          removeEventListener('ready', fetchAll);
          unsubComp();
          unsubServReg();
          unsubServRem();
        };
        conn.addEventListener('ready', fetchAll);
        resolve(() => removeListener(configChanged));
      },
      () => reject()
    );
  });
}
