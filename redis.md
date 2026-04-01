# 🔴 Redis: Senior Backend Engineer Reference

**Core Philosophy:** A Junior uses Redis as "a fast dictionary." A Senior understands that Redis is a single-threaded, in-memory data structure server that can act as a cache, a distributed lock, a rate limiter, a pub/sub broker, and a session store — and knows exactly when each pattern breaks under pressure.

---

## 📖 1. What Redis Actually Is (Beginner Foundation)

### The Problem Without Redis
Your FastAPI endpoint hits PostgreSQL to fetch a user profile. The query takes 50ms. Under 100 requests/sec, that's fine. Under 10,000 requests/sec, Postgres collapses — 10,000 simultaneous connections, CPU at 100%, queries timing out.

### The Fix: The Cache Layer
Redis sits **between** your application and the database. It holds frequently accessed data in pure RAM. RAM access takes ~100 nanoseconds. Disk access (Postgres) takes ~10 milliseconds. That's a **100,000x speed difference**.

```
User Request → FastAPI → Redis (RAM: 0.1ms) → ✅ Return instantly
                           ↓ (cache miss)
                        PostgreSQL (Disk: 50ms) → Store result in Redis → Return
```

### Why Not Just Use a Python Dictionary?
A Python `dict` lives inside a single process. If you scale to 4 Gunicorn workers, each worker has its own separate dictionary — they don't share state. If Worker 1 caches a user, Workers 2-4 have no idea. Redis is an **external, shared server** that all workers (and all containers across multiple machines) connect to over the network.

---

## 🏗️ 2. Architecture Internals

### A. Threading Model (The Nuance That Matters)
Redis **command execution** is single-threaded — every `SET`, `GET`, `ZADD` runs on one CPU core sequentially. This is the source of its power:
- **No locks needed.** Because only one thread touches the data, there are zero race conditions, zero mutexes, zero deadlocks at the data layer.
- **No context switching.** The CPU never wastes time swapping between threads.

**However, since Redis 6.0**, network I/O (reading requests from sockets, writing responses back) can be handled by **multiple I/O threads**. So the architecture is:
- **I/O threads** (configurable, default off): Read/write network data in parallel.
- **Main thread**: Executes all commands sequentially against the in-memory data structures.

Redis uses `epoll`/`kqueue` (the same I/O multiplexing that powers Nginx and Node.js) to handle 100,000+ concurrent connections.

**The trade-off:** A single slow command (like `KEYS *` on a million-key database) blocks the main execution thread. Every other client is frozen until it completes. This is why certain commands are banned in production.

### B. Data Structures (Not Just Key-Value)
Redis is NOT a simple key-value store. It provides rich, server-side data structures:

| Structure | What It Is | Use Case | Time Complexity |
|---|---|---|---|
| `STRING` | Simple value (text, number, binary) | Cache a JSON response, store a counter | `O(1)` |
| `HASH` | Dictionary/Object (`field: value` pairs) | Store a user profile without serializing JSON | `O(1)` per field |
| `LIST` | Ordered linked list | Job queue, activity feed | `O(1)` push/pop |
| `SET` | Unordered unique collection | Track unique visitors, tag systems | `O(1)` add/check |
| `SORTED SET (ZSET)` | Set where each member has a numeric score | Leaderboard, priority queue, rate limiting | `O(log N)` |
| `STREAM` | Append-only log (like Kafka) | Event sourcing, consumer groups | `O(1)` append |

### C. Persistence Models
Redis is in-memory, but it can survive restarts via two persistence strategies:

**RDB (Snapshotting):**
- Redis forks the process and writes the entire dataset to a `.rdb` file on disk at configured intervals (e.g., every 5 minutes).
- Fast to restore, but you lose up to 5 minutes of data on crash.

**AOF (Append-Only File):**
- Redis logs every single write command to a file sequentially (`SET user:1 "john"`, `INCR page_views`, etc.).
- On restart, Redis replays the entire log to rebuild state.
- Much more durable (can be configured to fsync every second or every command), but the file grows large and replay is slow.

