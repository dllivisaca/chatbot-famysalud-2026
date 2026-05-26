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

let soportaSessionId = true;

function dbConfigurada() {
  return Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
}

async function insertarEvento(evento) {
  if (!dbConfigurada()) {
    return;
  }

  try {
    await insertarEventoConCompatibilidad(evento, soportaSessionId);
  } catch (error) {
    if (soportaSessionId && columnaSessionIdNoExiste(error)) {
      soportaSessionId = false;
      await insertarEventoConCompatibilidad(evento, false);
      return;
    }

    throw error;
  }
}

async function insertarEventoConCompatibilidad(evento, incluirSessionId) {
  const payload = evento.payload ? JSON.stringify(evento.payload) : null;

  if (!incluirSessionId) {
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
        payload
      ]
    );
    return;
  }

  await pool.execute(
    `INSERT INTO chatbot_eventos
      (event_type, user_hash, session_id, message_id, button_id, menu_key, flow_key, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evento.event_type,
      evento.user_hash,
      evento.session_id || null,
      evento.message_id || null,
      evento.button_id || null,
      evento.menu_key || null,
      evento.flow_key || null,
      payload
    ]
  );
}

function columnaSessionIdNoExiste(error) {
  return error?.code === "ER_BAD_FIELD_ERROR" && /session_id/i.test(error.message || "");
}

module.exports = {
  insertarEvento
};
