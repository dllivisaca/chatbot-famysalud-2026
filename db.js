const mysql = require("mysql2/promise");

const DB_PORT = Number.parseInt(process.env.DB_PORT || "3306", 10);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number.isInteger(DB_PORT) ? DB_PORT : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

function dbConfigurada() {
  return Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
}

async function insertarEvento(evento) {
  if (!dbConfigurada()) {
    return;
  }

  await pool.execute(
    `INSERT INTO chatbot_eventos
      (event_type, user_hash, message_id, button_id, menu_key, flow_key, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      evento.event_type,
      evento.user_hash,
      evento.message_id || null,
      evento.button_id || null,
      evento.menu_key || null,
      evento.flow_key || null,
      evento.payload ? JSON.stringify(evento.payload) : null
    ]
  );
}

module.exports = {
  insertarEvento
};