**The Production Standard:** Use both. RDB for fast restarts + AOF for minimal data loss.

---

## ⚡ 3. Core Caching Patterns

### A. Cache-Aside (Lazy Loading)
The most common pattern. The application manages the cache explicitly.
```
1. Check Redis for key
2. If HIT → return cached data
3. If MISS → query Postgres → store result in Redis with TTL → return data
```
**Pros:** Only caches data that's actually requested. Simple.
**Cons:** First request is always slow (cold cache). Stale data possible if DB changes.

### B. Write-Through
Every write to the database simultaneously writes to Redis.
```
1. User updates profile
2. Write to Postgres
3. Immediately write to Redis
4. Future reads always hit warm cache
```
**Pros:** Cache is always fresh.
**Cons:** Every write is slower (two writes). Caches data that may never be read.

### C. Write-Behind (Write-Back)
Writes go to Redis first, then asynchronously flushed to Postgres in batches.
**Pros:** Extremely fast writes.
**Cons:** Data loss risk if Redis crashes before flush. Complex to implement.

---

## 🔒 4. Distributed Locking (Redlock)

### The Problem
Two FastAPI workers simultaneously process a "Transfer $100" request for the same user. Both read balance = $500. Both subtract $100. Both write $400. The user lost $100 instead of $200.

### The Fix: Redis Lock
```python
import uuid

lock_key = "lock:transfer:user_42"
lock_token = str(uuid.uuid4())  # Unique token per worker

# Acquire: SET NX with unique token
acquired = await redis.set(lock_key, lock_token, nx=True, ex=10)
if not acquired:
    raise HTTPException(status_code=409, detail="Transfer already in progress")

try:
    # Critical section — only one worker can be here at a time
    balance = await db.get_balance(user_id=42)
    await db.set_balance(user_id=42, amount=balance - 100)
finally:
    # SAFE UNLOCK: Lua script ensures we only delete OUR lock, not someone else's
    # If the lock expired and another worker acquired it, this is a no-op.
    unlock_script = """
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    else
        return 0
    end
    """
    await redis.eval(unlock_script, 1, lock_key, lock_token)
```

### Why the Lua Script for Unlock?
Without it, this race condition occurs:
1. Worker A acquires lock (TTL = 10s).
2. Worker A's processing takes 12 seconds.
3. At second 10, lock auto-expires.
4. Worker B acquires the lock.
5. At second 12, Worker A finishes and calls `DELETE lock_key` — **deleting Worker B's lock.**
6. Worker C now enters the critical section. Two workers are inside simultaneously.

The Lua script atomically checks "is this still MY lock?" before deleting. If the token doesn't match, it does nothing.

### Why `nx=True` and `ex=10`?
- `nx=True` (SET if Not eXists): If the key already exists, `SET` returns `None` instead of overwriting. This is the atomic lock acquisition.
- `ex=10` (Expire in 10 seconds): If the worker crashes and never deletes the lock, it auto-expires after 10 seconds. Without this, the lock would persist forever (deadlock).

### The Redlock Controversy
For a single Redis instance, the above works fine. For a Redis Cluster, Martin Kleppmann (author of "Designing Data-Intensive Applications") famously argued that Redlock is unsafe because Redis replication is asynchronous — a lock acquired on a master can be lost if the master crashes before replicating to the replica. For truly critical distributed locks, use a consensus system (ZooKeeper, etcd).

---

## 🚦 5. Rate Limiting with Redis

### The Sliding Window Counter (Production Pattern)
```python
import time

async def is_rate_limited(redis, user_id: str, limit: int = 100, window: int = 60) -> bool:
    """Allow max `limit` requests per `window` seconds per user."""
    key = f"rate:{user_id}"
    now = time.time()

    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, 0, now - window)  # Remove entries older than window
    pipe.zadd(key, {str(now): now})              # Add current request timestamp
    pipe.zcard(key)                               # Count requests in window
    pipe.expire(key, window)                      # Auto-cleanup
    results = await pipe.execute()

    request_count = results[2]
    return request_count > limit
```

