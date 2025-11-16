package httpbin

import (
	"net/http"
	"time"
)

// HTTP3StatsProvider is an interface that can be implemented to provide
// HTTP/3 connection statistics
type HTTP3StatsProvider interface {
	GetHTTP3Stats(r *http.Request, w http.ResponseWriter) *HTTP3Stats
	// GetQLogPublicPrefix returns the public URL prefix for qlog files
	// Returns empty string if not configured
	GetQLogPublicPrefix() string
}

// HTTP3Stats contains detailed QUIC connection statistics
type HTTP3Stats struct {
	RTT            time.Duration
	DroppedPackets uint64
	PacketsSent    uint64
	PacketsLost    uint64
	BytesSent      uint64
	BytesReceived  uint64
	QLogFilename   string // Name of the qlog file (e.g., "connid_server.sqlog")
}

// globalStatsProvider is set by the cmd package when HTTP/3 is enabled
var globalStatsProvider HTTP3StatsProvider

// SetHTTP3StatsProvider sets the global stats provider
func SetHTTP3StatsProvider(provider HTTP3StatsProvider) {
	globalStatsProvider = provider
}
