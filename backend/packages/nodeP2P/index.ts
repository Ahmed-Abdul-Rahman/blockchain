import { NetworkNodeConfig } from './dataTypes';
import { HandshakeProtocol } from './HandshakeProtocol';

const createNetworkNode = async (configuration: {
  nodeConfig: NetworkNodeConfig;
  protocol: string;
}): Promise<HandshakeProtocol> => {
  const networkNode = new HandshakeProtocol(configuration);
  await networkNode.init();

  networkNode.registerNodeDiscovery();
  networkNode.receiveNodeMessages();

  await networkNode.start();
  return networkNode;
};

export default createNetworkNode;
