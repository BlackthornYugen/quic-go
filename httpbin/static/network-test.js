// Global variables
let testInProgress = false;
let table = null;
let ws = null;
let wsHeartbeatInterval = null;
let wsLog = [];

// Configuration constants
const MAX_REQUESTS = 100000;

// Column definitions for Tabulator
const COLUMN_DEFINITIONS = [
    { field: "index", title: "#", width: 70, sorter: "number" },
    {
        field: "status", title: "Status", width: 110, formatter: function (cell) {
            const value = cell.getValue();
            if (value === 'success') {
                return '<span class="status-success">✓</span>';
            } else {
                return '<span class="status-error">✗</span>';
            }
        }
    },
    {
        field: "http3", title: "HTTP/3", width: 110, formatter: function (cell) {
            const value = cell.getValue();
            return value ? '<span class="status-success">✓</span>' : '-';
        }
    },
    {
        field: "duration", title: "Duration", width: 120, sorter: "number", formatter: function (cell) {
            return cell.getValue().toFixed(2) + ' ms';
        }
    },
    { field: "sourceIp", title: "Source IP", width: 150 },
    { field: "rtt", title: "RTT", width: 100, visible: false },
    {
        field: "dropped", title: "Dropped", width: 100, sorter: "number", visible: false, formatter: function (cell) {
            return formatNumber(cell.getValue() || 0);
        }
    },
    {
        field: "congestion", title: "Congestion", width: 150, visible: false, formatter: function (cell) {
            const value = cell.getValue();
            return value ? formatBytes(value) : '-';
        }
    },
    { field: "connectionId", title: "Connection ID", width: 200, visible: false, cssClass: "conn-id" },
    {
        field: "qlogUrl", title: "QLog", width: 100, formatter: function (cell) {
            const value = cell.getValue();
            if (value) {
                const qvisLink = buildQvisLink(value);
                return `<a href="${qvisLink}" target="_blank" class="qlog-link">View</a>`;
            }
            return '-';
        }
    },
    {
        field: "error", title: "Error", visible: false, formatter: function (cell) {
            const value = cell.getValue();
            return value ? `<span class="status-error">${value}</span>` : '';
        }
    },
];

/**
 * Toggle column visibility
 */
function toggleColumn(field) {
    if (table) {
        const column = table.getColumn(field);
        if (column.isVisible()) {
            column.hide();
        } else {
            column.show();
        }
    }
}

/**
 * Initialize column visibility controls
 */
function initColumnControls() {
    const columnToggles = document.getElementById('columnToggles');
    if (!columnToggles) return;

    columnToggles.innerHTML = '';

    COLUMN_DEFINITIONS.forEach(col => {
        if (col.field === 'index' || col.field === 'error') return; // Skip # and error columns

        const label = document.createElement('label');
        label.className = 'column-toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = col.visible !== false;
        checkbox.addEventListener('change', () => toggleColumn(col.field));

        const span = document.createElement('span');
        span.textContent = col.title;

        label.appendChild(checkbox);
        label.appendChild(span);
        columnToggles.appendChild(label);
    });
}

/**
 * Toggle column configuration panel
 */
function toggleColumnPanel() {
    const panel = document.getElementById('columnPanel');
    panel.classList.toggle('visible');
}

/**
 * Load settings from URL query parameters
 */
function loadSettingsFromURL() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('count')) {
        const value = params.get('count');
        if (value !== null && value !== '') {
            document.getElementById('requestCount').value = value;
        }
    }
    if (params.has('delay')) {
        const value = params.get('delay');
        if (value !== null && value !== '') {
            document.getElementById('requestDelay').value = value;
        }
    }
    if (params.has('delayInc')) {
        const value = params.get('delayInc');
        if (value !== null && value !== '') {
            document.getElementById('delayIncrement').value = value;
        }
    }
    if (params.has('endpoint')) {
        const value = params.get('endpoint');
        if (value !== null && value !== '') {
            document.getElementById('endpointDelay').value = value;
        }
    }
    if (params.has('endpointInc')) {
        const value = params.get('endpointInc');
        if (value !== null && value !== '') {
            document.getElementById('endpointDelayIncrement').value = value;
        }
    }
}

/**
 * Update URL with current settings
 */
