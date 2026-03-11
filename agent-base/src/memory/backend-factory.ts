import type { AgentBaseConfig } from "../config.js";
import type { MemoryBackend } from "./memory-backend.js";
import { NativeBackend } from "./variants/native/backend.js";
import { ThreeLayerBackend } from "./variants/three-layer/backend.js";
import { FiveDayBackend } from "./variants/five-day/backend.js";

/**
 * Maps a memoryVariant config string to a MemoryBackend instance.
 * Only native-0d variants are fully implemented; others throw on creation.
 */
export function createMemoryBackend(
  variantId: string,
  config: AgentBaseConfig,
): MemoryBackend {
  switch (variantId) {
    case "native-0d":
    case "native-0d-tuned":
      return new NativeBackend(config);
    case "three-layer-1d":
      return new ThreeLayerBackend(config);
    case "five-day-1d":
      return new FiveDayBackend(config);
    case "mem0-1d":
    case "mem0-1d-aggressive":
      throw new Error(`Memory variant "${variantId}" not yet implemented`);
    case "cognee-2d":
      throw new Error(`Memory variant "${variantId}" not yet implemented`);
    case "graphiti-2d+":
      throw new Error(`Memory variant "${variantId}" not yet implemented`);
    case "diy-cron-1d":
      throw new Error(`Memory variant "${variantId}" not yet implemented`);
    case "learned-index":
      throw new Error(`Memory variant "${variantId}" not yet implemented`);
    default:
      throw new Error(`Unknown memory variant: "${variantId}"`);
  }
}