**Why Sorted Set instead of a simple counter?**
A simple `INCR` counter resets at fixed intervals (e.g., exactly at minute boundaries), creating a burst vulnerability at the boundary. The Sorted Set approach creates a true **sliding window** — every request is timestamped, and old entries continuously fall off.

---

## 🏭 6. Production FastAPI + Redis Integration

### Complete Setup with Connection Pooling & Lifespan
```python
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from redis.asyncio import Redis, ConnectionPool

# --- Connection Pool (shared across all requests) ---
redis_pool = ConnectionPool.from_url(
    "redis://redis:6379/0",
    max_connections=20,      # Max 20 physical TCP connections to Redis
    decode_responses=True,   # Return strings instead of bytes
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: test the connection
    r = Redis(connection_pool=redis_pool)
    await r.ping()
    print("✅ Redis connected")
    yield
    # Shutdown: close pool
    await redis_pool.disconnect()

app = FastAPI(lifespan=lifespan)

# --- Dependency: get a Redis client per request ---
async def get_redis():
    return Redis(connection_pool=redis_pool)

# --- Cache-Aside Pattern ---
@app.get("/users/{user_id}")
async def get_user(user_id: int, redis: Redis = Depends(get_redis)):
    cache_key = f"user:{user_id}"

    # 1. Check cache
    cached = await redis.get(cache_key)
    if cached:
        return {"source": "cache", "data": json.loads(cached)}

    # 2. Cache miss → hit database
    user = await fetch_user_from_db(user_id)
    if not user:
        raise HTTPException(status_code=404)

    # 3. Store in cache with 5-minute TTL
    await redis.set(cache_key, json.dumps(user), ex=300)
    return {"source": "database", "data": user}

# --- Cache Invalidation on Write ---
@app.put("/users/{user_id}")
async def update_user(user_id: int, data: dict, redis: Redis = Depends(get_redis)):
    await update_user_in_db(user_id, data)
    # CRITICAL: Delete the stale cache entry immediately
    await redis.delete(f"user:{user_id}")
    return {"status": "updated"}
```

### Why Connection Pooling Matters
Without a pool, every request opens a new TCP connection to Redis, does the command, and closes the connection. TCP handshake costs ~1ms. Under 10,000 req/sec, you're wasting 10 full seconds of CPU per second just on handshakes. A pool holds 20 persistent connections open and reuses them.

---

## ⚠️ 7. Production Anti-Patterns & Dangers

### A. The `KEYS *` Death Sentence
`KEYS *` scans every single key in the database. On a million-key instance, this blocks the single-threaded event loop for 500ms+. Every other client is frozen.
**The Fix:** Use `SCAN` — it iterates in small batches, yielding control back to the event loop between batches.

### B. The Thundering Herd (Cache Stampede)
A popular cache key expires. At that exact millisecond, 5,000 requests simultaneously discover the cache miss and all hit Postgres at the same time. Postgres collapses.
**The Fix:** Use a distributed lock. Only one request is allowed to rebuild the cache. The other 4,999 wait for the lock to release, then read the freshly populated cache.

### C. Hot Key Problem
One key (e.g., a viral tweet) receives 90% of all traffic. That single key lives on one Redis node. That node's CPU maxes out while others sit idle.
**The Fix:** Replicate the hot key with random suffixes (`tweet:123:shard_0`, `tweet:123:shard_1`). Clients randomly pick a shard, distributing load.

### D. Memory Exhaustion
Redis grows until it consumes all available RAM, then the OS OOM-kills the process.
**The Fix:** Set `maxmemory` and a `maxmemory-policy`:
- `allkeys-lru`: Evict the Least Recently Used key when memory is full (most common).
- `volatile-ttl`: Evict keys with the shortest remaining TTL first.
- `noeviction`: Return errors on write when memory is full (safest for critical data).

---

