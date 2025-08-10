import { sha256 } from '@common/utils';

export const handshakeSeed = 'Discovere New Node And Establish Connection Create Decentralized Blockchain';

export const infoHash = sha256(handshakeSeed);

export const ESTABLISH_CONNECTION = 'Establish Connection';
