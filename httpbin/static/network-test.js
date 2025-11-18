// Global variables
let testInProgress = false;

// Configuration constants
const MAX_REQUESTS = 100000;

/**
 * Load settings from URL query parameters
 */
function loadSettingsFromURL() {
    const params = new URLSearchParams(window.location.search);
    
    if (params.has('count')) {
        document.getElementById('requestCount').value = params.get('count');
    }
    if (params.has('delay')) {
        document.getElementById('requestDelay').value = params.get('delay');
    }
    if (params.has('delayInc')) {
        document.getElementById('delayIncrement').value = params.get('delayInc');
    }
    if (params.has('endpoint')) {
        const value = params.get('endpoint');
        document.getElementById('endpointDelay').value = value;
        document.getElementById('endpointDelayValue').textContent = value;
    }
    if (params.has('endpointInc')) {
        document.getElementById('endpointDelayIncrement').value = params.get('endpointInc');
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
    
    // Only add non-default values to keep URL clean
    if (requestCount !== '5') params.set('count', requestCount);
    if (requestDelay !== '20') params.set('delay', requestDelay);
    if (delayIncrement !== '0') params.set('delayInc', delayIncrement);
    if (endpointDelay !== '10') params.set('endpoint', endpointDelay);
    if (endpointDelayIncrement !== '0') params.set('endpointInc', endpointDelayIncrement);
    
    const queryString = params.toString();
    const newURL = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
    
    // Update URL without reloading page
    window.history.replaceState({}, '', newURL);
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
 * Creates a table for displaying results
 */
function createResultsTable() {
    const table = document.createElement('table');
    table.className = 'results-table';
    
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    const headers = ['#', 'Status', 'Duration', 'Protocol', 'RTT', 'Dropped', 'Congestion', 'Connection ID', 'QLog'];
    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    tbody.id = 'resultsBody';
    table.appendChild(tbody);
    
    return table;
}

/**
 * Creates a table row for a single request result
 */
function createResultRow(index, data, duration, error = null) {
    const row = document.createElement('tr');
    
    // Request number
    const numCell = document.createElement('td');
    numCell.textContent = index;
    row.appendChild(numCell);
    
    if (error) {
        // Status
        const statusCell = document.createElement('td');
        statusCell.textContent = 'Error';
        statusCell.className = 'status-error';
        row.appendChild(statusCell);
        
        // Error message spans remaining columns
        const errorCell = document.createElement('td');
        errorCell.colSpan = 7;
        errorCell.textContent = error;
        errorCell.className = 'status-error';
        row.appendChild(errorCell);
        
        return row;
    }
    
    // Status
    const statusCell = document.createElement('td');
    statusCell.textContent = '✓';
    statusCell.className = 'status-success';
    row.appendChild(statusCell);
    
    // Duration
    const durationCell = document.createElement('td');
    durationCell.textContent = `${duration.toFixed(2)} ms`;
    row.appendChild(durationCell);
    
    // HTTP/3 Statistics
    if (data.http3) {
        // Protocol
        const protoCell = document.createElement('td');
        protoCell.textContent = data.http3.protocol || 'N/A';
        row.appendChild(protoCell);
        
        // RTT
        const rttCell = document.createElement('td');
        rttCell.textContent = data.http3.rtt || 'N/A';
        row.appendChild(rttCell);
        
        // Dropped packets
        const droppedCell = document.createElement('td');
        droppedCell.textContent = formatNumber(data.http3.dropped_packets || 0);
        row.appendChild(droppedCell);
        
        // Congestion window
        const congestionCell = document.createElement('td');
        congestionCell.textContent = data.http3.congestion_window ? formatBytes(data.http3.congestion_window) : '-';
        row.appendChild(congestionCell);
        
        // Connection ID
        const connIdCell = document.createElement('td');
        const connectionId = extractConnectionId(data.http3.qlog_url);
        if (connectionId) {
            connIdCell.textContent = connectionId;
            connIdCell.className = 'conn-id';
        } else {
            connIdCell.textContent = '-';
        }
        row.appendChild(connIdCell);
        
        // QLog link
        const qlogCell = document.createElement('td');
        if (data.http3.qlog_url) {
            const qvisLink = buildQvisLink(data.http3.qlog_url);
            const link = document.createElement('a');
            link.href = qvisLink;
            link.target = '_blank';
            link.className = 'qlog-link';
            link.textContent = 'View';
            qlogCell.appendChild(link);
        } else {
            qlogCell.textContent = '-';
        }
        row.appendChild(qlogCell);
    } else {
        // No HTTP/3 data - fill with dashes
        for (let i = 0; i < 6; i++) {
            const cell = document.createElement('td');
            cell.textContent = '-';
            row.appendChild(cell);
        }
    }
    
    return row;
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
 * Starts the network test
 */
async function startTest() {
    if (testInProgress) {
        return;
    }
    
    // Get configuration
    const requestCount = parseInt(document.getElementById('requestCount').value) || 5;
    const requestDelay = parseInt(document.getElementById('requestDelay').value) || 20;
    const delayIncrement = parseInt(document.getElementById('delayIncrement').value) || 0;
    const endpointDelay = parseFloat(document.getElementById('endpointDelay').value) || 10;
    const endpointDelayIncrement = parseFloat(document.getElementById('endpointDelayIncrement').value) || 0;
    
    if (requestCount < 1 || requestCount > MAX_REQUESTS) {
        updateStatus(`Please enter a number between 1 and ${MAX_REQUESTS}`, true);
        return;
    }
    
    // Update UI
    testInProgress = true;
    const button = document.getElementById('startTest');
    button.disabled = true;
    button.textContent = 'Test in Progress...';
    
    const resultsContainer = document.getElementById('results');
    resultsContainer.innerHTML = '';
    
    // Create table
    const table = createResultsTable();
    resultsContainer.appendChild(table);
    const tbody = document.getElementById('resultsBody');
    
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
            const row = createResultRow(result.index, result.data, result.duration, result.error);
            tbody.appendChild(row);
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
document.addEventListener('DOMContentLoaded', function() {
    // Load settings from URL on page load
    loadSettingsFromURL();
    
    const handleEnter = function(e) {
        if (e.key === 'Enter') {
            startTest();
        }
    };
    
    // Update URL when any input changes
    const updateOnChange = function() {
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