## 🔁 8. Redis Pub/Sub vs Streams

### Pub/Sub (Fire-and-Forget)
```python
# Publisher
await redis.publish("notifications", json.dumps({"user": 42, "msg": "hello"}))

# Subscriber (in a separate process)
pubsub = redis.pubsub()
await pubsub.subscribe("notifications")
async for message in pubsub.listen():
    print(message["data"])
```
**The trap:** If no subscriber is connected when the message is published, the message is **permanently lost**. There is no queue, no persistence, no replay. Pub/Sub is purely real-time broadcast.

### Streams (Persistent, Replayable)
Redis Streams are an append-only log (similar to Kafka). Messages persist even if no consumer is listening. Consumer Groups allow multiple workers to divide the workload.
```python
# Producer
await redis.xadd("events", {"action": "signup", "user_id": "42"})

# Consumer Group
await redis.xgroup_create("events", "workers", id="0", mkstream=True)
messages = await redis.xreadgroup("workers", "worker_1", {"events": ">"}, count=10)
# After processing:
await redis.xack("events", "workers", message_id)
```

**When to use which:**
- Pub/Sub: Real-time chat notifications, WebSocket broadcasting (data loss is acceptable).
- Streams: Event sourcing, audit logs, task queues (durability matters).

---

## 🎙️ Elite Interview Q&A

### QA 1: Redis is single-threaded. How can it possibly handle 100,000+ requests per second?
**The Senior Answer:**
"Redis is single-threaded for **data operations**, but it uses I/O multiplexing (`epoll` on Linux, `kqueue` on macOS) to manage thousands of concurrent network connections without a thread per connection. The event loop non-blockingly reads commands from sockets, executes them against in-memory data structures (all O(1) or O(log N) operations), and writes responses back. Because there are no disk seeks, no locks, and no context switches, a single core can process 100,000+ commands per second.
Starting from Redis 6.0, Redis introduced **I/O threading** — multiple threads handle network read/write, but command execution remains single-threaded. This further increases throughput by parallelizing the network I/O bottleneck."

***

### QA 2: You cache a user profile with a 5-minute TTL. The user updates their name. For the next 5 minutes, the app shows the old name. How do you solve stale cache?
**The Senior Answer:**
"This is the fundamental Cache Invalidation problem. There are three strategies:
1. **Active Invalidation (Best):** On every `UPDATE` to Postgres, immediately `DELETE` the corresponding Redis key. The next read triggers a cache miss and fetches fresh data. This is what I implement in the write endpoint.
2. **Short TTLs:** Reduce TTL to 30 seconds. Staleness window shrinks, but cache hit rate drops and DB load increases.
3. **Event-Driven Invalidation:** Postgres triggers a CDC (Change Data Capture) event via a WAL listener, which publishes to Redis Pub/Sub, causing all app instances to invalidate the key simultaneously.
In practice, I use option 1 for user-facing data and option 2 for analytics/dashboards where slight staleness is acceptable."

***

### QA 3: You use Redis as a distributed lock for payment processing. The lock has a 10-second TTL. Your payment API call to Stripe takes 12 seconds. What catastrophic event occurs?
**The Senior Answer:**
"The lock auto-expires after 10 seconds while the original worker is still processing the payment at the 10-second mark. A second worker acquires the lock at second 10 and begins a duplicate payment. At second 12, the first worker finishes and deletes the lock — but it's actually deleting the second worker's lock, leaving the critical section unprotected for a third worker.
**The Fix:** Two things:
1. **Fencing tokens:** Each lock acquisition generates a monotonically increasing token. The downstream system (Stripe) must reject operations with stale tokens.
2. **Lock extension:** The worker runs a background thread that periodically extends the lock's TTL (e.g., every 5 seconds, extend by 10 seconds) as long as the work is in progress. The `redis-py` library's `Lock` class supports this via the `extend()` method."

***

