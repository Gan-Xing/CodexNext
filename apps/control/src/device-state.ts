import type {
  LocalCodexHistoryPageResponse,
  RelayDeviceRecord
} from "@codexnext/protocol";
import type { Socket } from "socket.io";
import type { DeviceEventStore } from "./device-event-store.js";

export interface HistoryPageCacheParams {
  id?: string;
  cwd?: string;
  cursor?: string;
  limit?: number;
  sortDirection?: string;
  itemsView?: string;
}

export interface CachedHistoryPageRecord {
  fetchedAt: number;
  page: LocalCodexHistoryPageResponse;
}

export interface RegisteredDevice {
  info: RelayDeviceRecord;
  socket: Socket | null;
  store: DeviceEventStore;
  loadedThreadIds: Set<string>;
  recentHistoryPages: Map<string, CachedHistoryPageRecord>;
}
