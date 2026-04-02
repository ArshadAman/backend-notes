# 🌐 REST API Design: Senior Backend Engineer Reference

**Core Philosophy:** A Junior builds endpoints that "work." A Senior designs APIs that are predictable, versionable, secure, and impossible to misuse. REST is not a protocol — it is a set of architectural constraints. If your API violates them, it becomes unmaintainable at scale.

---

## 📖 1. What REST Actually Means (Beginner Foundation)

REST stands for **RE**presentational **S**tate **T**ransfer. It was defined by Roy Fielding in his PhD thesis (2000). It is NOT a standard or a protocol — it is a set of architectural constraints for building web services over HTTP.

### The 6 Constraints
1. **Client-Server:** The frontend and backend are completely separate. The server doesn't know or care if the client is a browser, a mobile app, or a CLI tool.
2. **Stateless:** Every request must contain ALL information needed to process it. The server does not store session state between requests. (Authentication is handled via tokens in headers, not server-side sessions.) **Important nuance:** "Stateless" applies at the HTTP interaction layer — the server doesn't remember your previous request. But real systems still rely on shared state stores (Redis for rate limits, Postgres for user data). The constraint means no *per-client session* is stored on the application server itself.
3. **Cacheable:** Responses must explicitly declare whether they can be cached (`Cache-Control`, `ETag` headers).
4. **Uniform Interface:** Resources are identified by URIs. Interactions use standard HTTP methods. Responses use standard media types (JSON).
5. **Layered System:** The client doesn't know if it's talking to the actual server or a load balancer/proxy/CDN in front of it.
6. **Code on Demand (Optional):** The server can send executable code to the client (e.g., JavaScript). Rarely used.

---

## 🏗️ 2. URL Design: The Foundation

### The Rules
URLs represent **resources** (nouns), not actions (verbs). The HTTP method IS the verb.

```
✅ GET    /users          → List all users
✅ POST   /users          → Create a user
✅ GET    /users/42       → Get user 42
✅ PUT    /users/42       → Replace user 42 entirely
✅ PATCH  /users/42       → Partially update user 42
✅ DELETE /users/42       → Delete user 42

❌ POST   /createUser     → Verb in URL (anti-pattern)
❌ GET    /getUser?id=42  → Verb in URL, query param for ID
❌ POST   /deleteUser     → Wrong method + verb in URL
```

### Nested Resources (Relationships)
```
GET  /users/42/orders          → All orders for user 42
GET  /users/42/orders/7        → Order 7 belonging to user 42
POST /users/42/orders          → Create a new order for user 42
```

**The depth rule:** Never nest more than 2 levels deep. `/users/42/orders/7/items/3/options` is a nightmare. Instead, flatten: `GET /order-items/3`.

### Pluralization
Always use plural nouns: `/users`, `/orders`, `/products`. Not `/user`, `/order`. The collection is plural; a single item is identified by ID within the collection.

---

## 📬 3. HTTP Methods Deep Dive

| Method | Meaning | Idempotent? | Safe? | Request Body? |
|---|---|---|---|---|
| `GET` | Read a resource | ✅ Yes | ✅ Yes | ❌ No |
| `POST` | Create a new resource | ❌ No | ❌ No | ✅ Yes |
| `PUT` | Replace a resource entirely | ✅ Yes | ❌ No | ✅ Yes |
| `PATCH` | Partially update a resource | ❌ No* | ❌ No | ✅ Yes |
| `DELETE` | Remove a resource | ✅ Yes | ❌ No | ❌ No |
| `HEAD` | Same as GET but no response body | ✅ Yes | ✅ Yes | ❌ No |
| `OPTIONS` | Describe available methods (CORS) | ✅ Yes | ✅ Yes | ❌ No |

### Key Terms
- **Idempotent:** Calling it 10 times produces the same result as calling it once. `DELETE /users/42` ten times = user 42 is still deleted (not ten deletions). `POST /users` ten times = ten new users created (not idempotent).
- **Safe:** Does not modify any state. `GET` is safe — it only reads. `DELETE` is not safe — it modifies.