### QA 4: You run `redis-cli INFO memory` and see Redis is using 28GB of RAM on a 32GB server. What do you do before it OOM-kills?
**The Senior Answer:**
"First, I audit memory usage: `redis-cli --bigkeys` identifies the largest keys consuming disproportionate memory. `MEMORY USAGE <key>` shows exact bytes per key.
Then I implement eviction: I set `maxmemory 24gb` and `maxmemory-policy allkeys-lru`. Redis will automatically evict the least recently accessed keys when the 24GB ceiling is hit, keeping 8GB free for the OS and Redis's own overhead.
For long-term fixes, I either shard the dataset across multiple Redis nodes (Redis Cluster), or audit whether cold data (data not accessed in 30+ days) should be evicted sooner via shorter TTLs."

***

### QA 5: Your Redis master goes down. The replica is promoted to master. 50 transactions that were written to the old master in the last 200ms are permanently lost. Why?
**The Senior Answer:**
"Redis replication is **asynchronous** by default. When a client writes to the master, the master acknowledges the write immediately and then asynchronously streams the command to replicas. If the master crashes before the replication stream reaches the replica, those in-flight writes are permanently lost.
**The Fix:** Enable `WAIT` command: `WAIT 1 500` blocks the write until at least 1 replica has confirmed receipt, with a 500ms timeout. This converts the replication to semi-synchronous. The trade-off is increased write latency (~1-2ms). For financial data, this trade-off is mandatory."

***

### QA 6: What is the difference between `DEL` and `UNLINK` in Redis?
**The Senior Answer:**
"`DEL` is synchronous — it blocks the single-threaded event loop while freeing the memory. If you delete a key holding a 10-million-element Sorted Set, `DEL` blocks all other clients for hundreds of milliseconds.
`UNLINK` is asynchronous — it removes the key from the keyspace immediately (O(1)), then delegates the actual memory reclamation to a background thread. All other clients continue unblocked.
In production, I always use `UNLINK` for keys that might be large."

***

### QA 7: An interviewer asks: "Can Redis replace RabbitMQ as a message broker?"
**The Senior Answer:**
"Partially, depending on the requirements.
**Redis Lists** (`LPUSH`/`BRPOP`) can act as a simple job queue. But they lack acknowledgements — if a worker pops a message and crashes, the message is gone.
**Redis Streams** (introduced in 5.0) are the real answer. They support consumer groups, message acknowledgement (`XACK`), pending message tracking, and replay. They are architecturally similar to Kafka.
However, Redis Streams lack several RabbitMQ features: no exchange routing (direct/fanout/topic), no dead letter exchanges, no delayed message scheduling, and no built-in retry queues with TTL chaining.
**My rule:** For simple task queues with low volume, Redis Streams work fine and save infrastructure complexity. For complex routing, strict durability guarantees, or high-volume event processing, I use RabbitMQ or Kafka."

***

### QA 8: You use Redis to cache API responses. Your cache hit rate is only 30%. How do you diagnose and improve it?
**The Senior Answer:**
"A 30% hit rate means 70% of requests are cache misses — Redis is barely helping.
**Diagnosis:**
1. `redis-cli INFO stats` → check `keyspace_hits` vs `keyspace_misses` ratio.
2. Check if TTLs are too short — keys expire before they're requested again.
3. Check if cache keys are too specific — `user:42:profile:v2:en` fragments the cache so each variation is a separate miss.

**Fixes:**
1. Increase TTL from 60s to 300s for stable data.
2. Normalize cache keys — remove unnecessary granularity.
3. Implement cache warming — on startup, pre-populate the top 1,000 most-accessed keys from the database.
4. Use `LFU` (Least Frequently Used) eviction instead of `LRU` — LFU keeps frequently accessed keys alive even if they haven't been accessed in the last few seconds."

***

### QA 9: Explain the Redis Pipeline and why it's critical for performance.
**The Senior Answer:**
"Without pipelining, every Redis command requires a full network round-trip:
```
Client → SET key1 → Server → OK → Client → SET key2 → Server → OK
```
Each round-trip costs ~0.5ms on localhost, ~2ms over a network. If you need to execute 1,000 commands, that's 2 full seconds of pure network waiting.

