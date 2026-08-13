import { describe, expect, it } from 'vitest';
import { DecryptedChatRecord, ProjectableEnvelope } from '../../src/domain/types';
import { projectRoomHistory, StoredEnvelope } from '../../src/projection/projectRoomHistory';

const record = (hash: string, envelope: ProjectableEnvelope): StoredEnvelope => ({ hash, envelope });

const message = (messageId: string, timestamp: number, text: string, displayName?: string): DecryptedChatRecord => ({
  type: 'chat_message',
  roomId: 'r1',
  messageId,
  senderPeerId: 'p',
  timestamp,
  body: { text },
  displayName,
});

describe('projectRoomHistory', () => {
  it('orders messages by timestamp then messageId', () => {
    const views = projectRoomHistory([
      record('h2', message('b', 2, 'second')),
      record('h1', message('a', 1, 'first')),
      record('h3', message('c', 2, 'third')),
    ]);

    expect(views.map((v) => v.body.text)).toEqual(['first', 'second', 'third']);
  });

  it('surfaces unsigned display names as untrustedDisplayName', () => {
    const views = projectRoomHistory([record('h1', message('a', 1, 'hi', 'alice'))]);

    expect(views[0]?.senderPeerId).toBe('p');
    expect(views[0]?.untrustedDisplayName).toBe('alice');
  });

  it('omits messages whose hashes were tombstoned', () => {
    const views = projectRoomHistory([
      record('keep', message('a', 1, 'visible')),
      record('gone', message('b', 2, 'deleted')),
      record('tomb', {
        type: 'tombstone',
        roomId: 'r1',
        targetHash: 'gone',
        senderPeerId: 'p',
        timestamp: 3,
      }),
    ]);

    expect(views).toHaveLength(1);
    expect(views[0]?.body.text).toBe('visible');
  });
});
