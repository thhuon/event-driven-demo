// CONSUMER: ghi lịch sử mọi thay đổi (user.#) vào auditdb.
// Ghi audit_log và processed_events trong cùng transaction nên xử lý lại không tạo dòng trùng.
const express = require("express");
const { pool, withTransaction, claimEvent } = require("./lib/db");
const { EXCHANGE, connect } = require("./lib/rabbit");

const QUEUE = "q.audit";

async function record(event) {
  return withTransaction(async (client) => {
    if (!(await claimEvent(client, event.id))) return false;
    await client.query(
      `INSERT INTO audit_log (event_id, event_type, user_id, data, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [event.id, event.type, event.data.id, event.data, event.time]
    );
    return true;
  });
}

async function main() {
  const { channel } = await connect();
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, "user.#");
  await channel.prefetch(10);

  channel.consume(QUEUE, async (msg) => {
    const event = JSON.parse(msg.content);
    try {
      const recorded = await record(event);
      console.log(recorded ? `audit: ${event.type} user #${event.data.id}` : `audit: event ${event.id} đã có → bỏ qua`);
      channel.ack(msg);
    } catch (err) {
      console.error(err);
      channel.nack(msg, false, true);
    }
  });
  console.log(`audit-service listening on ${QUEUE}`);
}

const app = express();
app.get("/audit", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, event_type, user_id, data, occurred_at, recorded_at FROM audit_log ORDER BY id DESC LIMIT 50"
  );
  res.json(rows);
});
app.listen(process.env.PORT || 4000, () => console.log("audit-service HTTP on :4000 (GET /audit)"));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
