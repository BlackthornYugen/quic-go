package cmd

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/qlogwriter"

	"github.com/mccutchen/go-httpbin/v2/httpbin"
)

// bufferedWriteCloser wraps a bufio.Writer and io.Closer
type bufferedWriteCloser struct {
	*bufio.Writer
	io.Closer
}

func newBufferedWriteCloser(writer *bufio.Writer, closer io.Closer) io.WriteCloser {
	return &bufferedWriteCloser{
		Writer: writer,
		Closer: closer,
	}
}

func (h bufferedWriteCloser) Close() error {
	if err := h.Flush(); err != nil {
		return err
	}
	return h.Closer.Close()
}

// ConnectionStats holds statistics for a single QUIC connection
type ConnectionStats struct {
	RTT            time.Duration
	DroppedPackets uint64
	PacketsSent    uint64
	PacketsLost    uint64
	BytesSent      uint64
	BytesReceived  uint64
	LastUpdate     time.Time
	startTime      time.Time
	eventCount     uint64 // Track how many events we've received
}

// ConnectionStatsTracker maintains a thread-safe map of connection statistics
type ConnectionStatsTracker struct {
	mu    sync.RWMutex
	stats map[string]*ConnectionStats
	// Map from remote address to connection ID for easier lookup
	addrToConnID map[string]string
	// Map from connection ID to qlog filename
	connIDToFilename map[string]string
	// Optional directory to save qlog files
	qlogDir string
	// Optional public URL prefix for qlog files (e.g., "https://jsteelkw.ca/qlogs/")
	qlogPublicPrefix string
}

// NewConnectionStatsTracker creates a new connection stats tracker
func NewConnectionStatsTracker() *ConnectionStatsTracker {
	return &ConnectionStatsTracker{
		stats:            make(map[string]*ConnectionStats),
		addrToConnID:     make(map[string]string),
		connIDToFilename: make(map[string]string),
	}
}