### PUT vs PATCH (The Trap)
- **PUT** replaces the entire resource. If you `PUT /users/42` with `{"name": "John"}`, all other fields (email, age, etc.) are erased or set to defaults.
- **PATCH** partially updates. If you `PATCH /users/42` with `{"name": "John"}`, only the name changes. Everything else is preserved.

---

## 📊 4. HTTP Status Codes (The Complete Map)

### Success (2xx)
| Code | When To Use |
|---|---|
| `200 OK` | GET succeeded, PUT/PATCH succeeded and returning updated resource |
| `201 Created` | POST successfully created a resource. Include `Location` header with the new resource URL |
| `204 No Content` | DELETE succeeded. No response body needed |

### Client Errors (4xx)
| Code | When To Use |
|---|---|
| `400 Bad Request` | Malformed JSON, missing required fields, validation failure |
| `401 Unauthorized` | No authentication credentials provided (or invalid token) |
| `403 Forbidden` | Valid credentials, but insufficient permissions |
| `404 Not Found` | Resource doesn't exist |
| `405 Method Not Allowed` | Correct URL, wrong HTTP method (e.g., DELETE on a read-only resource) |
| `409 Conflict` | Duplicate resource (e.g., email already exists), optimistic lock conflict |
| `413 Payload Too Large` | Request body exceeds size limit |
| `422 Unprocessable Entity` | JSON is valid, but the data is semantically wrong (Pydantic validation error) |
| `429 Too Many Requests` | Rate limit exceeded. Include `Retry-After` header |

### Server Errors (5xx)
| Code | When To Use |
|---|---|
| `500 Internal Server Error` | Unhandled exception (bug). Never intentionally return this |
| `502 Bad Gateway` | Nginx/proxy couldn't reach the FastAPI backend |
| `503 Service Unavailable` | Server is overloaded or in maintenance. Include `Retry-After` header |
| `504 Gateway Timeout` | Backend took too long to respond |

---

## 🔎 5. Filtering, Sorting, Pagination, & Search

### Filtering (Query Parameters)
```
GET /orders?status=pending&user_id=42&min_total=100
```

### Sorting
```
GET /products?sort=price       → ascending by default
GET /products?sort=-price      → descending (prefix with -)
GET /products?sort=-price,name → sort by price desc, then name asc
```

### Pagination
**Offset-based (Simple but dangerous at scale):**
```
GET /users?page=1&page_size=50
```
Problem: `OFFSET 100000` forces Postgres to read 100,000 rows and discard them. O(N) performance.