With pipelining, the client buffers all 1,000 commands and sends them in a single TCP packet:
```
Client → [SET key1, SET key2, ... SET key1000] → Server → [OK, OK, ... OK]
```
One round-trip instead of 1,000. This reduces 2 seconds to 2 milliseconds — a 1,000x improvement.

In Python:
```python
pipe = redis.pipeline()
for i in range(1000):
    pipe.set(f'key:{i}', f'value:{i}')
await pipe.execute()  # Single network round-trip
```
**Critical note:** Pipeline commands are NOT atomic. If you need atomic execution of multiple commands, use a Lua script or `MULTI/EXEC` transaction."

***

### QA 10: What is Redis Cluster and when do you need it?
**The Senior Answer:**
"A single Redis instance maxes out at ~25GB of usable RAM and ~100,000 ops/sec. Redis Cluster shards data across multiple nodes using a hash slot mechanism (16,384 slots total).

Each key is hashed (`CRC16(key) % 16384`) to determine which slot — and therefore which node — owns it. If you have 3 master nodes, each owns ~5,461 slots.

**When you need it:**
1. Dataset exceeds single-server RAM.
2. Write throughput exceeds single-core capacity.
3. You need automatic failover (each master has replicas).

**The trade-off:** Multi-key operations (`MGET`, `SUNION`, transactions) only work if all keys hash to the same slot. You force this with hash tags: `{user:42}:profile` and `{user:42}:settings` both hash on `user:42`, guaranteeing they land on the same node."

---

## 🔧 9. Lua Scripting (Atomic Operations)

Pipelines batch commands but are **not atomic** — another client can interleave commands between your pipeline steps. `MULTI/EXEC` transactions queue commands and execute them sequentially, but they have no conditional logic (no `if/else`) and **no rollback** — if one command fails, the rest still execute.

### Lua Scripts: The Real Solution
Lua scripts run atomically on the Redis main thread. While a Lua script executes, **no other command from any client can run**. This makes them the only way to implement true atomic read-modify-write operations.

```python
# Atomic "deduct balance only if sufficient funds" — impossible with MULTI/EXEC
deduct_script = """
local balance = tonumber(redis.call('GET', KEYS[1]))
if balance >= tonumber(ARGV[1]) then
    redis.call('DECRBY', KEYS[1], ARGV[1])
    return 1
else
    return 0
end
"""
result = await redis.eval(deduct_script, 1, "balance:user_42", 100)
# result = 1 (success) or 0 (insufficient funds)
```

### When to Use What

| Tool | Atomic? | Conditional Logic? | Rollback? | Use Case |
|---|---|---|---|---|
| Pipeline | ❌ No | ❌ No | ❌ No | Batching independent commands for network efficiency |
| `MULTI/EXEC` | ✅ Sequential | ❌ No | ❌ No | Simple multi-command writes (all-or-nothing execution) |
| Lua Script | ✅ Full | ✅ Yes | N/A | Complex atomic logic (check-and-set, rate limiters, safe locks) |

### The Danger
Lua scripts block the entire Redis server while executing. A poorly written script that loops over millions of keys will freeze all clients. Keep scripts short and fast.

---

## ⚠️ 10. Redis Transactions Are NOT ACID

An interviewer will ask: "Are Redis transactions like Postgres transactions?"

**No.** Redis `MULTI/EXEC` is fundamentally different:

| Property | Postgres | Redis MULTI/EXEC |
|---|---|---|
| **Atomicity** | All-or-nothing, with rollback | Commands are queued and executed sequentially. If one fails, the rest still run. **No rollback.** |
| **Isolation** | Full snapshot isolation | No isolation during QUEUE phase. Another client can modify data between `MULTI` and `EXEC`. (Use `WATCH` for optimistic locking.) |
| **Consistency** | Schema + constraint enforcement | None — Redis has no schema |
| **Durability** | WAL + fsync | Only if AOF is enabled with `appendfsync always` |

