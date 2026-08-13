import { describe, expect, it } from 'vitest';
import { ChatEnvelope } from '../../src/domain/types';
import { projectRoomHistory, StoredEnvelope } from '../../src/projection/projectRoomHistory';

const record = (hash: string, envelope: ChatEnvelope): StoredEnvelope => ({ hash, envelope });

describe('projectRoomHistory', () => {
  it('orders messages by timestamp then messageId', () => {
    const views = projectRoomHistory([
      record('h2', {
        type: 'chat_message',
        roomId: 'r1',
        messageId: 'b',
        senderPeerId: 'p',
        timestamp: 2,
        body: { text: 'second' },
      }),
      record('h1', {
        type: 'chat_message',
        roomId: 'r1',
        messageId: 'a',
        senderPeerId: 'p',
        timestamp: 1,
        body: { text: 'first' },
      }),
      record('h3', {
        type: 'chat_message',
        roomId: 'r1',
        messageId: 'c',
        senderPeerId: 'p',
        timestamp: 2,
        body: { text: 'third' },
      }),
    ]);

    expect(views.map((v) => v.body.text)).toEqual(['first', 'second', 'third']);
  });

  it('omits messages whose hashes were tombstoned', () => {
    const views = projectRoomHistory([
      record('keep', {
        type: 'chat_message',
        roomId: 'r1',
        messageId: 'a',
        senderPeerId: 'p',
        timestamp: 1,
        body: { text: 'visible' },
      }),
      record('gone', {
        type: 'chat_message',
        roomId: 'r1',
        messageId: 'b',
        senderPeerId: 'p',
        timestamp: 2,
        body: { text: 'deleted' },
      }),
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
