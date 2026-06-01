const mysql = require("mysql2/promise");

const DB_PORT = Number.parseInt(process.env.DB_PORT || "3306", 10);
const DB_QUERY_TIMEOUT_MS_CONFIG = Number.parseInt(process.env.DB_QUERY_TIMEOUT_MS || "10000", 10);
const DB_QUERY_TIMEOUT_MS = Number.isInteger(DB_QUERY_TIMEOUT_MS_CONFIG) && DB_QUERY_TIMEOUT_MS_CONFIG > 0
  ? DB_QUERY_TIMEOUT_MS_CONFIG
  : 10000;
const DB_PORT_EFFECTIVE = Number.isInteger(DB_PORT) ? DB_PORT : 3306;
const DB_TIMEZONE = "-05:00";
const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Guayaquil";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: DB_PORT_EFFECTIVE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: DB_TIMEZONE,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

console.log("[DB] Configuracion MySQL:", {
  DB_HOST: process.env.DB_HOST || null,
  DB_PORT: DB_PORT_EFFECTIVE,
  DB_NAME: process.env.DB_NAME || null,
  DB_USER: process.env.DB_USER || null,
  DB_TIMEZONE,
  APP_TIMEZONE
});

let soportaSessionId = true;

function dbConfigurada() {
  return Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
}