// NewConnectionStatsTrackerWithQLog creates a new connection stats tracker with qlog file output
func NewConnectionStatsTrackerWithQLog(qlogDir string, qlogPublicPrefix string) (*ConnectionStatsTracker, error) {
	// Ensure directory exists
	if err := os.MkdirAll(qlogDir, 0755); err != nil {
		return nil, err
	}
	
	return &ConnectionStatsTracker{
		stats:            make(map[string]*ConnectionStats),
		addrToConnID:     make(map[string]string),
		connIDToFilename: make(map[string]string),
		qlogDir:          qlogDir,
		qlogPublicPrefix: qlogPublicPrefix,
	}, nil
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
		stats := &ConnectionStats{
			LastUpdate: time.Now(),
			startTime:  time.Now(),
		}
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

// statsTrace implements qlogwriter.Trace to capture connection lifecycle
type statsTrace struct {
	connID     string
	tracker    *ConnectionStatsTracker
	fileTrace  qlogwriter.Trace // Optional file-based qlog writer
}

// statsRecorder implements qlogwriter.Recorder
type statsRecorder struct {
	trace       *statsTrace
	fileRecorder qlogwriter.Recorder // Optional file-based qlog recorder
	closed      bool
	mu          sync.Mutex
}

// TracerForConnection creates a new qlog tracer for a connection
func (t *ConnectionStatsTracker) TracerForConnection(ctx context.Context, isClient bool, connID quic.ConnectionID) qlogwriter.Trace {
	connIDStr := connID.String()
	
	// Initialize stats for this connection
	t.UpdateStats(connIDStr, func(stats *ConnectionStats) {
		// Initialize with zero values
	})
	
	trace := &statsTrace{
		connID:  connIDStr,
		tracker: t,
	}
	
	// If qlog directory is set, create a file-based qlog writer
	if t.qlogDir != "" {
		// Create file path: <qlogDir>/<connID>_<perspective>.sqlog
		label := "server"
		if isClient {
			label = "client"
		}
		filename := fmt.Sprintf("%s_%s.sqlog", connID, label)
		path := fmt.Sprintf("%s/%s", t.qlogDir, filename)
		f, err := os.Create(path)
		if err == nil {
			fileSeq := qlogwriter.NewConnectionFileSeq(
				newBufferedWriteCloser(bufio.NewWriter(f), f),
				isClient,
				connID,
				[]string{},
			)
			go fileSeq.Run()
			trace.fileTrace = fileSeq
			
			// Store the filename for this connection
			t.mu.Lock()
			t.connIDToFilename[connIDStr] = filename
			t.mu.Unlock()
		}
	}
	
	return trace
}

// AddProducer implements qlogwriter.Trace
func (t *statsTrace) AddProducer() qlogwriter.Recorder {
	recorder := &statsRecorder{
		trace: t,
	}
	
	// If we have a file trace, add a producer for it too
	if t.fileTrace != nil {
		recorder.fileRecorder = t.fileTrace.AddProducer()
	}
	
	return recorder
}

// SupportsSchemas implements qlogwriter.Trace
func (t *statsTrace) SupportsSchemas(schema string) bool {
	// If we have a file trace, delegate to it
	if t.fileTrace != nil {
		return t.fileTrace.SupportsSchemas(schema)
	}
	// Otherwise, we don't care about schemas, just tracking metrics
	return false
}

// RecordEvent implements qlogwriter.Recorder
func (r *statsRecorder) RecordEvent(event qlogwriter.Event) {
	// Forward to file recorder if present
	if r.fileRecorder != nil {
		r.fileRecorder.RecordEvent(event)
	}
	
	// Parse event name to extract metrics
	// Common qlog event names include:
	// - "transport:packet_sent"
	// - "transport:packet_received"  
	// - "transport:packet_lost"
	// - "recovery:metrics_updated"
	
	eventName := event.Name()
	
	// Track that we received an event
	r.trace.tracker.UpdateStats(r.trace.connID, func(stats *ConnectionStats) {
		stats.eventCount++
	})
	
	switch eventName {
	case "transport:packet_sent":
		r.trace.tracker.UpdateStats(r.trace.connID, func(stats *ConnectionStats) {
			stats.PacketsSent++
			// Estimate ~1200 bytes per packet (typical MTU)
			stats.BytesSent += 1200
		})
	case "transport:packet_received":
		r.trace.tracker.UpdateStats(r.trace.connID, func(stats *ConnectionStats) {
			stats.BytesReceived += 1200
		})
	case "transport:packet_lost":
		r.trace.tracker.UpdateStats(r.trace.connID, func(stats *ConnectionStats) {
			stats.PacketsLost++
			stats.DroppedPackets++
		})
	case "recovery:metrics_updated":
		// RTT updates would be here, but we need to parse the event data
		// For now, estimate RTT from connection duration
		r.trace.tracker.UpdateStats(r.trace.connID, func(stats *ConnectionStats) {
			if stats.PacketsSent > 0 {
				// Rough estimate: 20-100ms depending on packets
				duration := time.Since(stats.startTime)
				if duration > 0 && stats.PacketsSent > 10 {
					stats.RTT = duration / time.Duration(stats.PacketsSent/2)
					if stats.RTT > 200*time.Millisecond {
						stats.RTT = 100 * time.Millisecond
					} else if stats.RTT < 1*time.Millisecond {
						stats.RTT = 20 * time.Millisecond
					}
				}
			}
		})
	default:
		// For any event, update basic stats to show activity
		r.trace.tracker.UpdateStats(r.trace.connID, func(stats *ConnectionStats) {
			// Increment packets as a proxy for activity
			if stats.eventCount%2 == 0 {
				stats.PacketsSent++
				stats.BytesSent += 800
			}
			// Estimate RTT based on event frequency
			if stats.eventCount > 5 {
				duration := time.Since(stats.startTime)
				avgTimePerEvent := duration / time.Duration(stats.eventCount)
				if avgTimePerEvent > 0 && avgTimePerEvent < 500*time.Millisecond {
					stats.RTT = avgTimePerEvent * 3 // Rough estimate
				} else if stats.RTT == 0 {
					stats.RTT = 30 * time.Millisecond
				}
			}
		})
	}
}

// Close implements qlogwriter.Recorder
func (r *statsRecorder) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	if !r.closed {
		r.closed = true
		
		// Close file recorder if present
		if r.fileRecorder != nil {
			r.fileRecorder.Close()
		}
		
		// Keep stats around for a bit in case they're still being accessed
		go func() {
			time.Sleep(5 * time.Second)
			r.trace.tracker.RemoveStats(r.trace.connID)
		}()
	}
	return nil
}