function updateURL() {
    const params = new URLSearchParams();

    const requestCount = document.getElementById('requestCount').value;
    const requestDelay = document.getElementById('requestDelay').value;
    const delayIncrement = document.getElementById('delayIncrement').value;
    const endpointDelay = document.getElementById('endpointDelay').value;
    const endpointDelayIncrement = document.getElementById('endpointDelayIncrement').value;

    // Always include all values to ensure complete state is preserved
    if (requestCount !== null && requestCount !== '') params.set('count', requestCount);
    if (requestDelay !== null && requestDelay !== '') params.set('delay', requestDelay);
    if (delayIncrement !== null && delayIncrement !== '') params.set('delayInc', delayIncrement);
    if (endpointDelay !== null && endpointDelay !== '') params.set('endpoint', endpointDelay);
    if (endpointDelayIncrement !== null && endpointDelayIncrement !== '') params.set('endpointInc', endpointDelayIncrement);

    const queryString = params.toString();
    const newURL = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;

    // Update URL without reloading page
    window.history.replaceState({}, '', newURL);

    // Update share link
    updateShareLink(newURL);
}

/**
 * Formats bytes to human-readable format
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Formats numbers with thousands separators
 */
function formatNumber(num) {
    return num.toLocaleString();
}

/**
 * Extract connection ID from qlog URL
 */
function extractConnectionId(qlogUrl) {
    if (!qlogUrl) return null;

    try {
        const filename = qlogUrl.split('/').pop();
        // Extract connection ID (part before _server.sqlog or _client.sqlog)
        const match = filename.match(/^([a-f0-9]+)_(server|client)\.sqlog$/);
        return match ? match[1] : filename;
    } catch (e) {
        console.error('Error extracting connection ID:', e);
    }

    return null;
}

/**
 * Build qvis visualization link from qlog URL
 */
function buildQvisLink(qlogUrl) {
    if (!qlogUrl) return null;
    return 'https://qvis.quictools.info/#/sequence?file=' + encodeURIComponent(qlogUrl);
}

/**
 * Update the share link with current URL
 */
function updateShareLink(url) {
    const shareLink = document.getElementById('shareLink');
    if (shareLink) {
        const fullUrl = window.location.origin + url;
        shareLink.href = fullUrl;
        shareLink.textContent = fullUrl;
    }
}

/**
 * Initialize Tabulator table
 */
function initializeTable() {
    if (table) {
        table.destroy();
    }

    table = new Tabulator("#resultsTable", {
        layout: "fitColumns",
        height: "500px",
        columns: COLUMN_DEFINITIONS,
        initialSort: [{ column: "index", dir: "desc" }],
        placeholder: "No test results yet",
    });

    // Show the column controls and initialize them
    const controlsWrapper = document.querySelector('.column-controls-wrapper');
    if (controlsWrapper) {
        controlsWrapper.style.display = 'block';
    }
    initColumnControls();
}

/**
 * Convert request result to table row data
 */
function resultToRowData(index, data, duration, error = null) {
    if (error) {
        return {
            index: index,
            status: 'error',
            duration: duration,
            sourceIp: '-',
            http3: false,
            rtt: '-',
            dropped: 0,
            congestion: null,
            connectionId: '-',
            qlogUrl: null,
            error: error
        };
    }

    const isHttp3 = data.http3 && data.http3.protocol && data.http3.protocol.toLowerCase().includes('http/3');
    const connectionId = data.http3 ? extractConnectionId(data.http3.qlog_url) : null;

    return {
        index: index,
        status: 'success',
        duration: duration,
        sourceIp: data.origin || '-',
        http3: isHttp3,
        rtt: data.http3 ? (data.http3.rtt || 'N/A') : '-',
        dropped: data.http3 ? (data.http3.dropped_packets || 0) : 0,
        congestion: data.http3 ? data.http3.congestion_window : null,
        connectionId: connectionId || '-',
        qlogUrl: data.http3 ? data.http3.qlog_url : null,
        error: null
    };
}

/**
 * Performs a single network request to /delay/{duration}
 */
async function performRequest(index, delaySeconds) {
    const startTime = performance.now();

    // Ensure delaySeconds is at least 0, default to 0 if not provided
    const actualDelay = delaySeconds || 0;

    try {
        const response = await fetch(`/delay/${actualDelay}`);
        const endTime = performance.now();
        const duration = endTime - startTime;

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        return {
            index,
            data,
            duration,
            error: null
        };
    } catch (error) {
        const endTime = performance.now();
        const duration = endTime - startTime;

        return {
            index,
            data: null,
            duration,
            error: error.message
        };
    }
}

/**
 * Updates the status message
 */
function updateStatus(message, isError = false) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = isError ? 'error' : 'success';
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a numeric input field preserving 0 values
 * @param {string} id - element id
 * @param {number} defaultValue - fallback if NaN
 * @param {boolean} isFloat - whether to parse as float
 */
function parseNumeric(id, defaultValue, isFloat = false) {
    const inputElement = document.getElementById(id);
    if (!inputElement) return defaultValue;
    const raw = isFloat ? parseFloat(inputElement.value) : parseInt(inputElement.value, 10);
    return Number.isNaN(raw) ? defaultValue : raw;
}

