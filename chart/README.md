# go-httpbin Helm Chart

A Helm chart for deploying go-httpbin as a DaemonSet with HTTP, HTTPS, and QUIC/UDP support.

## Features

- **DaemonSet deployment** (runs one pod per node)
- **Host IP binding** via `hostIP` and `hostPort` for direct node access
- HTTP and HTTPS support (separate DaemonSets)
- UDP binding for QUIC protocol
- TLS certificate mounting from host filesystem
- Configurable service with custom cluster IP
- Resource management
- Security context configuration

## Installation

### Basic Installation

```bash
helm install go-httpbin ./chart
```

### Installation with Host IP Binding

To deploy with host IP binding for direct node access:

```bash
helm install go-httpbin ./chart \
  --set hostNetwork.hostIP="YOUR_NODE_IP" \
  --set hostNetwork.useHostPort=true
```

This will bind the ports directly to your specified node IP address.

### Installation with HTTPS Support

To enable both HTTP and HTTPS (requires TLS certificates):

```bash
helm install go-httpbin ./chart \
  --set hostNetwork.hostIP="YOUR_NODE_IP" \
  --set hostNetwork.useHostPort=true \
  --set httpsEnabled=true \
  --set https.certFile="/certs/cert.pem" \
  --set https.keyFile="/certs/key.pem" \
  --set-json 'volumes=[{"name":"certs","hostPath":{"path":"/path/to/certs","type":"Directory"}}]' \
  --set-json 'volumeMounts=[{"name":"certs","mountPath":"/certs","readOnly":true}]'
```

Or use a custom values file:

```bash
helm install go-httpbin ./chart -f custom-values.yaml
```

## Configuration

### Key Configuration Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Image repository | `mccutchen/go-httpbin` |
| `image.tag` | Image tag | `latest` |
| `httpsEnabled` | Enable separate HTTPS DaemonSet | `false` |
| `https.certFile` | Path to TLS certificate file | `/certs/cert.pem` |
| `https.keyFile` | Path to TLS key file | `/certs/key.pem` |
| `qlog.hostPath` | Host path for qlog files (enables qlog if set) | `""` |
| `qlog.mountPath` | Container mount path for qlog files | `/qlogs` |
| `qlog.publicPrefix` | Public URL prefix for qlog files (e.g., `https://example.com/qlogs/`) | `""` |
| `hostNetwork.hostIP` | Bind to specific node IP | `""` |
| `hostNetwork.useHostPort` | Use hostPort for direct node binding | `false` |
| `hostNetwork.ports.http` | Host port for HTTP | `80` |
| `hostNetwork.ports.https` | Host port for HTTPS | `443` |
| `hostNetwork.ports.quic` | Host port for QUIC (UDP) | `443` |
| `service.type` | Service type | `ClusterIP` |
| `service.clusterIP` | Specific cluster IP (optional) | `""` |
| `service.ports.http.port` | HTTP port | `80` |
| `service.ports.https.port` | HTTPS port | `443` |
| `service.ports.quic.port` | QUIC UDP port | `443` |
| `volumes` | Volume mounts for certificates | `[]` |
| `volumeMounts` | Volume mount paths | `[]` |

**Note:** As a DaemonSet, one pod will automatically run on each node.

### Service Configuration

The service is configured similar to haproxy with:
- **HTTP** (TCP 80 → 8080)
- **HTTPS** (TCP 443 → 8443)
- **QUIC** (UDP 443 → 8443)

### Example: Deploy with Host IP and HTTPS

Create a file `custom-values.yaml`:

```yaml
# Bind to a specific node IP
hostNetwork:
  hostIP: "192.168.1.100"  # Your node's IP address
  useHostPort: true
  ports:
    http: 80
    https: 443
    quic: 443

# Enable HTTPS support
httpsEnabled: true
https:
  certFile: "/certs/server.pem"
  keyFile: "/certs/server.pem"

# Mount TLS certificates from host
volumes:
  - name: certs
    hostPath:
      path: /etc/ssl/private
      type: Directory

volumeMounts:
  - name: certs
    mountPath: /certs
    readOnly: true

# Run as specific user if needed for certificate access
podSecurityContext:
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000

resources:
  limits:
    cpu: 200m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
```

Then install:

```bash
helm install go-httpbin ./chart -f custom-values.yaml
```

### QLOG Support

QLOG provides detailed HTTP/3 connection tracing for debugging and analysis. The qlog host path directory must exist and be writable by the container. QLOG files will be created for each HTTP/3 connection and can be analyzed using tools like [qvis](https://qvis.quictools.info/).

When `qlog.publicPrefix` is configured, JSON responses will include a `qlog_visualization_link` field in the `http3` data that points to qvis with the qlog file pre-loaded. For example:

```json
{
  "http3": {
    "protocol": "HTTP/3.0",
    "rtt": "25ms",
    "dropped_packets": 0,
    "qlog_visualization_link": "https://qvis.quictools.info/?file=https://jsteelkw.ca/qlogs/e3788a33642554b4_server.sqlog#/sequence?file=https%3A%2F%2Fjsteelkw.ca%2Fqlogs%2Fe3788a33642554b4_server.sqlog"
  }
}
```

## Service Ports

This chart creates a service with the following ports:

| Port Name | Protocol | Service Port | Target Port |
|-----------|----------|--------------|-------------|
| http | TCP | 80 | 8080 |
| https | TCP | 443 | 8443 |
| quic | UDP | 443 | 8443 |

When `httpsEnabled` is true, two DaemonSets are deployed:
- **HTTP DaemonSet**: Serves plain HTTP traffic on port 80
- **HTTPS DaemonSet**: Serves HTTPS and QUIC traffic on port 443 (TCP and UDP)

## Uninstalling

```bash
helm uninstall go-httpbin
```

## Upgrading

```bash
helm upgrade go-httpbin ./chart
```

## Testing

After installation, verify the service:

```bash
kubectl get svc go-httpbin
kubectl describe svc go-httpbin
```

Test HTTP endpoint:

```bash
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://go-httpbin/get
```

## Notes

- When `httpsEnabled` is true, both HTTP and HTTPS DaemonSets run simultaneously
- The service will automatically be assigned an IP if `service.clusterIP` is not specified
- Certificate files must be readable by the container user (configure `podSecurityContext` accordingly)
- For production use, configure appropriate resource limits
