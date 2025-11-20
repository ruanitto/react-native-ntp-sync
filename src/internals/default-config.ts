import { Config } from './types';

const DEFAULT_CONFIG: Config = {
  servers: [
    { server: 'time.google.com', port: 123 },
    { server: 'time.windows.com', port: 123 },
    { server: 'time.cloudflare.com', port: 123 },
    { server: '0.pool.ntp.org', port: 123 },
    { server: '1.pool.ntp.org', port: 123 },
  ],
  history: 10,
  syncInterval: 300 * 1000,
  syncTimeout: 10 * 1000,
  syncOnCreation: true,
  autoSync: true,
  startOnline: true,
};

export default DEFAULT_CONFIG;
