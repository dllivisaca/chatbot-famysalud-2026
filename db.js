const mysql = require("mysql2/promise");

const DB_PORT = Number.parseInt(process.env.DB_PORT || "3306", 10);
const DB_QUERY_TIMEOUT_MS_CONFIG = Number.parseInt(process.env.DB_QUERY_TIMEOUT_MS || "10000", 10);
const DB_QUERY_TIMEOUT_MS = Number.isInteger(DB_QUERY_TIMEOUT_MS_CONFIG) && DB_QUERY_TIMEOUT_MS_CONFIG > 0
  ? DB_QUERY_TIMEOUT_MS_CONFIG
  : 10000;

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
    await ejecutarQueryConTimeout(
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

  await ejecutarQueryConTimeout(
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

async function ejecutarQueryConTimeout(sql, params) {
  const startedAt = Date.now();
  let timeoutId;

  console.log("[DB] Antes await pool.execute chatbot_eventos:", {
    eventType: params[0],
    timeoutMs: DB_QUERY_TIMEOUT_MS
  });

  try {
    const result = await Promise.race([
      pool.execute(sql, params),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout MySQL despues de ${DB_QUERY_TIMEOUT_MS}ms`));
        }, DB_QUERY_TIMEOUT_MS);
      })
    ]);

    console.log("[DB] Despues await pool.execute chatbot_eventos:", {
      eventType: params[0],
      elapsedMs: Date.now() - startedAt
    });

    return result;
  } catch (error) {
    console.error("[DB] Error/timeout en pool.execute chatbot_eventos:", {
      eventType: params[0],
      elapsedMs: Date.now() - startedAt,
      error: error.message
    });
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function columnaSessionIdNoExiste(error) {
  return error?.code === "ER_BAD_FIELD_ERROR" && /session_id/i.test(error.message || "");
}

module.exports = {
  insertarEvento
};
