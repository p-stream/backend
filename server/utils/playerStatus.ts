// Interface for player status
export interface PlayerStatus {
  userId: string;
  roomCode: string;
  isHost: boolean;
  content: {
    title: string;
    type: string;
    tmdbId?: number | string;
    seasonId?: number;
    episodeId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
  };
  player: {
    isPlaying: boolean;
    isPaused: boolean;
    isLoading: boolean;
    hasPlayedOnce: boolean;
    time: number;
    duration: number;
    volume: number;
    playbackRate: number;
    buffered: number;
  };
  timestamp: number;
}

// In-memory store for player status data
// Key: userId+roomCode, Value: Status data array
export const playerStatusStore = new Map<string, PlayerStatus[]>();

// Cleanup interval (30 minutes in milliseconds)
export const CLEANUP_INTERVAL = 30 * 60 * 1000;

// Clean up old status entries
function cleanupOldStatuses() {
  const cutoffTime = Date.now() - CLEANUP_INTERVAL;

  for (const [key, statuses] of playerStatusStore.entries()) {
    const filteredStatuses = statuses.filter(status => status.timestamp >= cutoffTime);

    if (filteredStatuses.length === 0) {
      playerStatusStore.delete(key);
    } else {
      playerStatusStore.set(key, filteredStatuses);
    }
  }
}

// Schedule cleanup every 5 minutes
setInterval(cleanupOldStatuses, 5 * 60 * 1000);