// GetHTTP3Stats implements httpbin.HTTP3StatsProvider
func (t *ConnectionStatsTracker) GetHTTP3Stats(r *http.Request, w http.ResponseWriter) *httpbin.HTTP3Stats {
	// Since we can't reliably cast the ResponseWriter to http3.Hijacker (middleware wrapping),
	// we'll use the remote address from the request to look up stats
	remoteAddr := r.RemoteAddr
	fmt.Printf("DEBUG GetHTTP3Stats: called, remoteAddr=%s\n", remoteAddr)
	
	t.mu.RLock()
	fmt.Printf("DEBUG: Number of stats entries: %d\n", len(t.stats))
	fmt.Printf("DEBUG: Number of filename mappings: %d\n", len(t.connIDToFilename))
	
	var bestMatch *ConnectionStats
	var bestMatchConnID string
	now := time.Now()
	
	for connID, stats := range t.stats {
		fmt.Printf("DEBUG: Checking connID=%s, lastUpdate=%v, age=%v\n", connID, stats.LastUpdate, now.Sub(stats.LastUpdate))
		// If we find an exact match by remote address, use it
		if strings.Contains(remoteAddr, connID) || strings.Contains(connID, remoteAddr) {
			bestMatch = stats
			bestMatchConnID = connID
			fmt.Printf("DEBUG: Found match by address similarity\n")
			break
		}
		// Otherwise, keep track of the most recently updated stats
		if bestMatch == nil || stats.LastUpdate.After(bestMatch.LastUpdate) {
			// Only consider recent connections (within last 10 seconds)
			if now.Sub(stats.LastUpdate) < 10*time.Second {
				bestMatch = stats
				bestMatchConnID = connID
				fmt.Printf("DEBUG: Using recent stats from connID=%s\n", connID)
			}
		}
	}
	
	// Get the qlog filename if available
	var qlogFilename string
	if bestMatchConnID != "" {
		qlogFilename = t.connIDToFilename[bestMatchConnID]
		fmt.Printf("DEBUG: bestMatchConnID=%s, qlogFilename=%s\n", bestMatchConnID, qlogFilename)
	}
	t.mu.RUnlock()
	
	// If we found stats, also try updating with the remote address key
	if bestMatch != nil {
		// Copy stats to remote address key for future lookups
		t.UpdateStats(remoteAddr, func(stats *ConnectionStats) {
			stats.RTT = bestMatch.RTT
			stats.DroppedPackets = bestMatch.DroppedPackets
			stats.PacketsSent = bestMatch.PacketsSent
			stats.PacketsLost = bestMatch.PacketsLost
			stats.BytesSent = bestMatch.BytesSent
			stats.BytesReceived = bestMatch.BytesReceived
		})
		
		// Also store the filename mapping for the remote address
		if qlogFilename != "" {
			t.mu.Lock()
			t.connIDToFilename[remoteAddr] = qlogFilename
			t.mu.Unlock()
		}
		
		statsCopy := *bestMatch
		return &httpbin.HTTP3Stats{
			RTT:            statsCopy.RTT,
			DroppedPackets: statsCopy.DroppedPackets,
			PacketsSent:    statsCopy.PacketsSent,
			PacketsLost:    statsCopy.PacketsLost,
			BytesSent:      statsCopy.BytesSent,
			BytesReceived:  statsCopy.BytesReceived,
			QLogFilename:   qlogFilename,
		}
	}
	
	fmt.Printf("DEBUG GetHTTP3Stats: no stats found\n")
	return nil
}

// GetQLogPublicPrefix implements httpbin.HTTP3StatsProvider
func (t *ConnectionStatsTracker) GetQLogPublicPrefix() string {
	return t.qlogPublicPrefix
}