function construirDetalleErrorDb(error, contexto = {}) {
  return {
    ...contexto,
    "error.message": error?.message || "",
    "error.code": error?.code || null,
    "error.errno": error?.errno || null,
    "error.sqlMessage": error?.sqlMessage || null,
    "error.sqlState": error?.sqlState || null,
    "error.stack": error?.stack || null
  };
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
  const createdAt = obtenerFechaHoraMysqlEcuador();

  if (!incluirSessionId) {
    await ejecutarQueryConTimeout(
      `INSERT INTO chatbot_eventos
        (event_type, user_hash, message_id, button_id, menu_key, flow_key, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evento.event_type,
        evento.user_hash,
        evento.message_id || null,
        evento.button_id || null,
        evento.menu_key || null,
        evento.flow_key || null,
        payload,
        createdAt
      ],
      { createdAt }
    );
    return;
  }

  await ejecutarQueryConTimeout(
    `INSERT INTO chatbot_eventos
      (event_type, user_hash, session_id, message_id, button_id, menu_key, flow_key, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evento.event_type,
      evento.user_hash,
      evento.session_id || null,
      evento.message_id || null,
      evento.button_id || null,
      evento.menu_key || null,
      evento.flow_key || null,
      payload,
      createdAt
    ],
    { createdAt }
  );
}

function obtenerFechaHoraMysqlEcuador(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(fecha);

  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
  return `${valor("year")}-${valor("month")}-${valor("day")} ${valor("hour")}:${valor("minute")}:${valor("second")}`;
}

async function ejecutarPoolConTimezone(sql, params, opciones = {}) {
  const connection = await pool.getConnection();

  try {
    await connection.query(`SET time_zone = '${DB_TIMEZONE}'`);
    return await connection.execute(sql, params);
  } finally {
    connection.release();
  }
}

async function ejecutarQueryConTimeout(sql, params, opciones = {}) {
  const startedAt = Date.now();
  let timeoutId;

  console.log("[DB] Antes await pool.execute chatbot_eventos:", {
    eventType: params[0],
    timeoutMs: DB_QUERY_TIMEOUT_MS
  });

  try {
    const result = await Promise.race([
      ejecutarPoolConTimezone(sql, params, opciones),
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
    console.error("[DB] Error/timeout en pool.execute chatbot_eventos:", construirDetalleErrorDb(error, {
      eventType: params[0],
      action: "insert_chatbot_eventos",
      elapsedMs: Date.now() - startedAt
    }));
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
      ejecutarPoolConTimezone(sql, params),
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
    console.warn("[ASESOR_DB] Query fallo:", construirDetalleErrorDb(error, {
      action,
      elapsedMs: Date.now() - startedAt
    }));
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function ejecutarFeriadosQuery(sql, params = [], action = "feriados_query") {
  if (!dbConfigurada()) {
    return null;
  }

  const startedAt = Date.now();
  let timeoutId;

  try {
    const result = await Promise.race([
      ejecutarPoolConTimezone(sql, params),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout MySQL despues de ${DB_QUERY_TIMEOUT_MS}ms`));
        }, DB_QUERY_TIMEOUT_MS);
      })
    ]);

    console.log("[FERIADOS] Query OK:", {
      action,
      elapsedMs: Date.now() - startedAt
    });

    return result;
  } catch (error) {
    console.warn("[FERIADOS] Error consultando BD:", {
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

async function obtenerAreasAgendables() {
  if (!dbConfigurada()) {
    return [];
  }

  const startedAt = Date.now();
  let timeoutId;

  try {
    console.log("[AGENDAMIENTO_DB] Consultando áreas de atención...", {
      action: "appointment_areas_with_services_select",
      table: "famysufk_appointments.categories/famysufk_appointments.services"
    });

    const [rows] = await Promise.race([
      ejecutarPoolConTimezone(
        `SELECT DISTINCT c.id, c.title
         FROM famysufk_appointments.categories c
         INNER JOIN famysufk_appointments.services s
           ON s.category_id = c.id
         WHERE c.status = ?
           AND s.status = ?
           AND s.deleted_at IS NULL
         ORDER BY c.title ASC`,
        [1, 1]
      ),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout MySQL despues de ${DB_QUERY_TIMEOUT_MS}ms`));
        }, DB_QUERY_TIMEOUT_MS);
      })
    ]);

    console.log("[AGENDAMIENTO_DB] Áreas de atención consultadas:", {
      action: "appointment_areas_with_services_select",
      total: rows.length,
      elapsedMs: Date.now() - startedAt
    });

    return rows
      .map((row) => ({
        id: row.id,
        title: typeof row.title === "string" ? row.title.trim() : ""
      }))
      .filter((row) => row.title);
  } catch (error) {
    const detalleError = construirDetalleErrorDb(error, {
      action: "appointment_areas_with_services_select",
      table: "famysufk_appointments.categories/famysufk_appointments.services",
      elapsedMs: Date.now() - startedAt
    });

    console.warn("[AGENDAMIENTO_DB] Error consultando áreas de atención:", detalleError);
    console.error("[AGENDAMIENTO_DB] Error consultando áreas de atención:", detalleError);
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function obtenerServiciosAgendablesPorArea(areaId) {
  if (!dbConfigurada()) {
    return [];
  }

  const startedAt = Date.now();
  let timeoutId;

  try {
    console.log("[AGENDAMIENTO_DB] Consultando servicios por área...", {
      action: "appointment_services_by_area_select",
      table: "famysufk_appointments.services",
      areaId
    });

    const [rows] = await Promise.race([
      ejecutarPoolConTimezone(
        `SELECT id, title, price, sale_price, is_presential, is_virtual
         FROM famysufk_appointments.services
         WHERE category_id = ?
           AND status = ?
           AND deleted_at IS NULL
         ORDER BY title ASC`,
        [areaId, 1]
      ),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout MySQL despues de ${DB_QUERY_TIMEOUT_MS}ms`));
        }, DB_QUERY_TIMEOUT_MS);
      })
    ]);

    console.log("[AGENDAMIENTO_DB] Servicios por área consultados:", {
      action: "appointment_services_by_area_select",
      areaId,
      total: rows.length,
      elapsedMs: Date.now() - startedAt
    });

    return rows
      .map((row) => ({
        id: row.id,
        title: typeof row.title === "string" ? row.title.trim() : "",
        price: row.price,
        sale_price: row.sale_price,
        is_presential: Boolean(row.is_presential),
        is_virtual: Boolean(row.is_virtual)
      }))
      .filter((row) => row.title);
  } catch (error) {
    const detalleError = construirDetalleErrorDb(error, {
      action: "appointment_services_by_area_select",
      table: "famysufk_appointments.services",
      areaId,
      elapsedMs: Date.now() - startedAt
    });

    console.warn("[AGENDAMIENTO_DB] Error consultando servicios por área:", detalleError);
    console.error("[AGENDAMIENTO_DB] Error consultando servicios por área:", detalleError);
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function obtenerProfesionalesAgendablesPorServicio(serviceId) {
  if (!dbConfigurada()) {
    return [];
  }

  const startedAt = Date.now();
  let timeoutId;

  try {
    console.log("[AGENDAMIENTO_DB] Consultando profesionales por servicio...", {
      action: "appointment_professionals_by_service_select",
      table: "famysufk_appointments.employees/famysufk_appointments.employee_service/famysufk_appointments.users",
      serviceId
    });

    const [rows] = await Promise.race([
      ejecutarPoolConTimezone(
        `SELECT
           e.id,
           u.name,
           e.days,
           es.slot_duration
         FROM famysufk_appointments.employees e
         INNER JOIN famysufk_appointments.employee_service es
           ON es.employee_id = e.id
         INNER JOIN famysufk_appointments.users u
           ON u.id = e.user_id
         WHERE es.service_id = ?
           AND u.status = ?
           AND e.days IS NOT NULL
           AND e.days <> ''
           AND e.days <> '[]'
         ORDER BY u.name ASC`,
        [serviceId, 1]
      ),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout MySQL despues de ${DB_QUERY_TIMEOUT_MS}ms`));
        }, DB_QUERY_TIMEOUT_MS);
      })
    ]);

    console.log("[AGENDAMIENTO_DB] Profesionales por servicio consultados:", {
      action: "appointment_professionals_by_service_select",
      serviceId,
      total: rows.length,
      elapsedMs: Date.now() - startedAt
    });

    return rows
      .map((row) => ({
        id: row.id,
        name: typeof row.name === "string" ? row.name.trim() : "",
        days: row.days,
        slot_duration: row.slot_duration
      }))
      .filter((row) => row.name);
  } catch (error) {
    const detalleError = construirDetalleErrorDb(error, {
      action: "appointment_professionals_by_service_select",
      table: "famysufk_appointments.employees/famysufk_appointments.employee_service/famysufk_appointments.users",
      serviceId,
      elapsedMs: Date.now() - startedAt
    });

    console.warn("[AGENDAMIENTO_DB] Error consultando profesionales por servicio:", detalleError);
    console.error("[AGENDAMIENTO_DB] Error consultando profesionales por servicio:", detalleError);
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function obtenerFeriadosPendientesRecordatorio(fechaFeriado) {
  if (!dbConfigurada()) {
    return [];
  }

  const [rows] = await ejecutarFeriadosQuery(
    `SELECT f.id AS feriado_id, f.fecha, f.nombre, h.estado_confirmacion, h.recordatorio_enviado
     FROM chatbot_feriados f
     LEFT JOIN chatbot_horarios_especiales h ON h.feriado_id = f.id
     WHERE f.activo = 1
       AND f.fecha = ?
       AND (h.feriado_id IS NULL OR COALESCE(h.recordatorio_enviado, 0) = 0)
       AND (h.estado_confirmacion IS NULL OR h.estado_confirmacion = 'pendiente')`,
    [fechaFeriado],
    "holiday_pending_reminders"
  );

  return rows || [];
}

async function marcarRecordatorioFeriadoEnviado(feriadoId) {
  if (!dbConfigurada()) {
    return;
  }

  const [update] = await ejecutarFeriadosQuery(
    `UPDATE chatbot_horarios_especiales
     SET recordatorio_enviado = 1,
         recordatorio_enviado_en = NOW(),
         estado_confirmacion = COALESCE(estado_confirmacion, 'pendiente')
     WHERE feriado_id = ?`,
    [feriadoId],
    "holiday_mark_reminder_sent"
  );

  if (update.affectedRows > 0) {
    return;
  }

  await ejecutarFeriadosQuery(
    `INSERT INTO chatbot_horarios_especiales
      (feriado_id, tipo, recordatorio_enviado, recordatorio_enviado_en, estado_confirmacion)
     VALUES (?, 'normal', 1, NOW(), 'pendiente')`,
    [feriadoId],
    "holiday_insert_reminder_sent"
  );
}

async function obtenerConfirmacionFeriadoPendiente() {
  if (!dbConfigurada()) {
    return null;
  }

  const [rows] = await ejecutarFeriadosQuery(
    `SELECT f.id AS feriado_id, f.fecha, f.nombre, h.estado_confirmacion
     FROM chatbot_horarios_especiales h
     INNER JOIN chatbot_feriados f ON f.id = h.feriado_id
     WHERE f.activo = 1
       AND h.recordatorio_enviado = 1
       AND h.estado_confirmacion IN ('pendiente', 'esperando_horario_parcial')
     ORDER BY f.fecha ASC
     LIMIT 1`,
    [],
    "holiday_pending_confirmation"
  );

  return rows?.[0] || null;
}

async function actualizarConfirmacionHorarioEspecial(feriadoId, tipo, confirmadoPor) {
  if (!dbConfigurada()) {
    return;
  }

  await ejecutarFeriadosQuery(
    `UPDATE chatbot_horarios_especiales
     SET tipo = ?,
         hora_inicio = NULL,
         hora_fin = NULL,
         confirmado_por = ?,
         confirmado_en = NOW(),
         estado_confirmacion = 'confirmado'
     WHERE feriado_id = ?`,
    [tipo, confirmadoPor, feriadoId],
    `holiday_confirm_${tipo}`
  );
}

async function marcarEsperandoHorarioParcial(feriadoId) {
  if (!dbConfigurada()) {
    return;
  }

  await ejecutarFeriadosQuery(
    `UPDATE chatbot_horarios_especiales
     SET tipo = 'parcial',
         estado_confirmacion = 'esperando_horario_parcial'
     WHERE feriado_id = ?`,
    [feriadoId],
    "holiday_wait_partial"
  );
}

async function actualizarHorarioParcialFeriado(feriadoId, horaInicio, horaFin, confirmadoPor) {
  if (!dbConfigurada()) {
    return;
  }

  await ejecutarFeriadosQuery(
    `UPDATE chatbot_horarios_especiales
     SET tipo = 'parcial',
         hora_inicio = ?,
         hora_fin = ?,
         confirmado_por = ?,
         confirmado_en = NOW(),
         estado_confirmacion = 'confirmado'
     WHERE feriado_id = ?`,
    [horaInicio, horaFin, confirmadoPor, feriadoId],
    "holiday_confirm_partial"
  );
}

async function obtenerHorarioEspecialConfirmadoPorFecha(fecha) {
  if (!dbConfigurada()) {
    return null;
  }

  const [rows] = await ejecutarFeriadosQuery(
    `SELECT f.fecha, f.nombre, h.tipo, h.hora_inicio, h.hora_fin
     FROM chatbot_horarios_especiales h
     INNER JOIN chatbot_feriados f ON f.id = h.feriado_id
     WHERE f.activo = 1
       AND f.fecha = ?
       AND h.estado_confirmacion = 'confirmado'
     LIMIT 1`,
    [fecha],
    "holiday_confirmed_by_date"
  );

  return rows?.[0] || null;
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
  obtenerAreasAgendables,
  obtenerServiciosAgendablesPorArea,
  obtenerProfesionalesAgendablesPorServicio,
  guardarPacienteEnColaAsesor,
  eliminarPacienteDeColaAsesor,
  guardarSesionAsesorPersistida,
  finalizarSesionAsesorPersistida,
  obtenerEstadoAsesoresPersistido,
  obtenerFeriadosPendientesRecordatorio,
  marcarRecordatorioFeriadoEnviado,
  obtenerConfirmacionFeriadoPendiente,
  actualizarConfirmacionHorarioEspecial,
  marcarEsperandoHorarioParcial,
  actualizarHorarioParcialFeriado,
  obtenerHorarioEspecialConfirmadoPorFecha
};
