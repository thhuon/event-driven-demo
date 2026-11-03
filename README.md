# User App — Event-Driven Architecture

The same features as the original User App (a registration form plus a list to edit / delete users), with one new requirement: after every registration the system must also **send a welcome email**, **write an audit log** and **update statistics**. Instead of having the backend call these three tasks one after another, `user-service` only **publishes events** (`UserRegistered`, `UserUpdated`, `UserDeleted`). The consumers subscribe through **RabbitMQ** and react on their own.

```text
                  PRODUCER                          EVENT DISTRIBUTOR                  CONSUMERS
frontend (:8083) ──REST──> user-service (:4003)      RabbitMQ (:5672, UI :15672)
                              │ 1 transaction        ┌──────────────────────┐
                              ▼                      │ exchange user.events │──> q.email ──> email-service ──> Mailpit (:8025)
                    PostgreSQL: users + outbox       │ (topic)              │──> q.audit ──> audit-service ──> auditdb (GET :4005/audit)
                              │                      └──────────────────────┘──> q.stats ──> stats-service ──> statsdb (GET :4004/stats)
                              ▼                                ▲                     │
                        outbox-relay ── publish ───────────────┘          q.email fails more than 3 times ──> q.email.dlq
```

| Component | File | Role |
|---|---|---|
| user-service | [services/user-service.js](services/user-service.js) | CRUD REST API. Every change writes `users` and one `outbox` row in the **same transaction** |
| outbox-relay | [services/outbox-relay.js](services/outbox-relay.js) | Reads unsent outbox rows, publishes them to `user.events`, and marks a row as sent only after RabbitMQ confirms it (publisher confirms) |
| email-service | [services/email-service.js](services/email-service.js) | Listens to `user.registered` and sends an email through Mailpit. Acks after sending, skips events it has already processed, retries 3 times and then dead-letters |
| audit-service | [services/audit-service.js](services/audit-service.js) | Listens to `user.#` and writes `audit_log`. `GET /audit` returns the 50 latest rows |
| stats-service | [services/stats-service.js](services/stats-service.js) | Listens to `user.registered` and `user.deleted` and counts users by gender. `GET /stats`. Only starts when named explicitly (profile `extra`) |
| Database | [db/init.sql](db/init.sql) | One Postgres instance, one database per service: `userdb`, `emaildb`, `auditdb`, `statsdb` |
| UI | [frontend/](frontend/) | Same as the original User App, plus links to Mailpit, RabbitMQ, Audit and Stats |

## Events

| Action | Event | Routing key | Interested consumers |
|---|---|---|---|
| Register | `UserRegistered` | `user.registered` | email, audit, stats |
| Edit | `UserUpdated` (only when a field actually changes) | `user.updated` | audit |
| Delete | `UserDeleted` | `user.deleted` | audit, stats |

All events share one envelope:

```json
{
  "id": "b5b1f4c3-8626-46f9-95db-b7d4883e456a",
  "type": "UserRegistered",
  "source": "user-service",
  "time": "2026-11-03T16:08:12.431Z",
  "data": { "id": 1, "full_name": "Nguyễn Văn A", "email": "a@example.com", "gender": "male", "...": "..." }
}
```

Each event carries the full user data (event-carried state transfer), so consumers never have to call back into user-service.

## Running

```bash
docker compose up -d --build
```

| Address | Purpose |
|---|---|
| http://localhost:8083 | User App UI |
| http://localhost:15672 | RabbitMQ Management (`guest` / `guest`): exchanges, queues, message counts |
| http://localhost:8025 | Mailpit: inbox for the welcome emails |
| http://localhost:4005/audit | Audit log |
| http://localhost:4004/stats | Statistics (after starting stats-service) |
| `localhost:5436` | Postgres (`app` / `app`) |

Stop: `docker compose --profile extra down` (add `-v` to also delete all data).

## Demo script

1. **Start up**: `docker compose up -d --build`. Open the UI, RabbitMQ Management (*Queues* tab: `q.email`, `q.audit`, `q.email.dlq`) and Mailpit.
2. **Fan-out**: Register one user in the form. Mailpit receives a welcome email and http://localhost:4005/audit shows one new row. One event, two consumers reacting independently.
3. **Temporal decoupling**:
   ```bash
   docker compose stop email-service
   # register 3 more users: the form still succeeds, q.email in the RabbitMQ UI holds 3 messages
   docker compose start email-service
   # the 3 emails are sent, q.email drops back to 0
   ```
4. **Add a consumer without touching the producer**:
   ```bash
   docker compose up -d stats-service
   # register a new user, then open http://localhost:4004/stats
   ```
   RabbitMQ only delivers new events, so stats start counting from the moment stats-service is running.
5. **Scale a consumer**:
   ```bash
   docker compose up -d --scale email-service=3
   ./scripts/register-many.sh 20
   docker compose logs email-service | grep "đã gửi"
   # every log line starts with the instance hostname: the 20 emails are split across 3 instances
   ```
6. **Dead Letter Queue**: Register with the email `fail@example.com` (email-service simulates a mail server that always rejects this address).
   ```bash
   docker compose logs -f email-service
   # retry 1/3, 2/3, 3/3 → moved to q.email.dlq
   ```
   In the RabbitMQ UI, `q.email.dlq` holds 1 message while other emails keep flowing.

Extra (if asked):

- **No duplicate processing**: Make the relay publish an old event again; consumers skip it because its `event.id` is already recorded.
  ```bash
  docker compose exec db psql -U app -d userdb -c "UPDATE outbox SET sent_at = NULL WHERE id = 1"
  docker compose logs --since 10s email-service audit-service   # "đã xử lý → bỏ qua" (already processed → skipped)
  ```
- **No lost events while RabbitMQ is down**:
  ```bash
  docker compose stop rabbitmq
  # register a user: still 201, the event waits in the outbox
  docker compose exec db psql -U app -d userdb -c "SELECT id, routing_key, sent_at FROM outbox ORDER BY id DESC LIMIT 3"
  docker compose start rabbitmq
  # the relay reconnects and publishes the pending event, the email is sent
  ```

Log messages and UI text are in Vietnamese, the language of the course this demo was built for.

## Design notes

- **Transactional Outbox**: Writing to the database and then publishing means a crash between the two steps loses the event. Writing `users` and `outbox` in one transaction guarantees that every user has its event; the relay publishes it later.
- **At-least-once + idempotent consumers**: Consumers ack *after* processing, so a crash midway makes RabbitMQ redeliver. Each consumer stores `event.id` in a `processed_events` table in its own database and skips redeliveries. audit-service and stats-service write `processed_events` in the same transaction as their data. email-service cannot put an SMTP send inside a transaction, so a small window remains (crash after sending, before recording the id) that can cause a duplicate email.
- **Retry + DLQ**: email-service republishes a failed message to `q.email` with an `x-retries` header; after 3 retries it `nack`s without requeue, and RabbitMQ routes the message through `user.events.dlx` into `q.email.dlq`.
- **One database per consumer**: Consumers never read user-service's database; everything they need is in the event.
- **This is not Event Sourcing**: The source of truth is still the `users` table (overwritten on update / delete). The outbox is only a temporary queue before publishing; deleting it loses no user data. Events are used to *notify* other services, not to *store* state.
- **Not implemented**: Running several outbox relays (would need `FOR UPDATE SKIP LOCKED`), cleaning up sent outbox rows, tracing / correlation IDs, TLS and dedicated RabbitMQ credentials.
