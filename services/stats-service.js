// CONSUMER thêm sau: thống kê số user theo giới tính.
// Chỉ cần đăng ký queue với exchange, user-service không phải sửa gì.
// RabbitMQ chỉ giao event mới, nên thống kê bắt đầu đếm từ lúc service này chạy.
const express = require("express");
const { pool, withTransaction, claimEvent } = require("./lib/db");
const { EXCHANGE, connect } = require("./lib/rabbit");

const QUEUE = "q.stats";
const DELTA = { UserRegistered: 1, UserDeleted: -1 };

async function apply(event) {
  return withTransaction(async (client) => {
    if (!(await claimEvent(client, event.id))) return false;
    const gender = event.data.gender || "unknown";
    await client.query(
      `INSERT INTO user_stats (gender, total) VALUES ($1, GREATEST($2, 0))
       ON CONFLICT (gender) DO UPDATE SET total = GREATEST(user_stats.total + $2, 0)`,
      [gender, DELTA[event.type]]
    );
    return true;
  });
}

async function main() {
  const { channel } = await connect();
  await channel.assertQueue("q.stats", { durable: true });
  await channel.bindQueue("q.stats", "user.events", "user.registered");
  await channel.bindQueue("q.stats", "user.events", "user.deleted");
  await channel.prefetch(10);

  channel.consume(QUEUE, async (msg) => {
    const event = JSON.parse(msg.content);
    try {
      const applied = await apply(event);
      console.log(applied ? `stats: ${event.type} (${event.data.gender || "unknown"})` : `stats: event ${event.id} đã có → bỏ qua`);
      channel.ack(msg);
    } catch (err) {
      console.error(err);
      channel.nack(msg, false, true);
    }
  });
  console.log(`stats-service listening on ${QUEUE} (exchange ${EXCHANGE})`);
}

const app = express();
app.get("/stats", async (req, res) => {
  const { rows } = await pool.query("SELECT gender, total FROM user_stats ORDER BY gender");
  const byGender = Object.fromEntries(rows.map((r) => [r.gender, r.total]));
  res.json({ total: rows.reduce((s, r) => s + r.total, 0), by_gender: byGender });
});
app.listen(process.env.PORT || 4000, () => console.log("stats-service HTTP on :4000 (GET /stats)"));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