/**
 * Starts the network test
 */
async function startTest() {
    if (testInProgress) {
        return;
    }

    // Get configuration
    const requestCount = parseNumeric('requestCount', 5);
    const requestDelay = parseNumeric('requestDelay', 20);
    const delayIncrement = parseNumeric('delayIncrement', 0);
    const endpointDelay = parseNumeric('endpointDelay', 10, true);
    const endpointDelayIncrement = parseNumeric('endpointDelayIncrement', 0, true);

    if (requestCount < 1 || requestCount > MAX_REQUESTS) {
        updateStatus(`Please enter a number between 1 and ${MAX_REQUESTS}`, true);
        return;
    }

    // Update UI
    testInProgress = true;
    const button = document.getElementById('startTest');
    button.disabled = true;
    button.textContent = 'Test in Progress...';

    // Initialize or clear table
    initializeTable();

    const delayText = requestDelay > 0 || delayIncrement > 0
        ? ` with ${requestDelay}ms initial delay${delayIncrement > 0 ? ` (+${delayIncrement}ms/req)` : ''} between requests`
        : ' in parallel';
    const endpointText = endpointDelayIncrement > 0
        ? `${endpointDelay}s (+${endpointDelayIncrement}s/req)`
        : `${endpointDelay}s`;
    updateStatus(`Starting ${requestCount} requests to /delay/${endpointText}${delayText}...`);

    const testStartTime = performance.now();
    const promises = [];

    // Start all requests with specified delay between each start
    for (let i = 1; i <= requestCount; i++) {
        // Calculate progressive delays for this request
        const currentEndpointDelay = endpointDelay + (endpointDelayIncrement * (i - 1));
        const currentRequestDelay = requestDelay + (delayIncrement * (i - 1));

        // Wrap each request to display results as they complete
        const promise = performRequest(i, currentEndpointDelay).then(result => {
            const rowData = resultToRowData(result.index, result.data, result.duration, result.error);
            // Add row
            table.addRow(rowData);
            // Maintain current sort order by reapplying sort if one is active
            // This ensures new rows appear in the correct sorted position
            const currentSort = table.getSorters();
            if (currentSort && currentSort.length > 0) {
                table.setSort(currentSort);
            }
            return result;
        });

        promises.push(promise);

        // Wait before starting next request (except after the last one)
        if (i < requestCount && currentRequestDelay > 0) {
            await sleep(currentRequestDelay);
        }
    }

    try {
        // Wait for all requests to complete
        const results = await Promise.all(promises);
        const testEndTime = performance.now();
        const totalDuration = testEndTime - testStartTime;

        // Calculate success rate
        const successCount = results.filter(r => !r.error).length;
        const successRate = (successCount / requestCount * 100).toFixed(1);

        updateStatus(
            `Test completed in ${(totalDuration / 1000).toFixed(2)}s | ` +
            `${successCount}/${requestCount} successful (${successRate}%)`
        );
    } catch (error) {
        updateStatus(`Test failed: ${error.message}`, true);
    } finally {
        // Reset UI
        testInProgress = false;
        button.disabled = false;
        button.textContent = 'Start Network Test';
    }
}

// Allow Enter key to start test
/**
 * Toggles the WebSocket heartbeat connection
 */
function toggleWebSocket() {
    const button = document.getElementById('toggleWebSocket');
    const statsButton = document.getElementById('showStats');
    const latestDisplay = document.getElementById('wsLatestResponse');

    if (ws) {
        // Close existing connection
        clearInterval(wsHeartbeatInterval);
        ws.close();
        ws = null;
        wsHeartbeatInterval = null;
        button.textContent = 'Start WebSocket Heartbeat';
        updateStatus('WebSocket connection closed');
        return;
    }

    // Start new connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/websocket/http3-info${window.location.search}`;

    // Reset log
    wsLog = [];
    updateLogDisplay();

    // Show UI elements
    statsButton.style.display = 'inline-block';
    latestDisplay.style.display = 'block';
    document.getElementById('wsLatestContent').textContent = 'Connecting...';

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = function () {
            updateStatus('WebSocket connected');
            button.textContent = 'Stop WebSocket Heartbeat';
            addToLog('Connected to ' + wsUrl, 'system');

            // Start heartbeat
            wsHeartbeatInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const msg = JSON.stringify({
                        type: 'heartbeat',
                        timestamp: Date.now()
                    });
                    ws.send(msg);
                    addToLog(msg, 'sent');
                }
            }, 1000);
        };

        ws.onmessage = function (event) {
            // Update latest response
            const content = event.data;
            let displayContent = content;
            try {
                const jsonContent = JSON.parse(content);
                displayContent = JSON.stringify(jsonContent, null, 2);
            } catch (e) {
                // Not JSON, keep original
            }
            const textarea = document.getElementById('wsLatestContent');
            textarea.value = displayContent;
            textarea.scrollTop = textarea.scrollHeight;

            // Add to log
            addToLog(content, 'recv');

            // Check for HTTP/3 info (now called connection_info)
            if (jsonContent && jsonContent.connection_info) {
                const info = jsonContent.connection_info;
                const rtt = info.rtt || "N/A";
                // Could update a specific HTTP/3 display here if we had one
                // For now, the JSON response is visible in the latest content area
            }
        };

        ws.onerror = function (error) {
            console.error('WebSocket error:', error);
            updateStatus('WebSocket error', true);
            addToLog('Error: ' + error, 'system');
        };

        ws.onclose = function () {
            if (ws) {
                // Unexpected close
                clearInterval(wsHeartbeatInterval);
                ws = null;
                wsHeartbeatInterval = null;
                button.textContent = 'Start WebSocket Heartbeat';
                updateStatus('WebSocket connection closed unexpectedly', true);
                addToLog('Connection closed unexpectedly', 'system');
            } else {
                addToLog('Connection closed', 'system');
            }
        };

    } catch (e) {
        console.error('Failed to create WebSocket:', e);
        updateStatus(`Failed to create WebSocket: ${e.message}`, true);
    }
}

