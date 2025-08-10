import { EventEmitter } from 'events';

export interface MutexLock {
  acquire: (key: string) => Promise<string>;
  release: (key: string, value?: string) => void;
}

export const lock = (): MutexLock => {
  const locked = {};
  const lockEvent = new EventEmitter();
  lockEvent.setMaxListeners(Infinity);

  return {
    acquire: (key) =>
      new Promise((resolve) => {
        if (!locked[key]) {
          locked[key] = true;
          return resolve('immediate');
        }

        const tryAcquire = (value: string) => {
          if (!locked[key]) {
            locked[key] = true;
            lockEvent.removeListener(key, tryAcquire);
            return resolve(value);
          }
        };

        lockEvent.on(key, tryAcquire);
      }),

    release: (key, value) => {
      Reflect.deleteProperty(locked, key);
      setImmediate(() => lockEvent.emit(key, value));
    },
  };
};
