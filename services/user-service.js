// PRODUCER: CRUD như user-app, nhưng mỗi thay đổi ghi thêm 1 event vào outbox
// trong CÙNG transaction. user-service không biết consumer nào tồn tại.
const express = require("express");
const cors = require("cors");
const { pool, withTransaction } = require("./lib/db");
const { envelope } = require("./lib/events");

const app = express();
app.use(cors());
app.use(express.json());

const FIELDS = ["full_name", "email", "phone", "dob", "gender", "address"];
const COLUMNS = "id, full_name, email, phone, to_char(dob, 'YYYY-MM-DD') AS dob, gender, address";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body) {
  const errors = [];
  if (!body.full_name || !body.full_name.trim()) errors.push("Full name là bắt buộc");
  if (!body.email || !EMAIL_RE.test(body.email)) errors.push("Email không hợp lệ");
  return errors;
}

// Empty strings from the form become NULL in the DB.
function values(body) {
  return FIELDS.map((f) => (body[f] === "" || body[f] === undefined ? null : body[f]));
}

function handleDbError(err, res) {
  if (err.code === "23505") return res.status(409).json({ errors: ["Email đã tồn tại"] });
  console.error(err);
  res.status(500).json({ errors: ["Lỗi server"] });
}

async function addToOutbox(client, routingKey, type, data) {
  const event = envelope(type, data);
  await client.query("INSERT INTO outbox (routing_key, payload) VALUES ($1, $2)", [routingKey, event]);
  return event;
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/users", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM users ORDER BY id DESC`);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res);
  }
});

app.get("/api/users/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ errors: ["Không tìm thấy"] });
    res.json(rows[0]);
  } catch (err) {
    handleDbError(err, res);
  }
});

app.post("/api/users", async (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  try {
    const { user, event } = await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        `INSERT INTO users (full_name, email, phone, dob, gender, address)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLUMNS}`,
        values(req.body)
      );
      const event = await addToOutbox(client, "user.registered", "UserRegistered", user);
      return { user, event };
    });
    console.log(`UserRegistered #${user.id} → outbox (event ${event.id})`);
    res.status(201).json(user);
  } catch (err) {
    handleDbError(err, res);
  }
});

app.put("/api/users/:id", async (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  try {
    const user = await withTransaction(async (client) => {
      const { rows: [before] } = await client.query(
        `SELECT ${COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      if (!before) return null;
      const { rows: [after] } = await client.query(
        `UPDATE users SET full_name=$1, email=$2, phone=$3, dob=$4, gender=$5, address=$6, updated_at=now()
         WHERE id=$7 RETURNING ${COLUMNS}`,
        [...values(req.body), req.params.id]
      );
      const changes = {};
      for (const f of FIELDS) {
        if (before[f] !== after[f]) changes[f] = { from: before[f], to: after[f] };
      }
      // Không có gì thay đổi thì cũng không có event nào xảy ra
      if (Object.keys(changes).length) {
        await addToOutbox(client, "user.updated", "UserUpdated", { id: after.id, changes });
      }
      return after;
    });
    if (!user) return res.status(404).json({ errors: ["Không tìm thấy"] });
    res.json(user);
  } catch (err) {
    handleDbError(err, res);
  }
});

app.delete("/api/users/:id", async (req, res) => {
  try {
    const deleted = await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        `DELETE FROM users WHERE id = $1 RETURNING ${COLUMNS}`,
        [req.params.id]
      );
      if (user) await addToOutbox(client, "user.deleted", "UserDeleted", user);
      return user;
    });
    if (!deleted) return res.status(404).json({ errors: ["Không tìm thấy"] });
    res.status(204).end();
  } catch (err) {
    handleDbError(err, res);
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`user-service listening on :${port}`));
