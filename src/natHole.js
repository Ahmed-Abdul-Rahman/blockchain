import dgram from 'node:dgram';

const client = dgram.createSocket('udp4');

// Send a dummy packet to open the NAT
client.send('Hello', 6881, 'router.bittorrent.com', () => {
  console.log('NAT hole punching initiated');
});
