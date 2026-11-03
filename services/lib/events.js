const { randomUUID } = require("crypto");

// Envelope chung cho mọi event (theo các trường cơ bản của CloudEvents)
function envelope(type, data) {
  return {
    id: randomUUID(),
    type,
    source: "user-service",
    time: new Date().toISOString(),
    data,
  };
}

module.exports = { envelope };
