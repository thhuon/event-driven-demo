const amqp = require("amqplib");

const EXCHANGE = "user.events";
const DLX = "user.events.dlx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kết nối RabbitMQ (thử lại tới khi được) và khai báo exchange chung.
// Mất kết nối thì thoát để Docker khởi động lại service.
async function connect({ confirm = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await amqp.connect(process.env.RABBITMQ_URL);
      conn.on("error", (err) => console.error("RabbitMQ error:", err.message));
      conn.on("close", () => {
        console.error("RabbitMQ connection closed, exiting");
        process.exit(1);
      });
      const channel = confirm ? await conn.createConfirmChannel() : await conn.createChannel();
      await channel.assertExchange(EXCHANGE, "topic", { durable: true });
      return { conn, channel };
    } catch (err) {
      console.log(`Waiting for RabbitMQ (attempt ${attempt}): ${err.message}`);
      await sleep(2000);
    }
  }
}

module.exports = { EXCHANGE, DLX, connect, sleep };
