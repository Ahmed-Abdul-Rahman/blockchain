import tls from 'tls';
import { getTLSCredentials } from './security.js';
import { TLS_CERT_PATH, TLS_KEY_PATH } from './config.js';

export const startTLSServer = (port) => {
  const credentials = getTLSCredentials(TLS_CERT_PATH, TLS_KEY_PATH);

  const server = tls.createServer(credentials, (socket) => {
    console.log('Secure connection established with a peer');
    socket.on('data', (data) => console.log(`Received: ${data.toString()}`));
    socket.on('end', () => console.log('Peer disconnected'));
  });

  server.listen(port, () => console.log(`TLS server listening on port ${port}`));
};
