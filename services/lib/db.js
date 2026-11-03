const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Ghi event_id đã xử lý; trả về false nếu event này đã được xử lý trước đó.
async function claimEvent(client, eventId) {
  const { rowCount } = await client.query(
    "INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [eventId]
  );
  return rowCount === 1;
}

module.exports = { pool, withTransaction, claimEvent };