/**
 * Toggle stats modal visibility
 */
function toggleStatsModal() {
    const modal = document.getElementById('statsModal');
    if (modal.style.display === 'block') {
        modal.style.display = 'none';
    } else {
        modal.style.display = 'block';
        updateLogDisplay(); // Ensure log is up to date when opening
    }
}

/**
 * Add entry to WebSocket log
 */
function addToLog(message, type) {
    const entry = {
        time: new Date(),
        message: message,
        type: type
    };
    wsLog.push(entry);

    // Limit log size
    if (wsLog.length > 1000) {
        wsLog.shift();
    }

    // Update display if modal is open
    const modal = document.getElementById('statsModal');
    if (modal.style.display === 'block') {
        updateLogDisplay();
    }
}

/**
 * Update the log display in the modal
 */
function updateLogDisplay() {
    const logContainer = document.getElementById('wsLog');
    if (!logContainer) return;

    logContainer.innerHTML = '';

    // Show entries in reverse order (newest first)
    for (let i = wsLog.length - 1; i >= 0; i--) {
        const entry = wsLog[i];
        const div = document.createElement('div');
        div.className = 'log-entry';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'log-time';
        timeSpan.textContent = entry.time.toLocaleTimeString() + '.' + entry.time.getMilliseconds().toString().padStart(3, '0');

        const msgSpan = document.createElement('span');
        if (entry.type === 'sent') msgSpan.className = 'log-sent';
        else if (entry.type === 'recv') msgSpan.className = 'log-recv';

        const prefix = entry.type === 'sent' ? '→ ' : (entry.type === 'recv' ? '← ' : '');
        msgSpan.textContent = prefix + entry.message;

        div.appendChild(timeSpan);
        div.appendChild(msgSpan);
        logContainer.appendChild(div);
    }
}

// Close modal when clicking outside
window.onclick = function (event) {
    const modal = document.getElementById('statsModal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', function () {
    // Load settings from URL on page load
    loadSettingsFromURL();
    // Initialize column controls
    initColumnControls();
    // Initialize share link
    updateShareLink(window.location.pathname + window.location.search);

    const handleEnter = function (e) {
        if (e.key === 'Enter') {
            startTest();
        }
    };

    // Update URL when any input changes
    const updateOnChange = function () {
        updateURL();
    };

    const requestCountInput = document.getElementById('requestCount');
    const requestDelayInput = document.getElementById('requestDelay');
    const delayIncrementInput = document.getElementById('delayIncrement');
    const endpointDelayInput = document.getElementById('endpointDelay');
    const endpointDelayIncrementInput = document.getElementById('endpointDelayIncrement');

    requestCountInput.addEventListener('keypress', handleEnter);
    requestCountInput.addEventListener('input', updateOnChange);

    requestDelayInput.addEventListener('keypress', handleEnter);
    requestDelayInput.addEventListener('input', updateOnChange);

    delayIncrementInput.addEventListener('keypress', handleEnter);
    delayIncrementInput.addEventListener('input', updateOnChange);

    endpointDelayInput.addEventListener('keypress', handleEnter);
    endpointDelayInput.addEventListener('input', updateOnChange);

    endpointDelayIncrementInput.addEventListener('keypress', handleEnter);
    endpointDelayIncrementInput.addEventListener('input', updateOnChange);
});
