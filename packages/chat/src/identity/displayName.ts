const MAX_DISPLAY_NAME_CHARS = 64;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/u;

/**
 * Optional unsigned nickname. Empty clears it. Never treat as verified identity —
 * PeerId is the identity.
 */
export const parseDisplayName = (input: string): string | undefined => {
  const name = input.trim();
  if (name.length === 0) return undefined;
  if (name.length > MAX_DISPLAY_NAME_CHARS) {
    throw new Error(`[identity] Display name is too long (max ${MAX_DISPLAY_NAME_CHARS} characters).`);
  }
  if (CONTROL_CHARS.test(name)) {
    throw new Error('[identity] Display name must not contain control characters.');
  }
  return name;
};
