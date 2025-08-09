import { HandshakeProtocol } from './HandshakeProtocol';
import { NetworkNodeConfig } from './types';

const createNetworkNode = async (configuration: {
  nodeConfig: NetworkNodeConfig;
  protocol: string;
}): Promise<HandshakeProtocol> => {
  const networkNode = new HandshakeProtocol(configuration);
  await networkNode.init();

  networkNode.registerNodeDiscovery();
  networkNode.receiveNodeMessages();

  return networkNode;
};

export default createNetworkNode;
