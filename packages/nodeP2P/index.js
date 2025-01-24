import { startDiscovery } from './discovery.js';
import { startTLSServer } from './tlsServer.js';

// Start UDP discovery
startDiscovery();

// Start TLS server
startTLSServer(process.argv[2]);
