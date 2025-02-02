export function identify(init1: string = 'yoo'): (components: string) => string {
  return (string) => `last resturn ${string} ${init1}`;
}

identify('Called')('Second Call');
