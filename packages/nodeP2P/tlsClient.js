import tls from 'tls';
import { getTLSCredentials } from './security.js';
import { TLS_CERT_PATH, TLS_KEY_PATH } from './config.js';

export const connectToPeer = (host, port = 5000) => {
  const credentials = getTLSCredentials(TLS_CERT_PATH, TLS_KEY_PATH);

  const socket = tls.connect({ host, port, ...credentials, rejectUnauthorized: false }, () => {
    console.log(`Connected securely to ${host}:${port}`);
    socket.write('Hello from peer!');
  });

  socket.on('data', (data) => console.log(`Received: ${data.toString()}`));
  socket.on('end', () => console.log('Connection closed'));
};