### The `WATCH` Pattern (Optimistic Locking)
```
WATCH balance:user_42
GET balance:user_42        → returns 500
MULTI
SET balance:user_42 400
EXEC
```
If another client modifies `balance:user_42` between `WATCH` and `EXEC`, the entire transaction is **aborted** (EXEC returns `nil`). Your application must catch this and retry. This is identical to Postgres `SERIALIZABLE` isolation failures.

---

## 🌪️ 11. Cache Stampede: The Full Arsenal

A distributed lock is one solution to cache stampede, but Staff-level answers include multiple strategies:

### Strategy 1: Distributed Lock (Mutex)
Only one request rebuilds the cache. Others wait for the lock to release, then read the fresh cache.
**Trade-off:** Adds latency for waiting requests. Lock failure = all requests hit DB.

### Strategy 2: Request Coalescing (Singleflight)
Multiple concurrent requests for the same cache key are collapsed into a single database query. The first request triggers the query; all others subscribe to the result.
```python
# Python equivalent using asyncio
pending = {}

async def get_with_coalesce(key):
    if key in pending:
        return await pending[key]  # Wait for the in-flight request
    
    pending[key] = asyncio.create_task(fetch_from_db(key))
    result = await pending[key]
    del pending[key]
    return result
```

### Strategy 3: Early Recomputation
Instead of waiting for the TTL to expire, refresh the cache **before** it expires. If TTL is 300s, start a background refresh at 240s. The cache is never empty.

### Strategy 4: Stale-While-Revalidate
Serve the expired (stale) cached data immediately while triggering a background refresh. The user gets a fast response with slightly stale data, and the next user gets fresh data.

### Strategy 5: TTL Jitter (Prevents Synchronized Expiry)
If 10,000 keys are all created at the same time with `TTL=300`, they all expire at the exact same second — triggering 10,000 simultaneous cache misses.
```python
import random
base_ttl = 300
jittered_ttl = base_ttl + random.randint(0, 60)  # 300-360 seconds
await redis.set(key, value, ex=jittered_ttl)
```
The random jitter spreads expirations across a 60-second window, preventing the thundering herd.

---

## 🧠 12. Memory Fragmentation (The Hidden Killer)

### The Symptom
`redis-cli INFO memory` shows `used_memory: 20GB`. But `htop` on the server shows Redis consuming `28GB` of RSS (Resident Set Size). Where did 8GB go?

### The Cause: Allocator Fragmentation
Redis uses `jemalloc` (a C memory allocator). When you delete keys, `jemalloc` doesn't necessarily return the freed memory pages back to the Operating System. The memory is "freed" internally (available for future Redis allocations) but still held by the process.

Over time, with lots of creates/deletes of varying sizes, the memory becomes fragmented — full of small usable holes that can't fit larger allocations.

### How to Diagnose
```
redis-cli INFO memory
# Look at:
# mem_fragmentation_ratio = used_memory_rss / used_memory
# Healthy: 1.0 - 1.5
# Danger:  > 1.5 (significant waste)
# Critical: > 2.0 (50%+ memory is wasted fragments)
```

### The Fix
- Redis 4.0+ supports **active defragmentation**: `CONFIG SET activedefrag yes`. Redis rearranges memory in the background to consolidate fragments.
- Restart Redis (restoring from RDB rebuilds a clean, compact memory layout).
- Avoid patterns that create/delete millions of small keys rapidly.

---

## 📊 13. Streams vs Kafka: The Precise Distinction

| Dimension | Redis Streams | Apache Kafka |
|---|---|---|
| **Storage** | Memory-first (with AOF/RDB persistence) | Disk-first (append-only log on filesystem) |
| **Throughput** | ~100k msgs/sec per node | ~1M+ msgs/sec per partition |
| **Retention** | Limited by RAM | Unlimited (disk is cheap) |
| **Consumer Groups** | ✅ Yes | ✅ Yes |
| **Replay** | ✅ Yes (by ID) | ✅ Yes (by offset) |
| **Ordering** | Per-stream | Per-partition |
| **Partitioning** | Manual (multiple streams) | Built-in (topic partitions) |
| **Latency** | Sub-millisecond | ~5-10ms |

