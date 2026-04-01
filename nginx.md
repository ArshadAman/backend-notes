# 🌐 Nginx: Senior Backend Engineer Reference

**Target:** $20k+ USD Remote / Mid-to-Senior Backend Roles  
**Core Philosophy:** Master the configuration blocks, connection limits, and performance tuning underlying a robust reverse proxy setup.

---

## 🏗️ 1. Architecture Deep Dive: How Nginx is Built

Unlike Apache, which uses a "Process-per-connection" or "Thread-per-connection" model, Nginx operates on an **Event-Driven, Asynchronous, Non-blocking** architecture.

### The Master & Worker Processes
When you start Nginx, it spawns two types of processes:
1. **Master Process:** Reads and validates the configuration file (`nginx.conf`). It maintains the worker processes.
2. **Worker Processes:** Do the actual processing of network connections.
   * **Best Practice:** You generally set `worker_processes auto;` in your `nginx.conf`, which spawns one worker process per physical CPU core.
   * **The Event Loop:** Each worker process runs a single thread containing an event loop (using `epoll` on Linux). This single thread can juggle 10,000+ connections simultaneously by processing events (e.g., "new connection arrived", "disk read finished") asynchronously.

---

## 🛠️ 2. Anatomy of `nginx.conf`

An Nginx configuration is strictly structured into hierarchical "Contexts" (blocks).

### The Context Hierarchy
1.  **`main` (Global):** Directives outside of any block. Defines things like `worker_processes` and user permissions.
2.  **`events` block:** Defines how workers handle connections (`worker_connections 1024;`).
3.  **`http` block:** Handles all HTTP protocol routing, logging formats, and overall web settings.
4.  **`server` block (Virtual Hosts):** Defined inside the `http` block. Usually maps to a specific `domain` or `port` (e.g., listening on port 80 for `api.example.com`).
5.  **`location` block:** Defined inside a `server` block. Matches specific URL routes (e.g., `/api/v1/`).

---

## ⚡ 3. Critical Production Configurations (Code Snippets)

### A. The "Perfect" Reverse Proxy Setup
When putting Nginx in front of FastAPI (Uvicorn), you must forward headers so your application knows the origin of the traffic.

```nginx
# Define the application server pool
upstream backend_api {
    # If Docker, 'app' resolves to the container(s)
    server app:8000 max_fails=3 fail_timeout=10s;
}

server {
    listen 80;
    server_name api.traceledger.com;

    # Defense: Prevent users from uploading 10GB files to crash the server
    client_max_body_size 10M;

    location / {
        # Forward traffic to the upstream pool
        proxy_pass http://backend_api;

        # The "Holy Trinity" of Proxy Headers
        proxy_set_header Host $host;                       # Original Domain requested
        proxy_set_header X-Real-IP $remote_addr;           # User's actual IP
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; # IP Chain
        proxy_set_header X-Forwarded-Proto $scheme;        # HTTP vs HTTPS

        # Request Buffering (Defends against Slowloris attacks)
        proxy_buffering on;
        proxy_buffer_size 128k; 
        proxy_buffers 4 256k;
    }
}
```

### B. Load Balancing Strategies
You dictate how Nginx distributes traffic within the `upstream` block.

```nginx
upstream backend_servers {
    # 1. Round Robin (Default): Sequential distribution.
    # server app1:8000;
    # server app2:8000;

    # 2. Least Connections: Sends traffic to the worker with the least active requests. 
    # Perfect for APIs where some queries take 50ms and others take 5 seconds.
    least_conn; 
    server app1:8000;
    server app2:8000;

    # 3. IP Hash: "Sticky Sessions". Client IP 1.2.3.4 will always hit 'app1'.
    # Used when you have local in-memory caches on the python worker.
    # ip_hash;
    # server app1:8000;
    # server app2:8000;
}
```

### C. Rate Limiting (DoS Defense)
To prevent API abuse, limit how often an IP address can hit your server.

```nginx
# Defined in the `http` block: 
# Create a 10MB memory zone called 'api_limit' tracking IPs, allowing 5 req/sec
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=5r/s;

server {
    location /auth/login {
        proxy_pass http://backend_api;
        
        # Apply the limit. 'burst=10' handles sudden spikes. 'nodelay' rejects overflow immediately.
        limit_req zone=api_limit burst=10 nodelay;
    }
}
```

---

## 🎙️ Elite Interview Questions ($20k+ Tier)

### QA 1: Why do we use a Reverse Proxy in front of an ASGI app like FastAPI? Why can't Uvicorn just handle internet traffic?
**The Senior Answer:**
"Uvicorn is an excellent ASGI server for executing Python asynchronously, but it is not designed to sit at the network edge. Exposing Uvicorn directly makes you highly vulnerable to **Slowloris DoS attacks**, where a malicious client sends a request at 1 byte per second, tying up our expensive Python workers. Nginx acts as a shield using **Request Buffering**. It buffers slow requests into memory or disk and only forwards the complete payload to Uvicorn. Nginx also handles SSL termination, which saves our Application servers from performing heavy cryptographic math."

***

### QA 2: When Nginx forwards a request to FastAPI, how does FastAPI know the user's real IP address?
**The Senior Answer:**
"By default, it doesn't. Because Nginx intercepts the request, the Uvicorn server thinks every single request is coming from `127.0.0.1` (or Nginx's Docker internal IP). If we rely on this for internal rate limiting or security audits, we will accidentally ban our own proxy. To fix this, we configure Nginx to inject specific headers before forwarding: specifically the `X-Real-IP` and the `X-Forwarded-For` headers. The application reads `X-Forwarded-For` to determine the end client's physical IP address. We also pass `X-Forwarded-Proto` so the app knows if the original connection was HTTPS."

***

### QA 3: Our application has 3 instances running behind Nginx. Suddenly, Instance #2 crashes completely. How does Nginx react, and how do we ensure users don't see 502 errors?
**The Senior Answer:**
"By default, Nginx will still attempt to route a portion of traffic to Instance #2 (if using round-robin), which will result in failed requests (502 Bad Gateway or 504 Timeout) for those specific users. To prevent this, we configure **Passive Health Checks** in the `upstream` block. We use the parameters `max_fails` and `fail_timeout` (e.g., `server app:8000 max_fails=3 fail_timeout=10s;`). If Nginx detects 3 connection failures from a container, it will automatically remove Instance #2 from the load balancing pool for 10 seconds. This acts as a proxy-level circuit breaker."

***

### QA 4: A user complains they cannot upload a 10MB PDF. What is the standard Nginx setting blocking this, and what is the security implication of increasing it?
**The Senior Answer:**
"The culprit is Nginx's default `client_max_body_size`, which is usually set to `1m` (1 Megabyte). We can increase it in the `server` block to accommodate the 10MB file. The security implication of blindly setting it to something massive like `client_max_body_size 0;` (unlimited) is that an attacker can launch a volumetric Denial of Service attack. They could upload 10-Gigabyte garbage files specifically to exhaust the server's disk space (`/var/tmp/nginx/client_body_temp`) or chew up I/O capacity. We must set a reasonable, strict upper limit based on our business requirements, and heavily rate-limit the upload endpoint."
