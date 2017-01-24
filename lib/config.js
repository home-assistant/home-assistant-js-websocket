export default function subscribeConfig(conn, configChanged) {
  return new Promise((resolve, reject) => {
    let config = null;

    function processComponentLoaded(event) {
      const core = Object.assign(
        {}, config.core,
        { components: config.core.components.concat(event.data.component) }
      );
      config = Object.assign({}, config, { core });
      configChanged(config);
    }

    function processServiceRegistered(event) {
      const { domain, service } = event.data;

      const domainInfo = Object.assign(
        {}, config.services[domain] || {},
        { [service]: { description: '', fields: {} } }
      );

      config = Object.assign(
        {}, config,
        { services: Object.assign({}, config.services, { [domain]: domainInfo }) }
      );
      configChanged(config);
    }

    function fetchAll() {
      return Promise.all([
        conn.getConfig(),
        conn.getPanels(),
        conn.getServices(),
      ]).then(([core, panels, services]) => {
        config = { core, panels, services };
        configChanged(config);
      });
    }

    Promise.all([
      conn.subscribeEvents(processComponentLoaded, 'component_loaded'),
      conn.subscribeEvents(processServiceRegistered, 'service_registered'),
      fetchAll(),
    ]).then(
      ([unsubComp, unsubServ]) => {
        conn.addEventListener('ready', fetchAll);

        resolve(() => {
          removeEventListener('ready', fetchAll);
          unsubComp();
          unsubServ();
        });
      },
      () => reject()
    );
  });
}
