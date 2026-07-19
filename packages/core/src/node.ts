import { PartialDeep } from 'type-fest';
import { DeChatConfig } from './config/types';
import {
  type CreateDeChatNodeOptions,
  createDeChatNode,
  type DeChatNodeHandle,
  type PlatformStackInput,
} from './createDeChatNode';
import { createNodePlatformStack } from './platform/createNodePlatformStack';
import type { DeChatStrategies } from './types';

export type { CreateDeChatNodeOptions as CreateNodeOptions, DeChatNodeHandle, PlatformStackInput };

/**
 * Node composition facade — defaults to {@link createNodePlatformStack}.
 * Signature stays backward-compatible: optional 3rd/4th args, or an options bag as the 3rd arg.
 */
export const createNode = async (
  infoHash: string,
  nodeSeed: string,
  userOpts?:
    | PartialDeep<DeChatConfig>
    | (Omit<CreateDeChatNodeOptions, 'platformStack'> & {
        platformStack?: PlatformStackInput;
      }),
  strategies?: DeChatStrategies,
  platformStack?: PlatformStackInput,
): Promise<DeChatNodeHandle> => {
  const options = normalizeCreateNodeArgs(userOpts, strategies, platformStack);
  return createDeChatNode(infoHash, nodeSeed, {
    config: options.config,
    strategies: options.strategies,
    platformStack: options.platformStack ?? ((config) => createNodePlatformStack({ config })),
  });
};

/** Explicit Node facade — same as `createNode` with the Node platform stack. */
export const createNodeNode = (
  infoHash: string,
  nodeSeed: string,
  userOpts?: PartialDeep<DeChatConfig>,
  strategies?: DeChatStrategies,
): ReturnType<typeof createNode> =>
  createNode(infoHash, nodeSeed, {
    config: userOpts,
    strategies,
  });

const isCreateNodeOptions = (
  value: unknown,
): value is Omit<CreateDeChatNodeOptions, 'platformStack'> & { platformStack?: PlatformStackInput } => {
  if (typeof value !== 'object' || value === null) return false;
  return 'config' in value || 'strategies' in value || 'platformStack' in value;
};

const normalizeCreateNodeArgs = (
  userOpts?:
    | PartialDeep<DeChatConfig>
    | (Omit<CreateDeChatNodeOptions, 'platformStack'> & { platformStack?: PlatformStackInput }),
  strategies?: DeChatStrategies,
  platformStack?: PlatformStackInput,
): Omit<CreateDeChatNodeOptions, 'platformStack'> & { platformStack?: PlatformStackInput } => {
  if (isCreateNodeOptions(userOpts)) {
    return {
      config: userOpts.config,
      strategies: userOpts.strategies ?? strategies,
      platformStack: userOpts.platformStack ?? platformStack,
    };
  }
  return {
    config: userOpts,
    strategies,
    platformStack,
  };
};
