// CONSUMER: gửi email chào mừng khi có UserRegistered.
// Ack SAU khi gửi; kiểm tra event.id để không gửi trùng; lỗi thì thử lại 3 lần rồi vào DLQ.
const os = require("os");
const nodemailer = require("nodemailer");
const { pool } = require("./lib/db");
const { EXCHANGE, DLX, connect, sleep } = require("./lib/rabbit");

const QUEUE = "q.email";
const DLQ = "q.email.dlq";
const MAX_RETRIES = 3;
const DELAY_MS = Number(process.env.EMAIL_DELAY_MS || 0);
const instance = os.hostname();

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
});

async function alreadyProcessed(eventId) {
  const { rowCount } = await pool.query("SELECT 1 FROM processed_events WHERE event_id = $1", [eventId]);
  return rowCount > 0;
}

async function markProcessed(eventId) {
  await pool.query("INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
}

async function sendWelcomeEmail(user) {
  await sleep(DELAY_MS);
  // Giả lập mail server luôn từ chối một địa chỉ (poison message)
  if (user.email.includes("fail@")) throw new Error(`Mail server từ chối địa chỉ ${user.email}`);
  await mailer.sendMail({
    from: "User App <no-reply@user-app.local>",
    to: user.email,
    subject: `Chào mừng ${user.full_name}!`,
    text: `Xin chào ${user.full_name},\n\nTài khoản #${user.id} của bạn đã được tạo thành công.\n\n— User App`,
  });
}

async function main() {
  const { channel } = await connect();

  await channel.assertExchange(DLX, "direct", { durable: true });
  await channel.assertQueue(DLQ, { durable: true });
  await channel.bindQueue(DLQ, DLX, QUEUE);
  await channel.assertQueue(QUEUE, { durable: true, deadLetterExchange: DLX, deadLetterRoutingKey: QUEUE });
  await channel.bindQueue(QUEUE, EXCHANGE, "user.registered");
  await channel.prefetch(1);

  function retryOrDeadLetter(msg, err) {
    const retries = msg.properties.headers?.["x-retries"] ?? 0;
    if (retries >= MAX_RETRIES) {
      console.error(`[${instance}] ${err.message} → hết ${MAX_RETRIES} lần thử, chuyển sang ${DLQ}`);
      return channel.nack(msg, false, false);
    }
    console.warn(`[${instance}] ${err.message} → thử lại lần ${retries + 1}/${MAX_RETRIES}`);
    setTimeout(() => {
      channel.sendToQueue(QUEUE, msg.content, {
        ...msg.properties,
        persistent: true,
        headers: { ...msg.properties.headers, "x-retries": retries + 1 },
      });
      channel.ack(msg);
    }, 1000);
  }

  channel.consume(QUEUE, async (msg) => {
    const event = JSON.parse(msg.content);
    if (await alreadyProcessed(event.id)) {
      console.log(`[${instance}] event ${event.id} đã xử lý → bỏ qua`);
      return channel.ack(msg);
    }
    try {
      await sendWelcomeEmail(event.data);
      await markProcessed(event.id);
      channel.ack(msg);
      console.log(`[${instance}] đã gửi email chào mừng tới ${event.data.email} (event ${event.id})`);
    } catch (err) {
      retryOrDeadLetter(msg, err);
    }
  });
  console.log(`[${instance}] email-service listening on ${QUEUE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