**Cursor-based / Keyset (Production standard):**
```
GET /users?cursor=eyJpZCI6NDJ9&limit=50
```
The cursor is an opaque, base64-encoded token (usually the last item's ID or timestamp). The server decodes it and uses `WHERE id > 42 LIMIT 50` — which hits the B-Tree index directly. O(1) performance regardless of page depth.

### FastAPI Implementation: Cursor Pagination
```python
import base64
import json
from fastapi import FastAPI, Query

app = FastAPI()

@app.get("/users")
async def list_users(
    cursor: str | None = Query(None),
    limit: int = Query(50, le=100),  # Max 100 per page
):
    # Decode cursor
    last_id = 0
    if cursor:
        last_id = json.loads(base64.b64decode(cursor))["id"]

    # Keyset pagination — always hits the B-Tree index
    users = await db.fetch(
        "SELECT * FROM users WHERE id > $1 ORDER BY id LIMIT $2",
        last_id, limit
    )

    # Build next cursor
    next_cursor = None
    if len(users) == limit:
        next_cursor = base64.b64encode(
            json.dumps({"id": users[-1]["id"]}).encode()
        ).decode()

    return {
        "data": users,
        "next_cursor": next_cursor,
        "has_more": len(users) == limit,
    }
```

---

## 🏗️ 6. API Versioning Strategies

Your API WILL change. Old mobile apps that haven't updated must still work. You need versioning.

### Strategy 1: URL Path (Most Common)
```
GET /api/v1/users
GET /api/v2/users
```
**Pros:** Obvious, easy to route.
**Cons:** Splits codebase if not well-structured.

### Strategy 2: Header-Based
```
GET /api/users
Accept: application/vnd.myapi.v2+json
```
**Pros:** Clean URLs.
**Cons:** Harder to test (can't just paste a URL in a browser).

### Strategy 3: Query Parameter
```
GET /api/users?version=2
```
**Pros:** Simple.
**Cons:** Caching issues (URLs with different query params may not cache properly).

### FastAPI Implementation
```python
from fastapi import APIRouter

v1_router = APIRouter(prefix="/api/v1")
v2_router = APIRouter(prefix="/api/v2")

@v1_router.get("/users")
async def get_users_v1():
    return {"format": "legacy", "users": [...]}

@v2_router.get("/users")
async def get_users_v2():
    return {"data": [...], "meta": {"page": 1, "total": 100}}

app.include_router(v1_router)
app.include_router(v2_router)
```

---

## 🛡️ 7. Authentication & Authorization Patterns

### Authentication (Who are you?)

**JWT (JSON Web Token) — The Standard:**
```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

security = HTTPBearer()
SECRET_KEY = "your-secret-key"

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=["HS256"])
        return payload  # {"user_id": 42, "role": "admin", "exp": ...}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    return {"message": f"Welcome user {user['user_id']}"}
```

### Authorization (What can you do?)

**Role-Based Access Control (RBAC):**
```python
from functools import wraps

def require_role(*roles):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, user: dict = Depends(get_current_user), **kwargs):
            if user.get("role") not in roles:
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return await func(*args, user=user, **kwargs)
        return wrapper
    return decorator

@app.delete("/users/{user_id}")
@require_role("admin", "superadmin")
async def delete_user(user_id: int, user: dict = Depends(get_current_user)):
    await db.execute("DELETE FROM users WHERE id = $1", user_id)
    return {"status": "deleted"}
```

---

## 📦 8. Request/Response Design Standards

### Consistent Response Envelope
Every response should follow the same structure:
```json
{
    "data": { ... },
    "meta": {
        "page": 1,
        "total": 500,
        "next_cursor": "abc123"
    },
    "errors": null
}
```

### Error Response Structure
```json
{
    "data": null,
    "errors": [
        {
            "code": "VALIDATION_ERROR",
            "field": "email",
            "message": "Invalid email format"
        }
    ]
}
```

### FastAPI Global Exception Handler
```python
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "data": None,
            "errors": [{"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}]
        }
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "data": None,
            "errors": [{"code": "HTTP_ERROR", "message": exc.detail}]
        }
    )
```

---

## 🚦 9. Rate Limiting & Throttling

### FastAPI Middleware Implementation
```python
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from redis.asyncio import Redis

class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, redis: Redis, limit: int = 100, window: int = 60):
        super().__init__(app)
        self.redis = redis
        self.limit = limit
        self.window = window

    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host
        key = f"rate:{client_ip}"

        # Lua script makes INCR + EXPIRE atomic (fixes race condition)
        # Without this, INCR succeeds but EXPIRE fails = key lives forever
        rate_script = """
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return current
        """
        current = await self.redis.eval(rate_script, 1, key, self.window)

        if current > self.limit:
            return JSONResponse(
                status_code=429,
                content={"error": "Rate limit exceeded"},
                headers={
                    "Retry-After": str(self.window),
                    "X-RateLimit-Limit": str(self.limit),
                    "X-RateLimit-Remaining": "0",
                }
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(self.limit - current)
        return response
```

---

## 🔗 10. HATEOAS & Content Negotiation

### HATEOAS (Hypermedia as the Engine of Application State)
The purest form of REST — responses include links telling the client what actions are available next:
```json
{
    "data": {
        "id": 42,
        "name": "John",
        "status": "active"
    },
    "links": {
        "self": "/api/v1/users/42",
        "orders": "/api/v1/users/42/orders",
        "deactivate": "/api/v1/users/42/deactivate"
    }
}
```
In practice, most APIs skip HATEOAS because: (1) Frontend apps already know the available flows at compile time — they don't discover them dynamically from the response. (2) Including links in every response adds payload overhead — on mobile networks, every byte counts. (3) It couples the URL structure into the response body, making URL refactoring harder. But interviewers love asking about it because it's part of Fielding's original REST thesis.

### Content Negotiation
The client tells the server what format it wants via the `Accept` header:
```
Accept: application/json  → Server returns JSON
Accept: text/csv          → Server returns CSV
Accept: application/xml   → Server returns XML
```
FastAPI handles this natively by checking `request.headers["accept"]` and returning the appropriate `Response` class.

---

## 🎙️ Elite Interview Q&A

### QA 1: What is the difference between `401 Unauthorized` and `403 Forbidden`?
**The Senior Answer:**
"`401` means the server doesn't know who you are — you either didn't provide credentials or your token is invalid/expired. The correct client action is to re-authenticate (login again).
`403` means the server knows exactly who you are, but you don't have permission to access this resource. Re-authenticating won't help — you need a different role. Example: a regular user trying to access an admin endpoint."

***

### QA 2: You need to design an endpoint that triggers a long-running process (e.g., generating a PDF report that takes 2 minutes). How do you design this RESTfully?
**The Senior Answer:**
"I use the **Async Job Pattern:**
1. `POST /reports` → Accepts parameters, creates a job, publishes to RabbitMQ, returns `202 Accepted` with a job ID and a polling URL.
```json
{
    "job_id": "abc-123",
    "status": "processing",
    "poll_url": "/reports/abc-123/status"
}
```
2. The client polls `GET /reports/abc-123/status` periodically. While processing, it returns `200` with `status: processing`. When done, it returns `status: completed` with a `download_url`.
3. For a better UX, I implement WebSocket notifications so the client doesn't need to poll — the server pushes a 'job complete' event."

***

### QA 3: Should you use `PUT` or `PATCH` to update a user's email address?
**The Senior Answer:**
"`PATCH`. A `PUT` request semantically implies replacing the entire resource. If I send `PUT /users/42` with `{"email": "new@email.com"}`, a strictly RESTful server should set all other fields (name, age, etc.) to null or defaults — because the client declared 'this is the complete new state of the resource.'
`PATCH` explicitly means 'change only these specific fields.' It sends a partial representation: `{"email": "new@email.com"}`, and all other fields remain untouched.
In practice, many APIs (incorrectly) treat `PUT` as a partial update. But in an interview, I always distinguish them correctly."

***

### QA 4: How do you handle API versioning when a breaking change occurs?
**The Senior Answer:**
"First, I avoid breaking changes whenever possible. Adding new fields to a response is non-breaking. Adding new optional query parameters is non-breaking. Only removing or renaming fields is breaking.
When a breaking change is unavoidable, I use URL-path versioning (`/api/v1/users`, `/api/v2/users`). I keep v1 running for a deprecation period (typically 6-12 months), return a `Deprecation` header on v1 responses, and document the migration path in the changelog.
Internally, v1 and v2 share the same service layer — the difference is only in the serialization (response shape). I never duplicate business logic."

***

### QA 5: What is idempotency and why does it matter for `POST` requests?
**The Senior Answer:**
"`POST` is naturally non-idempotent — calling it twice creates two resources. In real networks, this is dangerous. If the client sends `POST /payments` and the network drops the response, the client doesn't know if it succeeded. It retries. Now the user is charged twice.
**The Fix:** The client generates a unique `Idempotency-Key` header (UUID) and includes it with every request. The server stores this key in Redis with the response. If the same key arrives again, the server returns the cached response without re-processing.
```python
@app.post("/payments")
async def create_payment(
    payment: PaymentCreate,
    idempotency_key: str = Header(...),
    redis: Redis = Depends(get_redis),
):
    # Check if already processed
    cached = await redis.get(f"idempotency:{idempotency_key}")
    if cached:
        return json.loads(cached)

    # Process payment
    result = await charge_stripe(payment)

    # Cache result for 24 hours
    await redis.set(f"idempotency:{idempotency_key}", json.dumps(result), ex=86400)
    return result
```

***

### QA 6: What headers should every production API response include?
**The Senior Answer:**
"Beyond standard headers, I always include:
- `X-Request-Id`: Unique trace ID for debugging across distributed services.
- `X-RateLimit-Limit`: Total requests allowed per window.
- `X-RateLimit-Remaining`: Requests remaining in current window.
- `Cache-Control`: `no-store` for authenticated endpoints, `max-age=300` for public data.
- `Content-Type`: `application/json; charset=utf-8` (always explicit).
- `Strict-Transport-Security`: Force HTTPS.
- `X-Content-Type-Options: nosniff`: Prevent MIME-type attacks.

In FastAPI, I implement these via a global middleware that injects them into every response."

***

### QA 7: A client sends `GET /users` and expects 100,000 results. How do you prevent the server from running out of memory?
**The Senior Answer:**
"I never return unbounded results. Every list endpoint has mandatory pagination with a maximum page size:
1. `limit` parameter with a hard cap (e.g., `max=100`). Pydantic validates this: `limit: int = Query(50, le=100)`.
2. Cursor-based pagination instead of offset — so the database query always uses an indexed `WHERE id > cursor LIMIT N`.
3. If the client genuinely needs all 100,000 records (e.g., data export), I use the async job pattern: `POST /exports` returns `202 Accepted`, a background worker streams the data to a CSV file on S3, and the client downloads the file via a pre-signed URL when ready."

***

### QA 8: REST vs GraphQL — when do you choose each?
**The Senior Answer:**
"REST is the right choice when:
- The data model is stable and well-defined.
- Caching is critical (REST URLs are trivially cacheable via CDN; GraphQL POST requests are not).
- The API is public-facing (REST is universally understood).

GraphQL is the right choice when:
- Multiple clients (web, mobile, TV) need drastically different subsets of the same data.
- The frontend is making many REST calls to compose a single view (N+1 HTTP requests).
- Over-fetching is a major performance problem (REST returns the entire user object when the client only needs the name).

In practice, I often use REST for public APIs and GraphQL for internal frontend-to-backend communication."

***

### QA 9: What is the difference between query parameters and path parameters?
**The Senior Answer:**
"**Path parameters** identify a specific resource: `/users/42` — the `42` is the resource identity. Without it, the URL points to a different resource (the collection).
**Query parameters** filter, sort, or modify the representation of a resource: `/users?status=active&sort=-created_at`. The base resource (`/users`) is the same regardless of query parameters.
Rule of thumb: if removing the parameter changes WHAT resource you're accessing, it's a path parameter. If it changes HOW the resource is presented, it's a query parameter."

***

### QA 10: How do you design an API for a bulk operation (e.g., delete 500 users at once)?
**The Senior Answer:**
"There are two patterns:
1. **Batch endpoint:** `DELETE /users/batch` with a request body `{"ids": [1, 2, 3, ..., 500]}`. The server returns a detailed response showing which succeeded and which failed:
```json
{
    "deleted": [1, 2, 3],
    "failed": [{"id": 4, "reason": "Not found"}, {"id": 5, "reason": "Permission denied"}]
}
```
2. **Async job for very large batches:** `POST /users/bulk-delete` returns `202 Accepted` with a job ID. The actual deletion happens in a background worker.

I never implement bulk operations as 500 individual `DELETE /users/{id}` calls from the client — that's 500 HTTP round-trips and 500 database transactions instead of 1."

***

### QA 11: What does 'stateless' actually mean in REST, and how do you handle authentication without sessions?
**The Senior Answer:**
"Stateless means the server stores no per-client session between requests at the HTTP interaction layer. Every request carries its own credentials. The server doesn't remember your previous request — it validates your token fresh every time. (Note: the overall *system* still has state in databases and caches; statelessness applies to the request-processing layer.)
Authentication is handled by sending a **JWT** in the `Authorization: Bearer <token>` header with every request. The JWT contains the user's identity and permissions as a cryptographically signed payload.
**The Revocation Problem:** JWTs can't be easily revoked — they're valid until they expire. There are three strategies:
1. **Redis Blocklist:** Store revoked token IDs in Redis. Check on every request. Trade-off: adds ~1ms latency per request, and defeats the 'stateless' advantage since you're now hitting a shared store.
2. **Short-lived Access Tokens + Refresh Tokens (Preferred):** Issue access tokens with a 15-minute TTL. Issue a long-lived refresh token (stored in HttpOnly cookie). When the access token expires, the client silently hits `/auth/refresh` to get a new one. To revoke, you invalidate the refresh token in the database — the access token dies naturally in ≤15 minutes.
3. **Token Rotation:** Every refresh request issues a new refresh token and invalidates the old one. If a stolen refresh token is reused, the server detects the anomaly (token was already rotated) and revokes the entire chain."

---

## 🏷️ 11. ETags & Conditional Requests (Core REST Optimization)

### The Problem
Your client fetches `GET /users/42` and gets a 50KB JSON response. 10 seconds later, it fetches the same endpoint again. The data hasn't changed. You just wasted 50KB of bandwidth and forced the server to re-query the database for nothing.

### The Fix: ETag + `If-None-Match`
```
# First request
GET /users/42
→ 200 OK
→ ETag: "abc123-hash-of-response-body"
→ Body: { "id": 42, "name": "John", ... }

# Second request (client sends the ETag back)
GET /users/42
If-None-Match: "abc123-hash-of-response-body"
→ 304 Not Modified (no body — saves bandwidth)
→ Client uses its locally cached copy
```

### FastAPI Implementation
```python
import hashlib
from fastapi import Request
from fastapi.responses import JSONResponse, Response

@app.get("/users/{user_id}")
async def get_user(user_id: int, request: Request):
    user = await fetch_user_from_db(user_id)
    body = json.dumps(user)

    # Generate ETag from response content
    etag = hashlib.md5(body.encode()).hexdigest()

    # Check if client already has this version
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)  # Not Modified — zero body

    response = JSONResponse(content=user)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "private, max-age=60"
    return response
```

### `If-Modified-Since` (Time-Based Alternative)
Instead of hashing the body, the server returns `Last-Modified: Tue, 01 Apr 2025 10:00:00 GMT`. The client sends `If-Modified-Since` on the next request. If the resource hasn't changed, the server returns `304`.

---

## 🔀 12. PUT vs PATCH: Spec vs Reality

### What the Spec Says
- **PUT:** Replace the entire resource. Missing fields are set to null/default.
- **PATCH:** Partial update. Only the provided fields change.

### What the Real World Does
Most APIs (Stripe, GitHub, Twilio) treat PUT as a partial update — they don't null out missing fields. This is technically a spec violation, but it's the industry norm.

### The Senior Interview Answer
"The HTTP spec defines PUT as a full replacement and PATCH as a partial update. In an interview, I always distinguish them correctly. In practice, most production APIs treat PUT as partial because clients rarely send the complete resource representation. The important thing is consistency — pick a convention and document it. If I'm building a greenfield API, I follow the spec: PUT replaces, PATCH updates partially."

---

## 📊 13. Partial Failure: `200` vs `207 Multi-Status`

When a bulk operation partially succeeds, what status code do you return?

### The Options
| Approach | Status Code | When |
|---|---|---|
| All succeeded | `200 OK` | Every item in the batch was processed |
| All failed | `400 Bad Request` or `422` | Every item in the batch failed validation |
| Mixed results | `207 Multi-Status` | Some items succeeded, some failed |

### 207 Multi-Status Response
```json
{
    "results": [
        {"id": 1, "status": 200, "message": "Deleted"},
        {"id": 2, "status": 200, "message": "Deleted"},
        {"id": 3, "status": 404, "message": "Not found"},
        {"id": 4, "status": 403, "message": "Permission denied"}
    ]
}
```

### The Trade-off
`207` is the technically correct answer (it's defined in WebDAV but widely adopted). However, many API clients don't handle `207` gracefully — they only check top-level status codes. A pragmatic alternative is to return `200` with a response body that contains per-item success/failure details. The key is that the client must always inspect the response body for bulk operations, never just the HTTP status code.

---

## 🔑 14. Idempotency Storage Strategy (Deep Dive)

### Beyond the Basic Pattern
Storing idempotency results in Redis is correct, but incomplete for production:

### Key Design Decisions

**1. TTL Per Endpoint Type:**
```python
IDEMPOTENCY_TTLS = {
    "payments": 86400,    # 24 hours — financial transactions need long dedup windows
    "emails": 3600,       # 1 hour — email sends are unlikely to be retried after 1h
    "analytics": 300,     # 5 minutes — low-risk, high-volume
}
```

**2. What To Store:**
Store the full response (status code + body), not just a boolean flag. If the client retries, they must receive the exact same response as the original:
```python
cached = {
    "status_code": 201,
    "body": {"id": 42, "amount": 99.99},
    "created_at": "2025-01-01T00:00:00Z"
}
await redis.set(f"idempotency:{key}", json.dumps(cached), ex=ttl)
```

**3. Memory Pressure:**
High-volume APIs can generate millions of idempotency keys. Use `maxmemory-policy volatile-ttl` in Redis so that idempotency keys (all of which have TTLs) are the first to be evicted under memory pressure. Critical payment keys should have longer TTLs and be stored in a separate Redis instance with higher memory limits.

**4. Scope:**
An idempotency key should be scoped per-user AND per-endpoint. `user:42:POST:/payments:{uuid}` prevents cross-user and cross-endpoint collisions.

---

## 📅 15. Backward Compatibility & Deprecation Headers

### Non-Breaking Changes (Safe)
- Adding a new field to a response
- Adding a new optional query parameter
- Adding a new endpoint

### Breaking Changes (Require New Version)
- Removing or renaming a response field
- Changing a field's data type
- Making an optional parameter required
- Changing URL structure

### Standard Deprecation Headers
```
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sat, 01 Jan 2026 00:00:00 GMT
Link: <https://api.example.com/docs/migration-v2>; rel="successor-version"
```
- `Deprecation: true` — This endpoint is deprecated.
- `Sunset` — The date when this endpoint will stop working.
- `Link` — Points to migration documentation.

### FastAPI Implementation
```python
@app.get("/api/v1/users", deprecated=True)  # Shows as deprecated in Swagger docs
async def get_users_v1():
    response = JSONResponse(content={"users": [...]})
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = "Sat, 01 Jan 2026 00:00:00 GMT"
    response.headers["Link"] = '<https://api.example.com/api/v2/users>; rel="successor-version"'
    return response
```

---

## ⚔️ 16. REST vs GraphQL: The Real Trade-Offs

| Dimension | REST | GraphQL |
|---|---|---|
| **Caching** | Trivial — URL-based, CDN-friendly | Complex — POST requests can't be CDN-cached natively |
| **Over-fetching** | Returns full resource every time | Client specifies exact fields needed |
| **Under-fetching** | May need multiple calls to compose a view | Single query gets everything |
| **N+1 DB Problem** | In API layer (ORM issue) | In GraphQL resolver layer — even worse if not using DataLoader |
| **Versioning** | URL-based (`/v1/`, `/v2/`) | Schema evolution — add fields, deprecate with `@deprecated` |
| **Error handling** | HTTP status codes (`404`, `500`) | Always returns `200` — errors are in the response body |
| **Tooling** | Universal — every HTTP client works | Requires GraphQL-specific clients (Apollo, Relay) |
| **Schema coupling** | Loose — client and server evolve independently | Tight — schema is the contract, frontend depends on it |
| **File uploads** | Native multipart support | Requires multipart spec extension (non-trivial) |
| **Real-time** | WebSockets (separate protocol) | Subscriptions (built into the spec) |

### The One-Liner
"REST is the right default. GraphQL solves specific problems (multiple clients needing different data shapes, mobile bandwidth optimization). But GraphQL introduces its own complexity — N+1 resolver problems, no native caching, and the entire query surface area is exposed to the client, creating security concerns (query depth/cost attacks). I don't adopt GraphQL unless the data-fetching problem is genuinely painful."

---

## 🎙️ Elite QA Extensions (Staff-Level)

### QA 12: Your bulk delete endpoint receives 500 IDs. 490 are deleted successfully, but 10 don't exist. Should the response be `200`, `404`, or something else?
**The Senior Answer:**
"Neither `200` nor `404`. The correct status code is `207 Multi-Status`. Returning `200` implies everything succeeded (misleading). Returning `404` implies everything failed (wrong). `207` communicates partial success explicitly. The response body must contain per-item results so the client knows exactly which IDs failed and why.
Pragmatically, if my API clients don't handle `207` well, I return `200` with a structured body containing `deleted: [...]` and `failed: [...]` arrays. The key rule is: bulk endpoints must ALWAYS return per-item status, regardless of the top-level HTTP code."

***

### QA 13: An interviewer asks: "Your rate limiter uses INCR + EXPIRE in Redis. What's the race condition?"
**The Senior Answer:**
"If `INCR` succeeds (creating the key with value 1) but the server crashes before `EXPIRE` executes, the key exists without a TTL. It persists forever, and the user is permanently rate-limited. Even without a crash, under high concurrency, another request can slip between `INCR` and `EXPIRE`, seeing `current == 1` and also trying to set the expiry.
**The Fix:** Make it atomic with a Lua script: `local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return c`. The Lua script executes atomically — no interleaving possible."

***

### QA 14: How does ETag-based caching actually reduce server load? The server still has to query the database to generate the ETag, right?
**The Senior Answer:**
"You're right that a naive implementation still hits the database. The real optimization comes in layers:
1. **Bandwidth savings:** Even if the server queries the DB, returning `304 Not Modified` with no body saves significant bandwidth — critical for mobile clients on slow networks.
2. **Cheap ETag sources:** Instead of hashing the response body (which requires building it), I derive the ETag from the row's `updated_at` timestamp: `ETag: hash(updated_at)`. A single indexed column lookup is much cheaper than fetching and serializing the entire resource.
3. **CDN/Proxy caching:** Reverse proxies (Nginx, Cloudflare) cache responses keyed by URL + ETag. When the ETag matches, the proxy returns the cached response without ever hitting the application server."

***

### QA 15: What is the difference between `Content-Type` and `Accept` headers?
**The Senior Answer:**
"`Content-Type` tells the **receiver** what format the body is in. It's set by whoever is sending the body:
- On a **request**, the client sets `Content-Type: application/json` to tell the server 'I'm sending JSON.'
- On a **response**, the server sets `Content-Type: application/json` to tell the client 'I'm returning JSON.'

`Accept` is set only by the **client on the request** to tell the server what format it *wants* the response in: `Accept: application/json` means 'please respond with JSON.' If the server can't produce that format, it returns `406 Not Acceptable`."
