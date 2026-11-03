// Đọc các event chưa gửi trong outbox, publish lên exchange user.events,
// chỉ đánh dấu đã gửi khi RabbitMQ xác nhận (publisher confirm).
// RabbitMQ dừng → relay thoát, Docker khởi động lại, event vẫn nằm chờ trong outbox.
const { pool } = require("./lib/db");
const { EXCHANGE, connect, sleep } = require("./lib/rabbit");

const POLL_MS = 500;

async function unsentOutbox() {
  const { rows } = await pool.query(
    "SELECT id, routing_key, payload FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 50"
  );
  return rows;
}

async function markSent(id) {
  await pool.query("UPDATE outbox SET sent_at = now() WHERE id = $1", [id]);
}

async function main() {
  const { channel } = await connect({ confirm: true });
  console.log("outbox-relay started");
  for (;;) {
    const rows = await unsentOutbox();
    for (const row of rows) {
      channel.publish(EXCHANGE, row.routing_key, Buffer.from(JSON.stringify(row.payload)), {
        persistent: true,
        messageId: row.payload.id,
        type: row.payload.type,
        contentType: "application/json",
      });
      await channel.waitForConfirms();
      await markSent(row.id);
      console.log(`published ${row.payload.type} (${row.routing_key}) event ${row.payload.id}`);
    }
    if (!rows.length) await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
