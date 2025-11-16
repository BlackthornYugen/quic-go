// Global variables
let testInProgress = false;

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
 * Creates a stat row element
 */
function createStatRow(label, value, isError = false) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    
    const labelDiv = document.createElement('div');
    labelDiv.className = 'stat-label';
    labelDiv.textContent = label;
    
    const valueDiv = document.createElement('div');
    valueDiv.className = 'stat-value' + (isError ? ' error' : '');
    valueDiv.textContent = value;
    
    row.appendChild(labelDiv);
    row.appendChild(valueDiv);
    
    return row;
}

/**
 * Creates a request card to display results
 */
function createRequestCard(index, data, duration, error = null) {
    const card = document.createElement('div');
    card.className = 'request-card';
    
    const title = document.createElement('h3');
    title.textContent = `Request #${index}`;
    card.appendChild(title);
    
    if (error) {
        card.appendChild(createStatRow('Status', 'Error', true));
        card.appendChild(createStatRow('Error', error, true));
        return card;
    }
    
    // Basic request info
    card.appendChild(createStatRow('Status', 'Success ✓'));
    card.appendChild(createStatRow('Duration', `${duration.toFixed(2)} ms`));
    card.appendChild(createStatRow('Method', data.method || 'N/A'));
    card.appendChild(createStatRow('Origin', data.origin || 'N/A'));
    
    // HTTP/3 Statistics (if available)
    if (data.http3) {
        const http3Title = document.createElement('h4');
        http3Title.textContent = 'HTTP/3 Statistics';
        http3Title.style.marginTop = '15px';
        http3Title.style.color = '#2196F3';
        card.appendChild(http3Title);
        
        card.appendChild(createStatRow('Protocol', data.http3.protocol || 'N/A'));
        card.appendChild(createStatRow('RTT', data.http3.rtt || 'N/A'));
        card.appendChild(createStatRow('Dropped Packets', formatNumber(data.http3.dropped_packets || 0)));
        
        if (data.http3.congestion_window) {
            card.appendChild(createStatRow('Congestion Window', formatBytes(data.http3.congestion_window)));
        }
        
        // Add qlog visualization link if available
        if (data.http3.qlog_visualization_link) {
            const linkContainer = document.createElement('div');
            linkContainer.style.marginTop = '10px';
            
            const link = document.createElement('a');
            link.href = data.http3.qlog_visualization_link;
            link.target = '_blank';
            link.className = 'qlog-link';
            link.textContent = 'View QLog Visualization';
            
            linkContainer.appendChild(link);
            card.appendChild(linkContainer);
        }
    } else {
        const noHttp3 = document.createElement('div');
        noHttp3.style.marginTop = '15px';
        noHttp3.style.fontStyle = 'italic';
        noHttp3.style.color = '#999';
        noHttp3.textContent = 'No HTTP/3 statistics available (using HTTP/1.1 or HTTP/2)';
        card.appendChild(noHttp3);
    }
    
    return card;
}

/**
 * Performs a single network request to /delay/{duration}
 */
async function performRequest(index, delaySeconds) {
    const startTime = performance.now();
    
    try {
        const response = await fetch(`/delay/${delaySeconds}`);
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
    
    if (requestCount < 1 || requestCount > 20) {
        updateStatus('Please enter a number between 1 and 20', true);
        return;
    }
    
    // Update UI
    testInProgress = true;
    const button = document.getElementById('startTest');
    button.disabled = true;
    button.textContent = 'Test in Progress...';
    
    const resultsContainer = document.getElementById('results');
    resultsContainer.innerHTML = '';
    
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
            const card = createRequestCard(result.index, result.data, result.duration, result.error);
            resultsContainer.appendChild(card);
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
    const endpointDelaySlider = document.getElementById('endpointDelay');
    const endpointDelayIncrementInput = document.getElementById('endpointDelayIncrement');
    const endpointDelayValue = document.getElementById('endpointDelayValue');
    
    requestCountInput.addEventListener('keypress', handleEnter);
    requestCountInput.addEventListener('input', updateOnChange);
    
    requestDelayInput.addEventListener('keypress', handleEnter);
    requestDelayInput.addEventListener('input', updateOnChange);
    
    delayIncrementInput.addEventListener('keypress', handleEnter);
    delayIncrementInput.addEventListener('input', updateOnChange);
    
    endpointDelayIncrementInput.addEventListener('keypress', handleEnter);
    endpointDelayIncrementInput.addEventListener('input', updateOnChange);
    
    // Update endpoint delay display when slider changes
    endpointDelaySlider.addEventListener('input', function() {
        endpointDelayValue.textContent = this.value;
        updateOnChange();
    });
});
