import { createHash } from 'crypto';

export const sha256 = (message) => createHash('sha256').update(message).digest('base64');
