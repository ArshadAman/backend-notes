# 🚀 Backend Notes — Senior Engineer Reference

> A curated collection of backend engineering notes covering architecture, databases, messaging, security, and more — targeted at mid-to-senior backend roles.

---

## 📖 Table of Contents

| Topic | File | Description |
|---|---|---|
| ⚔️ Technology Battlefield | [battlefield.md](battlefield.md) | Why each technology was chosen — trade-offs, not opinions |
| 🧱 Database Scaling | [db_scaling.md](db_scaling.md) | Replicas, sharding, routing, and consequences of replication lag |
| 🐳 Docker | [docker.md](docker.md) | Linux kernel internals, image optimisation, and container pitfalls |
| 🔍 Elasticsearch | [elasticsearch.md](elasticsearch.md) | Inverted index, JVM heap tuning, and full-text search architecture |
| ⚡ FastAPI & Concurrency | [fastapi.md](fastapi.md) | Async Python, the event loop, and avoiding blocking-call disasters |
| 🛡️ Fault Tolerance | [fault_tollerance.md](fault_tollerance.md) | Circuit breakers, retries, and keeping systems alive when everything fails |
| 🌐 Nginx | [nginx.md](nginx.md) | Reverse proxy configuration, connection limits, and performance tuning |
| 🐘 PostgreSQL | [postgres.md](postgres.md) | Query planning, indexing, concurrency, and transactional correctness |
| 🐍 Python | [python.md](python.md) | CPython memory model, MRO, GIL, and common language-level footguns |
| 🐇 RabbitMQ | [rabbitmq.md](rabbitmq.md) | Message durability, service decoupling, and guaranteed delivery patterns |
| 🔴 Redis | [redis.md](redis.md) | Caching, distributed locks, rate limiting, pub/sub, and failure modes |
| 🌐 REST API Design | [rest_design.md](rest_design.md) | REST constraints, versioning, security, and designing for scale |
| 🔐 Security | [security.md](security.md) | OWASP top risks, secure coding practices, and threat modelling |

---

## ⚠️ Important Disclaimers

Before using any material in this repository, please read the following:

1. **AI-Generated Content**
   This repository is generated with AI assistance and verified manually, but may still contain inaccuracies or outdated information.

2. **Not Production-Ready by Default**
   The examples and architectures are for learning purposes and must be adapted for real-world constraints.

3. **Performance Numbers Are Contextual**
   Benchmarks depend on workload, hardware, and implementation details.

4. **Avoid Over-Engineering**
   Do not introduce complex systems unless the scale justifies them.

5. **Backend-Focused Scope**
   This guide focuses on backend architecture and does not fully cover frontend, DevOps, or cloud infrastructure.

6. **Simplified Examples**
   Code snippets may omit retries, logging, monitoring, and edge-case handling.

7. **Security Is Simplified**
   Real-world security requires deeper practices like audits and threat modeling.

8. **Technology Trade-offs Change**
   Re-evaluate decisions as tools and ecosystems evolve.

9. **Language-Agnostic Principles**
   Concepts apply across languages and frameworks beyond FastAPI.

10. **Focus on Understanding, Not Memorization**
    Learn the reasoning behind decisions, not just the tools.

---

## 🎯 Who Is This For?

This repository is designed for engineers aiming for **mid-to-senior backend roles** (targeting $20k+ USD remote positions). Each note dives deeper than a tutorial — it explains the *why* behind architectural decisions and covers the failure modes that separate senior engineers from juniors.

---

## 📌 How to Use

- Read each file independently based on the topic you are preparing for.
- Focus on understanding trade-offs, not memorising commands or syntax.
- Cross-reference related topics (e.g., Redis + PostgreSQL + RabbitMQ) to see how they interact in a real architecture.
- Re-read periodically — your understanding will deepen with practical experience.

---

## 🤝 Contributing

Found an inaccuracy or want to add a missing topic? Open an issue or pull request. All contributions should follow the spirit of this repository: depth over breadth, trade-offs over opinions, understanding over memorisation.
