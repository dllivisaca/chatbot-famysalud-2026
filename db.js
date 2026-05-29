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

async function ejecutarAsesorQuery(sql, params = [], action = "asesor_query") {
  if (!dbConfigurada()) {
    return null;
  }

  const startedAt = Date.now();
  let timeoutId;

  try {
    const result = await Promise.race([
      pool.execute(sql, params),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout MySQL despues de ${DB_QUERY_TIMEOUT_MS}ms`));
        }, DB_QUERY_TIMEOUT_MS);
      })
    ]);

    console.log("[ASESOR_DB] Query OK:", {
      action,
      elapsedMs: Date.now() - startedAt
    });

    return result;
  } catch (error) {
    console.warn("[ASESOR_DB] Query fallo:", {
      action,
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

async function guardarPacienteEnColaAsesor(item) {
  if (!dbConfigurada()) {
    return;
  }

  await ejecutarAsesorQuery(
    "DELETE FROM chatbot_asesor_sesiones WHERE paciente_phone = ? AND estado = 'en_cola'",
    [item.paciente_phone],
    "queue_delete_existing"
  );

  await ejecutarAsesorQuery(
    `INSERT INTO chatbot_asesor_sesiones
      (paciente_phone, asesor_id, asesor_phone, origen, estado, creado_en, actualizado_en)
     VALUES (?, NULL, NULL, ?, 'en_cola', FROM_UNIXTIME(? / 1000), NOW())`,
    [
      item.paciente_phone,
      item.origen || "paciente",
      item.creado_en || Date.now()
    ],
    "queue_insert"
  );
}

async function eliminarPacienteDeColaAsesor(pacientePhone) {
  if (!dbConfigurada()) {
    return;
  }

  await ejecutarAsesorQuery(
    "DELETE FROM chatbot_asesor_sesiones WHERE paciente_phone = ? AND estado = 'en_cola'",
    [pacientePhone],
    "queue_delete"
  );
}

async function guardarSesionAsesorPersistida(sesion) {
  if (!dbConfigurada() || !sesion?.paciente || sesion.estado === "libre") {
    return;
  }

  await ejecutarAsesorQuery(
    "DELETE FROM chatbot_asesor_sesiones WHERE asesor_id = ? AND estado IN ('esperando_nombre', 'esperando_nombre_cargo', 'conectado')",
    [sesion.asesorId],
    "session_delete_existing_advisor"
  );

  await ejecutarAsesorQuery(
    "DELETE FROM chatbot_asesor_sesiones WHERE paciente_phone = ? AND estado IN ('esperando_nombre', 'esperando_nombre_cargo', 'conectado')",
    [sesion.paciente],
    "session_delete_existing_patient"
  );

  await ejecutarAsesorQuery(
    `INSERT INTO chatbot_asesor_sesiones
      (paciente_phone, asesor_id, asesor_phone, origen, estado, nombre_asesor, cargo_asesor,
       nombre_temporal_asesor, asignado_en, conectado_en, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000), NOW())`,
    [
      sesion.paciente,
      sesion.asesorId,
      sesion.asesor,
      sesion.origen || "paciente",
      sesion.estado,
      sesion.nombreAsesor || null,
      sesion.cargoAsesor || null,
      sesion.nombreTemporalAsesor || null,
      sesion.asignadoEn || Date.now(),
      sesion.conectadoEn || null,
      sesion.asignadoEn || Date.now()
    ],
    "session_insert"
  );
}

async function finalizarSesionAsesorPersistida(asesorId, motivo) {
  if (!dbConfigurada()) {
    return;
  }

  await ejecutarAsesorQuery(
    `UPDATE chatbot_asesor_sesiones
     SET estado = 'finalizado', actualizado_en = NOW()
     WHERE asesor_id = ? AND estado IN ('esperando_nombre', 'esperando_nombre_cargo', 'conectado')`,
    [asesorId],
    `session_finish_${motivo || "manual"}`
  );
}

async function obtenerEstadoAsesoresPersistido() {
  if (!dbConfigurada()) {
    return { cola: [], sesiones: [] };
  }

  const [rows] = await ejecutarAsesorQuery(
    `SELECT paciente_phone, asesor_id, asesor_phone, origen, estado, nombre_asesor, cargo_asesor,
            nombre_temporal_asesor, asignado_en, conectado_en, creado_en, actualizado_en
     FROM chatbot_asesor_sesiones
     WHERE estado IN ('en_cola', 'esperando_nombre', 'esperando_nombre_cargo', 'conectado')
     ORDER BY creado_en ASC, actualizado_en ASC`,
    [],
    "restore_active"
  );

  return {
    cola: rows.filter((row) => row.estado === "en_cola"),
    sesiones: rows.filter((row) => row.estado !== "en_cola")
  };
}

function columnaSessionIdNoExiste(error) {
  return error?.code === "ER_BAD_FIELD_ERROR" && /session_id/i.test(error.message || "");
}

module.exports = {
  insertarEvento,
  guardarPacienteEnColaAsesor,
  eliminarPacienteDeColaAsesor,
  guardarSesionAsesorPersistida,
  finalizarSesionAsesorPersistida,
  obtenerEstadoAsesoresPersistido
};
