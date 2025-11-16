package cmd

import (
	"net/http"
	"sync"
	"time"

	"github.com/mccutchen/go-httpbin/v2/httpbin"
	"github.com/quic-go/quic-go/http3"
)

// ConnectionStats holds statistics for a single QUIC connection
// Note: Currently these stats are initialized but not actively updated
// due to limitations in accessing packet-level events in quic-go v0.56.0
// without implementing a full qlogwriter.Trace.
type ConnectionStats struct {
	RTT            time.Duration
	DroppedPackets uint64
	PacketsSent    uint64
	PacketsLost    uint64
	BytesSent      uint64
	BytesReceived  uint64
	LastUpdate     time.Time
}

// ConnectionStatsTracker maintains a thread-safe map of connection statistics
type ConnectionStatsTracker struct {
	mu    sync.RWMutex
	stats map[string]*ConnectionStats
}

// NewConnectionStatsTracker creates a new connection stats tracker
func NewConnectionStatsTracker() *ConnectionStatsTracker {
	return &ConnectionStatsTracker{
		stats: make(map[string]*ConnectionStats),
	}
}

// GetStats retrieves statistics for a connection by its ID
func (t *ConnectionStatsTracker) GetStats(connID string) *ConnectionStats {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if stats, ok := t.stats[connID]; ok {
		// Return a copy to avoid race conditions
		statsCopy := *stats
		return &statsCopy
	}
	return nil
}

// UpdateStats updates statistics for a connection
func (t *ConnectionStatsTracker) UpdateStats(connID string, updater func(*ConnectionStats)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if stats, ok := t.stats[connID]; ok {
		updater(stats)
		stats.LastUpdate = time.Now()
	} else {
		stats := &ConnectionStats{LastUpdate: time.Now()}
		updater(stats)
		t.stats[connID] = stats
	}
}

// RemoveStats removes statistics for a connection
func (t *ConnectionStatsTracker) RemoveStats(connID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.stats, connID)
}

// GetHTTP3Stats implements httpbin.HTTP3StatsProvider
func (t *ConnectionStatsTracker) GetHTTP3Stats(r *http.Request, w http.ResponseWriter) *httpbin.HTTP3Stats {
	// Try to get the connection from the ResponseWriter
	if hijacker, ok := w.(http3.Hijacker); ok {
		conn := hijacker.Connection()
		if conn != nil {
			// Use the remote address as the connection ID
			connIDStr := conn.RemoteAddr().String()
			
			// Update stats from connection state
			// Note: ConnectionState doesn't provide RTT or packet stats directly
			// in quic-go v0.56.0, so we track what we can
			// For full stats, we'd need to implement a qlogwriter.Trace
			t.UpdateStats(connIDStr, func(stats *ConnectionStats) {
				// Basic tracking - actual packet stats would come from tracer
			})
			
			if stats := t.GetStats(connIDStr); stats != nil {
				return &httpbin.HTTP3Stats{
					RTT:            stats.RTT,
					DroppedPackets: stats.DroppedPackets,
					PacketsSent:    stats.PacketsSent,
					PacketsLost:    stats.PacketsLost,
					BytesSent:      stats.BytesSent,
					BytesReceived:  stats.BytesReceived,
				}
			}
		}
	}
	
	return nil
}