**The One-Liner:** "Redis Streams optimize for **ultra-low latency** at moderate scale. Kafka optimizes for **massive throughput** at slightly higher latency. If I need to process 10,000 events/sec with sub-ms response, I use Redis Streams. If I need to ingest 1 million events/sec for data pipelines, I use Kafka."

---

## 🔀 14. Cluster Deep Dive: Resharding & Cross-Slot Limits

### Resharding Cost
Adding a new node to a Redis Cluster requires **slot migration**. Redis must physically move hash slots (and all keys in those slots) from existing nodes to the new node. During migration:
- Keys actively being migrated may experience ~1-2ms additional latency (ASK redirects).
- The slot is briefly in a "migrating" state where writes to that slot are redirected to the new owner.
- For large datasets, resharding can take hours and consume significant network bandwidth.

### Cross-Slot Transaction Limitations
In a cluster, `MULTI/EXEC`, Lua scripts, and multi-key commands (`MGET`, `DEL key1 key2`) **only work if all involved keys hash to the same slot**. If they don't, Redis returns a `CROSSSLOT` error.

**The Fix:** Hash tags. Place the shared part in `{}`:
```
SET {order:42}:status "paid"
SET {order:42}:total "99.99"
# Both keys hash on "order:42" → same slot → same node → transactions work
```

**The Real Trade-off:** Hash tags force related keys onto the same node. If `order:42` is a hot key, all related data concentrates on one node, recreating the hot-key problem. There is no free lunch.

---

## 🎙️ Elite QA Extensions (Staff-Level)

### QA 11: An interviewer asks: "Why can't you just use `MULTI/EXEC` instead of Lua for your distributed lock?" 
**The Senior Answer:**
"Because `MULTI/EXEC` cannot express conditional logic. The lock release requires: 'IF the lock value equals my token, THEN delete it.' `MULTI/EXEC` queues commands blindly — it cannot branch based on a `GET` result within the transaction. I can use `WATCH` for optimistic locking, but that requires retry loops and is fundamentally race-prone under high contention.
A Lua script executes atomically with full `if/else` logic: `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1])`. No other client can interleave. This is the only correct way to implement check-and-delete atomically."

***

### QA 12: Your Redis instance shows `mem_fragmentation_ratio: 2.3`. What does this mean and how do you fix it?
**The Senior Answer:**
"A fragmentation ratio of 2.3 means the OS has allocated 2.3x more memory to Redis than Redis is actually using for data. 130% of the allocated memory is wasted in fragmented holes within `jemalloc`'s pages.
This typically happens after large bulk deletions — Redis frees the keys internally, but `jemalloc` holds onto the OS memory pages because they contain a mix of freed and live allocations.
**Immediate fix:** Enable active defragmentation: `CONFIG SET activedefrag yes`. Redis will rearrange live data in the background to consolidate fragments and release pages back to the OS.
**Nuclear fix:** If fragmentation is extreme, restart Redis. Loading from RDB rebuilds a perfectly compact memory layout with a fragmentation ratio near 1.0."

***

### QA 13: You set 50,000 cache keys with `TTL=300` during a bulk import. Exactly 5 minutes later, your database gets crushed by 50,000 simultaneous queries. What happened?
**The Senior Answer:**
"All 50,000 keys expired at the exact same second, triggering 50,000 simultaneous cache misses. Every incoming request hit the database instead of Redis — a classic **cache stampede** caused by synchronized TTL expiry.
**The Fix:** Add random jitter to every TTL: `TTL = 300 + random(0, 60)`. This spreads the 50,000 expirations across a 60-second window, converting a vertical spike into a smooth horizontal curve. Combined with request coalescing (collapsing duplicate in-flight DB queries), the database load stays flat."
