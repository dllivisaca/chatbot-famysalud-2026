require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { insertarEvento } = require("./db");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const CHATBOT_CATALOG_URL = process.env.CHATBOT_CATALOG_URL;
const EVENT_HASH_SALT = process.env.EVENT_HASH_SALT || "";
const APP_ENV = process.env.APP_ENV || "production";
const ENABLE_APPOINTMENT_BOOKING = flagActiva(process.env.ENABLE_APPOINTMENT_BOOKING);
const ENABLE_AI_RESPONSES = flagActiva(process.env.ENABLE_AI_RESPONSES);
const INTERNAL_RESULTS_WHATSAPP_TO = process.env.INTERNAL_RESULTS_WHATSAPP_TO;
const RESULTS_INTERNAL_EMAIL = process.env.RESULTS_INTERNAL_EMAIL;
const RESULTS_EMAIL_FROM = process.env.RESULTS_EMAIL_FROM;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_SECURE = flagActiva(process.env.SMTP_SECURE);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const WHATSAPP_API_VERSION = "v20.0";
const SESSION_TTL_MINUTES = Number.parseInt(process.env.SESSION_TTL_MINUTES || "15", 10);
const SESION_USUARIO_TTL_MS = (Number.isInteger(SESSION_TTL_MINUTES) && SESSION_TTL_MINUTES > 0
  ? SESSION_TTL_MINUTES
  : 15) * 60 * 1000;
const CATALOG_CACHE_TTL_MINUTES = Number.parseInt(process.env.CATALOG_CACHE_TTL_MINUTES || "10", 10);
const CATALOG_CACHE_TTL_MS = (Number.isInteger(CATALOG_CACHE_TTL_MINUTES) && CATALOG_CACHE_TTL_MINUTES > 0
  ? CATALOG_CACHE_TTL_MINUTES
  : 10) * 60 * 1000;
const MENSAJES_PROCESADOS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_OPCIONES_LISTA_WHATSAPP = 10;
const MAX_TITULO_FILA_LISTA = 24;
const PROMOCIONES_URL = "https://famysalud.com.ec/promociones";
const UBICACION_FAMYSALUD = {
  name: "Centro Médico FamySALUD",
  address: "Quisquis 1109 y José Mascote\nGuayaquil, Ecuador",
  latitude: -2.1872404,
  longitude: -79.8918589,
  croquisPath: path.join("assets", "img", "ubicacion-famysalud.png")
};
const sesionesUsuarios = new Map();
const sesionesCotizacion = new Map();
const sesionesResultados = new Map();
const mensajesProcesados = new Map();
const temporizadoresSesion = new Map();
const sesionesExpiradas = new Set();
const ASESOR_WHATSAPP = "593989729682";
const NUMEROS_INTERNOS = [
  "593989729682",
  "593939034743"
];
const ASESORES_REGISTRADOS = {
  jennifer: { nombre: "Jennifer", cargo: "asesora" },
  yadira: { nombre: "Yadira", cargo: "asesora" },
  daisy: { nombre: "Daisy", cargo: "asesora" },
  david: { nombre: "David", cargo: "asesor" }
};
let sesionAsesor = {
  paciente: null,
  asesor: ASESOR_WHATSAPP,
  nombreAsesor: null,
  cargoAsesor: null,
  nombreTemporalAsesor: null,
  estado: "libre"
};
let catalogoServiciosCache = null;
let catalogoServiciosCacheTimestamp = 0;

function flagActiva(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function esNumeroInterno(numero) {
  return NUMEROS_INTERNOS.includes(numero);
}

function esProduccion() {
  return APP_ENV === "production";
}

function featureHabilitada(flag) {
  return flag === true;
}

function hashUsuario(from) {
  return crypto
    .createHash("sha256")
    .update(`${EVENT_HASH_SALT}:${from}`)
    .digest("hex");
}

function generarSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString("hex");
}

function obtenerSessionId(from) {
  return obtenerSesionUsuario(from)?.sessionId || null;
}

function registrarEvento(from, eventType, datos = {}) {
  if (!from) {
    return;
  }

  insertarEvento({
    event_type: eventType,
    user_hash: hashUsuario(from),
    session_id: datos.sessionId || obtenerSessionId(from),
    message_id: datos.messageId,
    button_id: datos.buttonId,
    menu_key: datos.menuKey,
    flow_key: datos.flowKey,
    payload: datos.payload
  }).catch((error) => {
    console.error("[EVENTO] Error registrando evento:", error.message);
  });
}

function purgarMensajesProcesados(now = Date.now()) {
  for (const [messageId, timestamp] of mensajesProcesados) {
    if (now - timestamp > MENSAJES_PROCESADOS_TTL_MS) {
      mensajesProcesados.delete(messageId);
    }
  }
}

function mensajeYaProcesado(messageId) {
  return Boolean(messageId && mensajesProcesados.has(messageId));
}

function marcarMensajeProcesado(messageId, now = Date.now()) {
  if (messageId) {
    mensajesProcesados.set(messageId, now);
  }
}

const TEXTOS = {
  menuPrincipal: `Hola 👋 Soy el asistente virtual de FamySALUD.
Por favor elige una opción:`,
  pacientes: "Perfecto 💙 ¿Cómo podemos ayudarte?",
  empresas: "Gracias por tu interés en nuestros servicios empresariales 👨‍⚕️🏢",
  proveedores: "Gracias por tu interés en trabajar con FamySALUD 🤝",
  alianzas: "Nos alegra tu interés en generar una alianza con FamySALUD 🤝",
  trabaja: `Gracias por tu interés en formar parte de FamySALUD 💙

Postúlate aquí:
[LINK_GOOGLE_FORM]

Nuestro equipo revisará tu información y te contactará si existe una vacante acorde a tu perfil.`
};

const MENUS = {
  principal: {
    text: TEXTOS.menuPrincipal,
    buttons: [
      boton("main_atenderme", "Soy paciente"),
      // WhatsApp permite maximo 20 caracteres en el titulo del boton.
      boton("main_empresas", "Serv. para empresas"),
      boton("main_mas_opciones", "Más opciones")
    ]
  },
  principalMasOpciones: {
    text: "Elige una opción:",
    buttons: [
      boton("main_proveedor", "Quiero ser proveedor"),
      boton("main_alianza", "Alianza estratégica"),
      boton("main_trabaja", "Trabaja con nosotros")
    ]
  },
  pacientes: {
    text: TEXTOS.pacientes,
    buttons: [
      boton("paciente_agendar_cita", "Agendar cita"),
      boton("paciente_cotizar", "Cotizar servicios"),
      boton("paciente_mas_opciones_1", "Más opciones")
    ]
  },
  pacientesMasOpciones1: {
    text: "Elige una opción:",
    buttons: [
      boton("paciente_resultados", "Solicitar resultados"),
      boton("paciente_promociones", "Promociones"),
      boton("paciente_mas_opciones_2", "Más opciones")
    ]
  },
  pacientesMasOpciones2: {
    text: "Elige una opción:",
    buttons: [
      boton("paciente_ubicacion", "Ubicación"),
      boton("paciente_horarios", "Horarios"),
      boton("paciente_hablar_asesor", "Hablar con asesor")
    ]
  },
  empresas: {
    text: TEXTOS.empresas,
    buttons: [
      boton("empresa_salud_ocupacional", "Salud ocupacional"),
      boton("empresa_cotizar", "Cotizar servicio"),
      boton("empresa_mas_opciones_1", "Más opciones")
    ]
  },
  empresasMasOpciones1: {
    text: "Elige una opción:",
    buttons: [
      boton("empresa_resultados", "Solicitar resultados"),
      boton("empresa_ubicacion", "Ubicación"),
      boton("empresa_mas_opciones_2", "Más opciones")
    ]
  },
  empresasMasOpciones2: {
    text: "Elige una opción:",
    buttons: [
      boton("empresa_horarios", "Horarios"),
      boton("empresa_asesor", "Hablar con asesor")
    ]
  },
  proveedores: {
    text: TEXTOS.proveedores,
    buttons: [
      boton("proveedor_propuesta", "Enviar propuesta"),
      boton("proveedor_ubicacion", "Ubicación"),
      boton("proveedor_mas_opciones", "Más opciones")
    ]
  },
  proveedoresMasOpciones: {
    text: "Elige una opción:",
    buttons: [
      boton("proveedor_horarios", "Horarios"),
      boton("proveedor_asesor", "Hablar con asesor")
    ]
  },
  alianzas: {
    text: TEXTOS.alianzas,
    buttons: [
      boton("alianza_info", "Dejar información"),
      boton("alianza_ubicacion", "Ubicación"),
      boton("alianza_mas_opciones", "Más opciones")
    ]
  },
  alianzasMasOpciones: {
    text: "Elige una opción:",
    buttons: [
      boton("alianza_horarios", "Horarios"),
      boton("alianza_asesor", "Hablar con asesor")
    ]
  }
};

const ACCIONES_BOTONES = {
  main_menu: { type: "main_menu" },
  menu_principal: { type: "main_menu" },
  main_atenderme: { type: "menu", menu: "pacientes" },
  main_empresas: { type: "menu", menu: "empresas" },
  main_mas_opciones: { type: "menu", menu: "principalMasOpciones" },
  main_proveedor: { type: "menu", menu: "proveedores" },
  main_alianza: { type: "menu", menu: "alianzas" },
  main_trabaja: { type: "text", text: TEXTOS.trabaja },
  volver_cotizar: { type: "restart_quote" },

  paciente_agendar_cita: { type: "appointment_booking", text: `¡Perfecto! 💙

Puedes agendar tu cita de forma rápida desde nuestra aplicación web:

🌐 app.famysaludec.com

Nuestra plataforma es fácil de usar y protegemos tu información de manera segura 🔒

Si necesitas ayuda para utilizarla, aquí tienes nuestros tutoriales:

📘 Manual:
tinyurl.com/ManualFS

🎥 Video tutorial:
tinyurl.com/VideoTutorialFS

Si no encuentras el servicio que necesitas, no encuentras un turno específico, deseas consultar más disponibilidad o requieres una atención más urgente o personalizada, puedes contactarnos directamente:

💬 WhatsApp:
wa.me/593939034743

📞 Llamadas:
0939034743

Estaremos encantados de ayudarte 😊` },
  paciente_cotizar: { type: "catalog_areas" },
  paciente_mas_opciones_1: { type: "menu", menu: "pacientesMasOpciones1" },
  paciente_resultados: { type: "results_request" },
  paciente_promociones: { type: "promotions" },
  paciente_mas_opciones_2: { type: "menu", menu: "pacientesMasOpciones2" },
  paciente_ubicacion: { type: "patient_location" },
  paciente_horarios: { type: "text_with_main_menu", text: `🕒 ¡Te esperamos en FamySALUD!

Nuestros horarios de atención son:

Lun-Vie: 7:30AM - 5:30PM
Sáb: 8:00AM - 12:30PM

Será un gusto atenderte 💙` },
  paciente_hablar_asesor: { type: "advisor_chat" },
  paciente_asesor: { type: "text", text: "En breve te comunicaremos con un asesor de FamySALUD." },

  empresa_salud_ocupacional: { type: "text", text: "Te brindaremos información sobre nuestros servicios de salud ocupacional." },
  empresa_cotizar: { type: "text", text: "Para cotizar un servicio empresarial, un asesor te contactará pronto." },
  empresa_mas_opciones_1: { type: "menu", menu: "empresasMasOpciones1" },
  empresa_resultados: { type: "text", text: "Para solicitar resultados empresariales, comparte los datos de tu empresa." },
  empresa_ubicacion: { type: "text", text: "Te compartiremos nuestra ubicación para atención empresarial." },
  empresa_mas_opciones_2: { type: "menu", menu: "empresasMasOpciones2" },
  empresa_horarios: { type: "text", text: "Nuestros horarios de atención serán confirmados por un asesor." },
  empresa_asesor: { type: "text", text: "En breve te comunicaremos con un asesor empresarial." },

  proveedor_propuesta: { type: "text", text: "Puedes enviar tu propuesta y nuestro equipo la revisará." },
  proveedor_ubicacion: { type: "text", text: "Te compartiremos nuestra ubicación para proveedores." },
  proveedor_mas_opciones: { type: "menu", menu: "proveedoresMasOpciones" },
  proveedor_horarios: { type: "text", text: "Nuestros horarios para proveedores serán confirmados por un asesor." },
  proveedor_asesor: { type: "text", text: "En breve te comunicaremos con un asesor de proveedores." },

  alianza_info: { type: "text", text: "Déjanos tu información y nuestro equipo evaluará la alianza." },
  alianza_ubicacion: { type: "text", text: "Te compartiremos nuestra ubicación para alianzas estratégicas." },
  alianza_mas_opciones: { type: "menu", menu: "alianzasMasOpciones" },
  alianza_horarios: { type: "text", text: "Nuestros horarios serán confirmados por un asesor." },
  alianza_asesor: { type: "text", text: "En breve te comunicaremos con un asesor de alianzas." }
};

// Verificacion del webhook requerida por Meta WhatsApp Cloud API.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[WEBHOOK] Verificado correctamente.");
    return res.status(200).send(challenge);
  }

  console.warn("[WEBHOOK] Verificacion rechazada.");
  return res.sendStatus(403);
});

// Recibe mensajes entrantes desde WhatsApp Cloud API.
app.post("/webhook", async (req, res) => {
  const message = extraerMensaje(req.body);

  if (!message) {
    console.log("[MENSAJE] Evento recibido sin mensaje procesable.");
    return res.sendStatus(200);
  }

  try {
    const messageId = message.id;
    const from = message.from;
    const text = extraerTexto(message);
    const rawText = extraerTextoOriginal(message);
    const buttonId = extraerButtonReplyId(message);
    const listReplyId = extraerListReplyId(message);
    const enFlujoResultados = estaEnFlujoResultados(from);

    console.log("[MENSAJE] Recibido:", {
      messageId,
      from,
      type: message.type,
      text: enFlujoResultados ? "[redacted_results_flow]" : text,
      buttonId,
      listReplyId
    });

    const now = Date.now();
    purgarMensajesProcesados(now);

    if (mensajeYaProcesado(messageId)) {
      console.log("[MENSAJE] Duplicado ignorado:", { messageId, from });
      return res.sendStatus(200);
    }

    marcarMensajeProcesado(messageId, now);

    if (await manejarMensajeAsesor(from, rawText, message)) {
      return res.sendStatus(200);
    }

    if (await manejarMensajePacienteAsesor(from, rawText, message)) {
      return res.sendStatus(200);
    }

    if (esNumeroInterno(from)) {
      console.log("[INTERNO] Número interno detectado. Chatbot principal omitido:", from);
      return res.sendStatus(200);
    }

    const teniaSesionActiva = sesionUsuarioActiva(from);
    const teniaSessionId = Boolean(obtenerSessionId(from));

    if (debeResetearConversacion(text)) {
      limpiarSesionesUsuario(from);
      actualizarSesionUsuario(from);
      if (!teniaSesionActiva) {
        registrarEvento(from, "session_started", { messageId });
      }
      await enviarMenu(from, "principal");
      return res.sendStatus(200);
    }

    if (consumirMarcaSesionExpirada(from)) {
      actualizarSesionUsuario(from, { generarNuevaSesion: false });
      await enviarMenu(from, "principal");
      return res.sendStatus(200);
    }

    if (consumirSesionUsuarioExpirada(from)) {
      await enviarMensajeTexto(
        from,
        "⏳ Tu sesión anterior expiró por inactividad.\n\nTe mostramos nuevamente el menú principal 😊"
      );
      await enviarMenu(from, "principal");
      actualizarSesionUsuario(from, { generarNuevaSesion: false });
      return res.sendStatus(200);
    }

    actualizarSesionUsuario(from);
    if (!teniaSessionId) {
      registrarEvento(from, "session_started", { messageId });
    }

    if (estaEnFlujoResultados(from)) {
      await manejarFlujoResultados(from, rawText, buttonId, messageId);
      return res.sendStatus(200);
    }

    if (listReplyId) {
      await manejarSeleccionListaCotizacion(from, listReplyId, messageId);
      return res.sendStatus(200);
    }

    if (buttonId) {
      await manejarBoton(from, buttonId, messageId);
      return res.sendStatus(200);
    }

    if (estaEsperandoAreaCotizacion(from)) {
      await manejarSeleccionAreaCotizacion(from, text, messageId);
      return res.sendStatus(200);
    }

    if (estaEsperandoServicioCotizacion(from)) {
      await manejarSeleccionServicioCotizacion(from, text, messageId);
      return res.sendStatus(200);
    }

    if (debeMostrarMenu(text)) {
      await enviarMenu(from, "principal");
      return res.sendStatus(200);
    }

    if (featureHabilitada(ENABLE_AI_RESPONSES)) {
      await manejarRespuestaIA(from, text, messageId);
    } else {
      registrarEvento(from, "invalid_message", {
        messageId,
        payload: {
          reason: "fallback_to_main_menu",
          messageType: message.type
        }
      });
      await enviarMenu(from, "principal");
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error("[ERROR] Procesando mensaje:", error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

async function iniciarSesionAsesor(paciente, messageId, buttonId) {
  console.log("[PACIENTE] Solicita hablar con asesor:", { paciente, estado: sesionAsesor.estado });

  if (sesionAsesor.estado !== "libre") {
    await enviarMensajeTexto(
      paciente,
      "💬 En este momento nuestro asesor está atendiendo a otro paciente. Por favor intenta nuevamente en unos minutos 😊"
    );
    return;
  }

  sesionAsesor = {
    paciente,
    asesor: ASESOR_WHATSAPP,
    nombreAsesor: null,
    cargoAsesor: null,
    nombreTemporalAsesor: null,
    estado: "esperando_nombre"
  };

  console.log("[SESION] Asesor esperando nombre:", sesionAsesor);
  registrarEvento(paciente, "advisor_session_requested", {
    messageId,
    buttonId,
    flowKey: "paciente_hablar_asesor"
  });

  await enviarMensajeTexto(
    paciente,
    "💬 Claro, en un momento uno de nuestros asesores de FamySALUD te atenderá.\n\nPor favor espera un momento 😊"
  );
  await enviarMensajeTexto(
    ASESOR_WHATSAPP,
    "📩 Nuevo paciente esperando atención.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
  );
}

async function manejarMensajeAsesor(from, rawText, message) {
  if (from !== ASESOR_WHATSAPP) {
    return false;
  }

  const mensaje = (rawText || "").trim();

  if (sesionAsesor.estado === "esperando_nombre") {
    if (!mensaje) {
      console.log("[ASESOR] Nombre vacio ignorado.");
      return true;
    }

    const asesorRegistrado = detectarAsesorRegistrado(mensaje);

    if (asesorRegistrado) {
      await conectarAsesorConPaciente(asesorRegistrado);
      return true;
    }

    sesionAsesor.nombreTemporalAsesor = mensaje;
    sesionAsesor.estado = "esperando_nombre_cargo";
    console.log("[ASESOR] Nombre no reconocido:", { recibido: mensaje });
    console.log("[SESION] Esperando nombre y cargo:", sesionAsesor);

    await enviarMensajeTexto(
      sesionAsesor.asesor,
      "No reconocí ese nombre como asesor registrado.\n\nPor favor responde con tu nombre y cargo.\nEjemplo:\nCarlos asesor\nMaría asesora"
    );
    return true;
  }

  if (sesionAsesor.estado === "esperando_nombre_cargo") {
    const asesorConCargo = extraerAsesorConCargo(mensaje);

    if (!asesorConCargo) {
      console.log("[ASESOR] Falta cargo para conectar:", { recibido: mensaje });
      await enviarMensajeTexto(
        sesionAsesor.asesor,
        "Por favor incluye el cargo para continuar.\nEjemplo:\nCarlos asesor\nMaría asesora"
      );
      return true;
    }

    await conectarAsesorConPaciente(asesorConCargo);
    return true;
  }

  if (sesionAsesor.estado === "conectado") {
    if (mensaje.toLowerCase() === "finalizar") {
      const paciente = sesionAsesor.paciente;
      console.log("[ASESOR] Finaliza atencion:", { asesor: from, paciente });

      await enviarBotones(
        paciente,
        "✅ Gracias por comunicarte con FamySALUD. Ha sido un gusto atenderte 💙",
        [boton("menu_principal", "Menú principal")]
      );
      resetearSesionAsesor();
      await enviarMensajeTexto(
        ASESOR_WHATSAPP,
        "✅ Atención finalizada. Ya puedes recibir otro paciente."
      );
      return true;
    }

    if (mensaje) {
      console.log("[ASESOR] Reenviando mensaje al paciente:", {
        asesor: from,
        paciente: sesionAsesor.paciente
      });
      await enviarMensajeTexto(sesionAsesor.paciente, mensaje);
      return true;
    }

    if (await reenviarMensajeMultimedia(sesionAsesor.paciente, message)) {
      console.log("[ASESOR] Multimedia reenviado al paciente:", {
        asesor: from,
        paciente: sesionAsesor.paciente,
        tipo: message.type
      });
    }
    return true;
  }

  return false;
}

async function conectarAsesorConPaciente(asesor) {
  sesionAsesor.nombreAsesor = asesor.nombre;
  sesionAsesor.cargoAsesor = asesor.cargo;
  sesionAsesor.estado = "conectado";

  console.log("[ASESOR] Conectado con paciente:", {
    paciente: sesionAsesor.paciente,
    nombreAsesor: sesionAsesor.nombreAsesor,
    cargoAsesor: sesionAsesor.cargoAsesor
  });
  console.log("[SESION] Asesor conectado:", sesionAsesor);

  await enviarMensajeTexto(
    sesionAsesor.paciente,
    `Hola, soy ${sesionAsesor.nombreAsesor}, ${sesionAsesor.cargoAsesor} de FamySALUD 💙\nUn gusto atenderte. ¿En qué te puedo ayudar?`
  );
  await enviarMensajeTexto(
    sesionAsesor.asesor,
    "✅ Te conectaste con el paciente.\n\nEscribe normalmente para responderle.\nPara cerrar la atención escribe: finalizar"
  );
}

function detectarAsesorRegistrado(texto) {
  const nombreNormalizado = normalizarTextoAsesor(quitarCargoAsesor(texto));

  if (ASESORES_REGISTRADOS[nombreNormalizado]) {
    console.log("[ASESOR] Nombre reconocido exacto:", {
      recibido: texto,
      reconocido: ASESORES_REGISTRADOS[nombreNormalizado].nombre
    });
    return ASESORES_REGISTRADOS[nombreNormalizado];
  }

  let mejorCoincidencia = null;

  for (const [nombre, datos] of Object.entries(ASESORES_REGISTRADOS)) {
    const diferenciaLongitud = Math.abs(nombreNormalizado.length - nombre.length);

    if (diferenciaLongitud > 2) {
      continue;
    }

    const distancia = calcularDistanciaLevenshtein(nombreNormalizado, nombre);
    const diferenciaCaracteres = calcularDiferenciaCaracteres(nombreNormalizado, nombre);

    if (
      distancia <= 2 &&
      (
        !mejorCoincidencia ||
        distancia < mejorCoincidencia.distancia ||
        (distancia === mejorCoincidencia.distancia && diferenciaCaracteres < mejorCoincidencia.diferenciaCaracteres)
      )
    ) {
      mejorCoincidencia = {
        datos,
        distancia,
        diferenciaCaracteres
      };
    }
  }

  if (mejorCoincidencia) {
    console.log("[ASESOR] Nombre corregido por similitud:", {
      recibido: texto,
      reconocido: mejorCoincidencia.datos.nombre,
      distancia: mejorCoincidencia.distancia
    });
    return mejorCoincidencia.datos;
  }

  return null;
}

function extraerAsesorConCargo(texto) {
  const mensaje = (texto || "").trim();
  const normalizado = normalizarTextoAsesor(mensaje);
  const cargo = normalizado.includes("asesora") ? "asesora" : normalizado.includes("asesor") ? "asesor" : null;

  if (!cargo) {
    return null;
  }

  const nombreSinCargo = mensaje
    .replace(/\basesora\b/gi, "")
    .replace(/\basesor\b/gi, "")
    .trim()
    .replace(/\s+/g, " ");
  const nombre = formatearNombreAsesor(nombreSinCargo || sesionAsesor.nombreTemporalAsesor);

  if (!nombre) {
    return null;
  }

  return { nombre, cargo };
}

function quitarCargoAsesor(texto) {
  return String(texto || "")
    .replace(/\basesora\b/gi, "")
    .replace(/\basesor\b/gi, "");
}

function normalizarTextoAsesor(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function calcularDistanciaLevenshtein(a, b) {
  const matriz = Array.from({ length: a.length + 1 }, () => []);

  for (let i = 0; i <= a.length; i += 1) {
    matriz[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matriz[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,
        matriz[i][j - 1] + 1,
        matriz[i - 1][j - 1] + costo
      );
    }
  }

  return matriz[a.length][b.length];
}

function calcularDiferenciaCaracteres(a, b) {
  const conteos = new Map();

  for (const caracter of a) {
    conteos.set(caracter, (conteos.get(caracter) || 0) + 1);
  }

  for (const caracter of b) {
    conteos.set(caracter, (conteos.get(caracter) || 0) - 1);
  }

  return Array.from(conteos.values()).reduce((total, diferencia) => total + Math.abs(diferencia), 0);
}

function formatearNombreAsesor(nombre) {
  return String(nombre || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toLocaleUpperCase("es-EC") + parte.slice(1).toLocaleLowerCase("es-EC"))
    .join(" ");
}

async function manejarMensajePacienteAsesor(from, rawText, message) {
  if (sesionAsesor.estado !== "conectado" || from !== sesionAsesor.paciente) {
    return false;
  }

  const mensaje = (rawText || "").trim();

  if (mensaje) {
    console.log("[PACIENTE] Reenviando mensaje al asesor:", {
      paciente: from,
      asesor: sesionAsesor.asesor
    });
    await enviarMensajeTexto(sesionAsesor.asesor, `👤 Paciente:\n${mensaje}`);
    return true;
  }

  if (esMensajeMultimedia(message)) {
    console.log("[PACIENTE] Reenviando multimedia al asesor:", {
      paciente: from,
      asesor: sesionAsesor.asesor,
      tipo: message.type
    });
    await enviarMensajeTexto(sesionAsesor.asesor, "👤 Paciente envió un archivo:");
    await reenviarMensajeMultimedia(sesionAsesor.asesor, message);
  }

  return true;
}

function resetearSesionAsesor() {
  sesionAsesor = {
    paciente: null,
    asesor: ASESOR_WHATSAPP,
    nombreAsesor: null,
    cargoAsesor: null,
    nombreTemporalAsesor: null,
    estado: "libre"
  };
  console.log("[SESION] Asesor libre:", sesionAsesor);
}

async function manejarBoton(to, buttonId, messageId) {
  const accion = ACCIONES_BOTONES[buttonId];

  registrarEvento(to, "button_click", {
    messageId,
    buttonId,
    payload: {
      actionType: accion?.type || null
    }
  });

  if (!accion) {
    console.warn("[BOTON] ID no reconocido:", buttonId);
    registrarEvento(to, "invalid_message", {
      messageId,
      buttonId,
      payload: {
        reason: "unknown_button"
      }
    });
    await enviarMenu(to, "principal");
    return;
  }

  console.log("[BOTON] Accion resuelta:", accion);

  if (accion.type === "main_menu") {
    limpiarSesionesUsuario(to);
    actualizarSesionUsuario(to);
    await enviarMenu(to, "principal");
    return;
  }

  if (accion.type === "menu") {
    await enviarMenu(to, accion.menu);
    return;
  }

  if (accion.type === "catalog_areas") {
    await enviarAreasCotizacion(to);
    return;
  }

  if (accion.type === "restart_quote") {
    await reiniciarCotizacion(to, messageId);
    return;
  }

  if (accion.type === "results_request") {
    await iniciarSolicitudResultados(to, messageId);
    return;
  }

  if (accion.type === "promotions") {
    await enviarPromociones(to);
    return;
  }

  if (accion.type === "patient_location") {
    await enviarUbicacionPaciente(to);
    return;
  }

  if (accion.type === "advisor_chat") {
    await iniciarSesionAsesor(to, messageId, buttonId);
    return;
  }

  if (accion.type === "appointment_booking") {
    if (!featureHabilitada(ENABLE_APPOINTMENT_BOOKING)) {
      registrarEvento(to, "flow_completed", {
        messageId,
        buttonId,
        flowKey: buttonId,
        payload: {
          actionType: accion.type,
          enabled: false
        }
      });
      await enviarMensajeConMenuPrincipal(to, accion.text);
      return;
    }

    await manejarAgendamientoCita(to, messageId);
    return;
  }

  if (accion.type === "text_with_main_menu") {
    registrarEvento(to, "flow_completed", {
      messageId,
      buttonId,
      flowKey: buttonId,
      payload: {
        actionType: accion.type
      }
    });
    await enviarMensajeConMenuPrincipal(to, accion.text);
    return;
  }

  registrarEvento(to, "flow_completed", {
    messageId,
    buttonId,
    flowKey: buttonId,
    payload: {
      actionType: accion.type
    }
  });
  await enviarMensajeTexto(to, accion.text);
}

async function manejarAgendamientoCita(to, messageId) {
  const accion = ACCIONES_BOTONES.paciente_agendar_cita;

  registrarEvento(to, "flow_completed", {
    messageId,
    buttonId: "paciente_agendar_cita",
    flowKey: "paciente_agendar_cita",
    payload: {
      actionType: accion.type,
      enabled: true,
      stub: true
    }
  });

  await enviarMensajeConMenuPrincipal(to, accion.text);
}

async function manejarRespuestaIA(from, text, messageId) {
  registrarEvento(from, "invalid_message", {
    messageId,
    payload: {
      reason: "ai_response_stub",
      aiEnabled: true,
      stub: true,
      textLength: text.length
    }
  });

  await enviarMenu(from, "principal");
}

async function reiniciarCotizacion(from, messageId) {
  const sesion = obtenerSesionCotizacion(from);

  registrarEvento(from, "flow_completed", {
    messageId,
    buttonId: "volver_cotizar",
    flowKey: "cotizacion",
    payload: {
      action: "restart_quote"
    }
  });

  if (!sesion?.areas?.length) {
    await enviarMenu(from, "pacientes");
    return;
  }

  sesionesCotizacion.set(from, {
    paso: "esperando_area",
    areas: sesion.areas,
    timestamp: Date.now()
  });

  if (puedeUsarListaWhatsApp(sesion.areas)) {
    await enviarListaAreasCotizacion(from, sesion.areas);
    return;
  }

  await enviarMensajeTexto(from, construirMensajeAreasCotizacion(sesion.areas));
}

async function iniciarSolicitudResultados(from, messageId) {
  sesionesCotizacion.delete(from);
  sesionesResultados.set(from, {
    paso: "esperando_tipo",
    datos: {},
    timestamp: Date.now()
  });

  registrarEvento(from, "flow_completed", {
    messageId,
    buttonId: "paciente_resultados",
    flowKey: "resultados",
    payload: {
      action: "results_request_started"
    }
  });

  await enviarTipoResultado(from);
}

function obtenerSesionResultados(from) {
  return sesionesResultados.get(from) || null;
}

function estaEnFlujoResultados(from) {
  return Boolean(obtenerSesionResultados(from));
}

async function manejarFlujoResultados(from, text, buttonId, messageId) {
  const sesion = obtenerSesionResultados(from);

  if (!sesion) {
    await iniciarSolicitudResultados(from, messageId);
    return;
  }

  if (sesion.paso === "esperando_tipo") {
    await manejarTipoResultado(from, text, buttonId, messageId, sesion);
    return;
  }

  if (sesion.paso === "esperando_nombre") {
    await guardarDatoResultadosObligatorio(
      from,
      text,
      messageId,
      sesion,
      "nombreCompleto",
      "esperando_identificacion",
      "Por favor escribe la cédula o identificación del paciente."
    );
    return;
  }

  if (sesion.paso === "esperando_identificacion") {
    await guardarDatoResultadosObligatorio(
      from,
      text,
      messageId,
      sesion,
      "identificacion",
      "esperando_fecha_examen",
      "Por favor escribe la fecha aproximada del examen."
    );
    return;
  }

  if (sesion.paso === "esperando_fecha_examen") {
    await guardarDatoResultadosObligatorio(
      from,
      text,
      messageId,
      sesion,
      "fechaExamen",
      "esperando_observacion",
      "Si deseas agregar una observación, escríbela ahora. Si no, responde \"no\"."
    );
    return;
  }

  if (sesion.paso === "esperando_observacion") {
    await finalizarSolicitudResultados(from, text, messageId, sesion);
    return;
  }

  registrarEvento(from, "invalid_message", {
    messageId,
    flowKey: "resultados",
    payload: {
      reason: "unknown_results_step"
    }
  });
  sesionesResultados.delete(from);
  await enviarMenu(from, "pacientes");
}

async function manejarTipoResultado(from, text, buttonId, messageId, sesion) {
  const tipoResultado = obtenerTipoResultado(buttonId || text);

  if (!tipoResultado) {
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "resultados",
      payload: {
        reason: "invalid_results_type"
      }
    });
    await enviarTipoResultado(from);
    return;
  }

  registrarEvento(from, "button_click", {
    messageId,
    buttonId: buttonId || null,
    flowKey: "resultados",
    payload: {
      action: "select_results_type",
      tipoResultado
    }
  });

  sesionesResultados.set(from, {
    ...sesion,
    paso: "esperando_nombre",
    datos: {
      ...sesion.datos,
      tipoResultado
    },
    timestamp: Date.now()
  });

  await enviarMensajeTexto(from, "Por favor escribe el nombre completo del paciente.");
}

async function guardarDatoResultadosObligatorio(from, text, messageId, sesion, campo, siguientePaso, siguienteMensaje) {
  if (!textoValidoResultados(text)) {
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "resultados",
      payload: {
        reason: "missing_required_results_field",
        step: sesion.paso
      }
    });
    await reenviarPreguntaResultados(from, sesion.paso);
    return;
  }

  sesionesResultados.set(from, {
    ...sesion,
    paso: siguientePaso,
    datos: {
      ...sesion.datos,
      [campo]: text.trim()
    },
    timestamp: Date.now()
  });

  await enviarMensajeTexto(from, siguienteMensaje);
}

async function finalizarSolicitudResultados(from, text, messageId, sesion) {
  const observacion = esObservacionVacia(text) ? "" : text.trim();
  const datos = {
    ...sesion.datos,
    observacion
  };
  const hasObservation = Boolean(observacion);

  sesionesResultados.delete(from);
  await notificarSolicitudResultados(from, datos);

  registrarEvento(from, "flow_completed", {
    messageId,
    flowKey: "resultados",
    payload: {
      action: "results_request_completed",
      tipoResultado: datos.tipoResultado,
      hasObservation
    }
  });

  await enviarMensajeConMenuPrincipal(
    from,
    "Hemos recibido tu solicitud de resultados. Nuestro equipo revisará la información para gestionar el envío correspondiente."
  );
}

function obtenerTipoResultado(valor) {
  const normalizado = normalizarTextoResultados(valor);
  const tipos = {
    resultado_laboratorio: "laboratorio",
    laboratorio: "laboratorio",
    resultado_imagen: "imagenologia",
    imagenologia: "imagenologia",
    "imagenología": "imagenologia",
    resultado_otro: "otro",
    otro: "otro"
  };

  return tipos[normalizado] || null;
}

function textoValidoResultados(text) {
  return Boolean(text && text.trim());
}

function esObservacionVacia(text) {
  return ["no", "ninguna", "sin observación", "sin observacion"].includes(normalizarTextoResultados(text));
}

function normalizarTextoResultados(text) {
  return String(text || "").trim().toLowerCase();
}

async function reenviarPreguntaResultados(from, paso) {
  const preguntas = {
    esperando_nombre: "Por favor escribe el nombre completo del paciente.",
    esperando_identificacion: "Por favor escribe la cédula o identificación del paciente.",
    esperando_fecha_examen: "Por favor escribe la fecha aproximada del examen.",
    esperando_observacion: "Si deseas agregar una observación, escríbela ahora. Si no, responde \"no\"."
  };

  if (paso === "esperando_tipo") {
    await enviarTipoResultado(from);
    return;
  }

  await enviarMensajeTexto(from, preguntas[paso] || "Por favor comparte el dato solicitado.");
}

async function enviarTipoResultado(to) {
  await enviarBotones(to, "Selecciona el tipo de resultado:", [
    boton("resultado_laboratorio", "Laboratorio"),
    boton("resultado_imagen", "Imagenología"),
    boton("resultado_otro", "Otro")
  ]);
}

async function notificarSolicitudResultados(from, datos) {
  const message = construirMensajeInternoResultados(from, datos);
  const subject = "Nueva solicitud de resultados - Paciente";
  const resultados = await Promise.allSettled([
    enviarWhatsAppInternoResultados(message),
    enviarCorreoInternoResultados(subject, message)
  ]);
  const whatsappStatus = resultados[0].status;
  const emailStatus = resultados[1].status;

  resultados.forEach((resultado, index) => {
    if (resultado.status === "rejected") {
      console.warn("[RESULTADOS] Error en notificación interna", {
        channel: index === 0 ? "whatsapp" : "email",
        tipoResultado: datos.tipoResultado,
        hasObservation: Boolean(datos.observacion),
        fromHash: hashUsuario(from),
        message: resultado.reason?.message
      });
    }
  });

  console.log("[RESULTADOS] Notificación interna procesada", {
    tipoResultado: datos.tipoResultado,
    hasObservation: Boolean(datos.observacion),
    fromHash: hashUsuario(from),
    whatsappStatus,
    emailStatus
  });
}

function construirMensajeInternoResultados(from, datos) {
  return [
    "Nueva solicitud de resultados",
    "",
    "Tipo de solicitante: Paciente",
    "Origen: Chatbot WhatsApp FamySALUD",
    `Tipo de resultado: ${datos.tipoResultado}`,
    `Nombre del paciente: ${datos.nombreCompleto}`,
    `Identificación: ${datos.identificacion}`,
    `Fecha aproximada del examen: ${datos.fechaExamen}`,
    `Observación: ${datos.observacion || "Sin observación"}`,
    `WhatsApp del paciente: ${from}`,
    "",
    "Acción requerida: Revisar la información y gestionar manualmente el envío de resultados al paciente."
  ].join("\n");
}

async function enviarWhatsAppInternoResultados(message) {
  if (!INTERNAL_RESULTS_WHATSAPP_TO) {
    throw new Error("INTERNAL_RESULTS_WHATSAPP_TO no está configurado.");
  }

  await enviarWhatsApp({
    messaging_product: "whatsapp",
    to: INTERNAL_RESULTS_WHATSAPP_TO,
    type: "text",
    text: {
      body: message
    }
  });
}

async function enviarCorreoInternoResultados(subject, message) {
  if (!RESULTS_INTERNAL_EMAIL || !RESULTS_EMAIL_FROM || !SMTP_HOST) {
    throw new Error("Configuración SMTP incompleta.");
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number.isInteger(SMTP_PORT) ? SMTP_PORT : 587,
    secure: SMTP_SECURE,
    auth: SMTP_USER && SMTP_PASSWORD
      ? {
          user: SMTP_USER,
          pass: SMTP_PASSWORD
        }
      : undefined
  });

  await transporter.sendMail({
    from: RESULTS_EMAIL_FROM,
    to: RESULTS_INTERNAL_EMAIL,
    subject,
    text: message
  });
}

function debeMostrarMenu(text) {
  if (!text) {
    return true;
  }

  return debeResetearConversacion(text);
}

function debeResetearConversacion(text) {
  return ["hola", "menu", "menú", "inicio"].includes(text);
}

function sesionExpirada(sesion) {
  return !sesion?.timestamp || Date.now() - sesion.timestamp > SESION_USUARIO_TTL_MS;
}

function obtenerSesionUsuario(from) {
  return sesionesUsuarios.get(from) || null;
}

function actualizarSesionUsuario(from, opciones = {}) {
  const { generarNuevaSesion = true } = opciones;
  const sesionActual = obtenerSesionUsuario(from);
  const sessionId = sesionActual?.sessionId || (generarNuevaSesion ? generarSessionId() : null);

  sesionesUsuarios.set(from, {
    timestamp: Date.now(),
    sessionId
  });
  sesionesExpiradas.delete(from);
  programarExpiracionSesion(from);
}

function limpiarSesionesUsuario(from) {
  sesionesUsuarios.delete(from);
  sesionesCotizacion.delete(from);
  sesionesResultados.delete(from);
  sesionesExpiradas.delete(from);
  cancelarExpiracionSesion(from);
}

function programarExpiracionSesion(from) {
  cancelarExpiracionSesion(from);

  const timer = setTimeout(() => {
    expirarSesionUsuario(from);
  }, SESION_USUARIO_TTL_MS);

  temporizadoresSesion.set(from, timer);
}

function cancelarExpiracionSesion(from) {
  const timer = temporizadoresSesion.get(from);

  if (timer) {
    clearTimeout(timer);
    temporizadoresSesion.delete(from);
  }
}

async function expirarSesionUsuario(from) {
  const sesion = obtenerSesionUsuario(from);

  if (!sesion || sesionesExpiradas.has(from)) {
    return;
  }

  const sessionId = sesion.sessionId;
  sesionesUsuarios.delete(from);
  sesionesCotizacion.delete(from);
  sesionesResultados.delete(from);
  cancelarExpiracionSesion(from);
  sesionesExpiradas.add(from);
  console.log("[SESION] Expirada", { from });
  if (sessionId) {
    registrarEvento(from, "session_expired", { sessionId });
  }

  try {
    await enviarMensajeTexto(
      from,
      "⏳ Tu sesión anterior expiró por inactividad.\n\nTe mostramos nuevamente el menú principal 😊"
    );
    await enviarMenu(from, "principal");
  } catch (error) {
    console.error("[SESION] Error enviando expiracion:", error.response?.data || error.message);
  }
}

function sesionUsuarioActiva(from) {
  const sesion = obtenerSesionUsuario(from);
  return Boolean(sesion && !sesionExpirada(sesion));
}

function consumirMarcaSesionExpirada(from) {
  if (!sesionesExpiradas.has(from)) {
    return false;
  }

  sesionesExpiradas.delete(from);
  return true;
}

function consumirSesionUsuarioExpirada(from) {
  const sesion = obtenerSesionUsuario(from);

  if (!sesion || !sesionExpirada(sesion)) {
    return false;
  }

  const sessionId = sesion.sessionId;
  sesionesUsuarios.delete(from);
  sesionesCotizacion.delete(from);
  sesionesResultados.delete(from);
  cancelarExpiracionSesion(from);
  console.log("[SESION] Expirada", { from });
  if (sessionId) {
    registrarEvento(from, "session_expired", { sessionId });
  }

  return true;
}

function obtenerSesionCotizacion(from) {
  return sesionesCotizacion.get(from) || null;
}

function estaEsperandoAreaCotizacion(from) {
  return obtenerSesionCotizacion(from)?.paso === "esperando_area";
}

function estaEsperandoServicioCotizacion(from) {
  return obtenerSesionCotizacion(from)?.paso === "esperando_servicio";
}

function esNumero(text) {
  return /^\d+$/.test(text);
}

function extraerMensaje(body) {
  return body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
}

function extraerTexto(message) {
  return message.text?.body?.trim().toLowerCase() || "";
}

function extraerTextoOriginal(message) {
  return message.text?.body?.trim() || "";
}

function extraerButtonReplyId(message) {
  return message.interactive?.button_reply?.id || "";
}

function extraerListReplyId(message) {
  return message.interactive?.list_reply?.id || "";
}

function boton(id, title) {
  return {
    type: "reply",
    reply: {
      id,
      title
    }
  };
}

function botonMenuPrincipal() {
  return boton("main_menu", "🏠 Menú principal");
}

function botonVolverCotizar() {
  return boton("volver_cotizar", "Volver a cotizar");
}

async function consultarCatalogoServicios() {
  if (!CHATBOT_CATALOG_URL) {
    throw new Error("CHATBOT_CATALOG_URL no esta configurada.");
  }

  const now = Date.now();

  if (catalogoServiciosCache && now - catalogoServiciosCacheTimestamp <= CATALOG_CACHE_TTL_MS) {
    console.log("[CATALOGO] Usando cache", {
      ageMs: now - catalogoServiciosCacheTimestamp
    });
    return catalogoServiciosCache;
  }

  try {
    console.log("[CATALOGO] Consultando API.");

    const response = await axios.get(CHATBOT_CATALOG_URL, {
      timeout: 10000
    });

    catalogoServiciosCache = response.data;
    catalogoServiciosCacheTimestamp = Date.now();

    console.log("[CATALOGO] Catalogo recibido:", {
      status: response.status,
      areas: Array.isArray(response.data?.areas) ? response.data.areas.length : 0,
      updated_at: response.data?.updated_at
    });

    return response.data;
  } catch (error) {
    if (catalogoServiciosCache) {
      console.warn("[CATALOGO] Usando cache anterior por error", {
        message: error.message,
        status: error.response?.status
      });
      return catalogoServiciosCache;
    }

    console.error("[CATALOGO] Error sin cache disponible", {
      message: error.message,
      status: error.response?.status
    });
    throw error;
  }
}

function extraerAreasCatalogo(catalogo) {
  if (!Array.isArray(catalogo?.areas)) {
    console.warn("[CATALOGO] La respuesta no contiene un arreglo de areas.");
    return [];
  }

  const areasPorTitulo = new Map();

  for (const area of catalogo.areas) {
    const title = typeof area?.title === "string" ? area.title.trim() : "";

    if (!title || areasPorTitulo.has(title)) {
      continue;
    }

    areasPorTitulo.set(title, {
      id: area.id,
      title,
      services: Array.isArray(area.services) ? area.services : []
    });
  }

  return Array.from(areasPorTitulo.values());
}

function construirMensajeAreasCotizacion(areas) {
  const listadoAreas = areas
    .map((area, index) => `${index + 1}. ${area.title}`)
    .join("\n");

  return `Estas son nuestras areas de atencion disponibles para cotizar:

${listadoAreas}

Responde con el numero del area para ver sus servicios.`;
}

function obtenerIndiceDesdeTexto(text) {
  if (!esNumero(text)) {
    return null;
  }

  const numero = Number.parseInt(text, 10);

  if (!Number.isInteger(numero) || numero < 1) {
    return null;
  }

  return numero - 1;
}

function construirIdListaCotizacion(tipo, index) {
  return `cot_${tipo}_${index}`;
}

function construirIdVolverServicioCotizacion() {
  return "cot_servicio_back";
}

function esIdVolverServicioCotizacion(listReplyId) {
  return listReplyId === construirIdVolverServicioCotizacion();
}

function obtenerIndiceDesdeListReplyId(listReplyId, tipo) {
  const prefix = `cot_${tipo}_`;

  if (!listReplyId.startsWith(prefix)) {
    return null;
  }

  const index = Number.parseInt(listReplyId.slice(prefix.length), 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function obtenerIndiceSeleccionCotizacion(valor, tipo, origen) {
  if (origen === "list") {
    return obtenerIndiceDesdeListReplyId(valor, tipo);
  }

  return obtenerIndiceDesdeTexto(valor);
}

function puedeUsarListaWhatsApp(opciones) {
  return Array.isArray(opciones) && opciones.length > 0 && opciones.length <= MAX_OPCIONES_LISTA_WHATSAPP;
}

function truncarTextoLista(text) {
  const valor = String(text || "").trim();

  if (valor.length <= MAX_TITULO_FILA_LISTA) {
    return valor;
  }

  return valor.slice(0, MAX_TITULO_FILA_LISTA - 1).trimEnd();
}

function extraerServiciosArea(area) {
  if (!Array.isArray(area?.services)) {
    return [];
  }

  return area.services
    .map((service) => ({
      id: service.id,
      title: typeof service?.title === "string" ? service.title.trim() : "",
      price: service.price,
      sale_price: service.sale_price,
      excerpt: typeof service?.excerpt === "string" ? service.excerpt.trim() : "",
      is_presential: Boolean(service.is_presential),
      is_virtual: Boolean(service.is_virtual)
    }))
    .filter((service) => service.title);
}

function construirMensajeServiciosCotizacion(area, servicios) {
  const listadoServicios = servicios
    .map((servicio, index) => `${index + 1}. ${servicio.title}`)
    .join("\n");

  return `Estos son los servicios disponibles en ${area.title}:

${listadoServicios}

Responde con el numero del servicio que deseas consultar.`;
}

async function enviarListaAreasCotizacion(to, areas) {
  const rows = areas.map((area, index) => ({
    id: construirIdListaCotizacion("area", index),
    title: truncarTextoLista(area.title)
  }));

  await enviarListaWhatsApp(to, "Estas son nuestras areas de atencion disponibles para cotizar:", "Ver areas", [
    {
      title: "Areas disponibles",
      rows
    }
  ]);

  registrarEvento(to, "menu_opened", {
    flowKey: "cotizacion_area",
    payload: {
      interactionType: "list",
      totalOptions: areas.length
    }
  });
}

async function enviarListaServiciosCotizacion(to, area, servicios) {
  const rows = servicios.map((servicio, index) => ({
    id: construirIdListaCotizacion("servicio", index),
    title: truncarTextoLista(servicio.title)
  }));

  if (servicios.length <= MAX_OPCIONES_LISTA_WHATSAPP - 1) {
    rows.push({
      id: construirIdVolverServicioCotizacion(),
      title: "Volver atrás"
    });
  }

  await enviarListaWhatsApp(to, `Estos son los servicios disponibles en ${area.title}:`, "Ver servicios", [
    {
      title: "Servicios",
      rows
    }
  ]);

  registrarEvento(to, "menu_opened", {
    flowKey: "cotizacion_servicio",
    payload: {
      interactionType: "list",
      totalOptions: servicios.length
    }
  });
}

function formatearPrecio(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return "Disponible con asesor";
  }

  const numero = Number(valor);

  if (!Number.isFinite(numero)) {
    return "Disponible con asesor";
  }

  return `$${numero}`;
}

function tienePromocion(servicio) {
  if (servicio.sale_price === null || servicio.sale_price === undefined || servicio.sale_price === "") {
    return false;
  }

  return Number(servicio.sale_price) !== Number(servicio.price);
}

function construirTextoModalidad(servicio) {
  if (servicio.is_presential && servicio.is_virtual) {
    return "🩺 Modalidad:\n• Presencial\n• Virtual";
  }

  if (servicio.is_presential) {
    return "🩺 Modalidad:\n• Presencial";
  }

  if (servicio.is_virtual) {
    return "🩺 Modalidad:\n• Virtual";
  }

  return "🩺 Modalidad:\nInformación de modalidad disponible con un asesor.";
}

function construirMensajeDetalleServicio(servicio) {
  const bloques = [
    `📌 Servicio: ${servicio.title}`,
    `💲 Precio: ${formatearPrecio(servicio.price)}`
  ];

  if (tienePromocion(servicio)) {
    bloques.push(`🏷️ Promoción: ${formatearPrecio(servicio.sale_price)}`);
  }

  bloques.push(construirTextoModalidad(servicio));

  if (servicio.excerpt) {
    bloques.push(`📝 ${servicio.excerpt}`);
  }

  bloques.push(`📲 ¿Necesitas ayuda personalizada?
Si no encuentras el servicio que necesitas, nuestro equipo puede ayudarte:

wa.me/593939034743
☎️ 0939034743`);

  return bloques.join("\n\n");
}

async function manejarSeleccionListaCotizacion(from, listReplyId, messageId) {
  if (esIdVolverServicioCotizacion(listReplyId)) {
    await volverDesdeServiciosCotizacion(from, messageId);
    return;
  }

  if (estaEsperandoAreaCotizacion(from)) {
    await manejarSeleccionAreaCotizacion(from, listReplyId, messageId, "list");
    return;
  }

  if (estaEsperandoServicioCotizacion(from)) {
    await manejarSeleccionServicioCotizacion(from, listReplyId, messageId, "list");
    return;
  }

  registrarEvento(from, "invalid_message", {
    messageId,
    payload: {
      reason: "unexpected_list_reply",
      listReplyId
    }
  });
  await enviarMenu(from, "principal");
}

async function volverDesdeServiciosCotizacion(from, messageId) {
  const sesion = obtenerSesionCotizacion(from);

  registrarEvento(from, "button_click", {
    messageId,
    buttonId: construirIdVolverServicioCotizacion(),
    flowKey: "cotizacion_servicio",
    payload: {
      action: "back",
      to: "cotizacion_area"
    }
  });

  if (!sesion?.areas?.length) {
    sesionesCotizacion.delete(from);
    await enviarMenu(from, "pacientes");
    return;
  }

  sesionesCotizacion.set(from, {
    paso: "esperando_area",
    areas: sesion.areas,
    timestamp: Date.now()
  });

  if (puedeUsarListaWhatsApp(sesion.areas)) {
    await enviarListaAreasCotizacion(from, sesion.areas);
    return;
  }

  await enviarMensajeTexto(from, construirMensajeAreasCotizacion(sesion.areas));
}

async function manejarSeleccionAreaCotizacion(from, text, messageId, origen = "text") {
  const sesion = obtenerSesionCotizacion(from);
  const indiceArea = obtenerIndiceSeleccionCotizacion(text, "area", origen);
  const areaSeleccionada = indiceArea === null ? null : sesion?.areas?.[indiceArea];

  if (!areaSeleccionada) {
    console.warn("[COTIZACION] Numero de area invalido:", {
      from,
      text,
      totalAreas: sesion?.areas?.length || 0
    });
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "cotizacion_area",
      payload: {
        reason: "invalid_area_number",
        interactionType: origen,
        text,
        totalAreas: sesion?.areas?.length || 0
      }
    });
    await enviarMensajeTexto(from, "Por favor selecciona un numero valido del listado.");
    return;
  }

  const servicios = extraerServiciosArea(areaSeleccionada);

  console.log("[COTIZACION] Area seleccionada:", {
    from,
    areaId: areaSeleccionada.id,
    areaTitle: areaSeleccionada.title,
    totalServicios: servicios.length
  });

  if (origen === "list") {
    registrarEvento(from, "button_click", {
      messageId,
      buttonId: text,
      flowKey: "cotizacion_area",
      payload: {
        interactionType: "list",
        selectedIndex: indiceArea,
        areaId: areaSeleccionada.id,
        areaTitle: areaSeleccionada.title
      }
    });
  }

  if (servicios.length === 0) {
    await enviarMensajeTexto(
      from,
      `En este momento no encontramos servicios disponibles en ${areaSeleccionada.title}. Por favor selecciona otra area del listado.`
    );
    return;
  }

  sesionesCotizacion.set(from, {
    paso: "esperando_servicio",
    areas: sesion.areas,
    areaSeleccionada,
    servicios,
    timestamp: Date.now()
  });

  if (puedeUsarListaWhatsApp(servicios)) {
    await enviarListaServiciosCotizacion(from, areaSeleccionada, servicios);
    return;
  }

  await enviarMensajeTexto(from, construirMensajeServiciosCotizacion(areaSeleccionada, servicios));
}

async function manejarSeleccionServicioCotizacion(from, text, messageId, origen = "text") {
  const sesion = obtenerSesionCotizacion(from);
  const indiceServicio = obtenerIndiceSeleccionCotizacion(text, "servicio", origen);
  const servicioSeleccionado = indiceServicio === null ? null : sesion?.servicios?.[indiceServicio];

  if (!servicioSeleccionado) {
    console.warn("[COTIZACION] Numero de servicio invalido:", {
      from,
      text,
      totalServicios: sesion?.servicios?.length || 0
    });
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "cotizacion_servicio",
      payload: {
        reason: "invalid_service_number",
        interactionType: origen,
        text,
        totalServicios: sesion?.servicios?.length || 0
      }
    });
    await enviarMensajeTexto(from, "Por favor selecciona un numero valido del listado de servicios.");
    return;
  }

  console.log("[COTIZACION] Servicio seleccionado:", {
    from,
    servicioId: servicioSeleccionado.id,
    servicioTitle: servicioSeleccionado.title
  });

  if (origen === "list") {
    registrarEvento(from, "button_click", {
      messageId,
      buttonId: text,
      flowKey: "cotizacion_servicio",
      payload: {
        interactionType: "list",
        selectedIndex: indiceServicio,
        areaId: sesion?.areaSeleccionada?.id,
        areaTitle: sesion?.areaSeleccionada?.title,
        servicioId: servicioSeleccionado.id,
        servicioTitle: servicioSeleccionado.title
      }
    });
  }

  sesionesCotizacion.set(from, {
    ...sesion,
    servicioSeleccionado,
    timestamp: Date.now()
  });

  registrarEvento(from, "flow_completed", {
    messageId,
    flowKey: "cotizacion",
    payload: {
      areaId: sesion?.areaSeleccionada?.id,
      areaTitle: sesion?.areaSeleccionada?.title,
      servicioId: servicioSeleccionado.id,
      servicioTitle: servicioSeleccionado.title
    }
  });
  await enviarDetalleServicioConOpciones(from, construirMensajeDetalleServicio(servicioSeleccionado));
}

async function enviarAreasCotizacion(to) {
  try {
    const catalogo = await consultarCatalogoServicios();
    const areas = extraerAreasCatalogo(catalogo);

    if (areas.length === 0) {
      console.warn("[CATALOGO] No se encontraron areas disponibles para cotizar.");
      await enviarMensajeTexto(to, mensajeErrorCatalogo());
      return;
    }

    sesionesCotizacion.set(to, {
      paso: "esperando_area",
      areas,
      timestamp: Date.now()
    });

    console.log("[CATALOGO] Areas disponibles enviadas:", {
      to,
      totalAreas: areas.length
    });

    if (puedeUsarListaWhatsApp(areas)) {
      await enviarListaAreasCotizacion(to, areas);
      return;
    }

    await enviarMensajeTexto(to, construirMensajeAreasCotizacion(areas));
  } catch (error) {
    console.error("[CATALOGO] Error al cargar catalogo:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });

    await enviarMensajeTexto(to, mensajeErrorCatalogo());
  }
}

function mensajeErrorCatalogo() {
  return "En este momento no pudimos cargar el catalogo de servicios para cotizar. Por favor comunicate con un asesor de FamySALUD y con gusto te ayudaremos.";
}

async function enviarMenu(to, menuKey) {
  const menu = MENUS[menuKey];

  if (!menu) {
    console.warn("[MENU] Menu no encontrado:", menuKey);
    await enviarMenu(to, "principal");
    return;
  }

  console.log("[MENU] Enviando:", menuKey);
  await enviarBotones(to, menu.text, menu.buttons);
  registrarEvento(to, "menu_opened", { menuKey });
}

async function enviarBotones(to, bodyText, buttons) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: bodyText
      },
      action: {
        buttons
      }
    }
  };

  await enviarWhatsApp(payload);
}

async function enviarListaWhatsApp(to, bodyText, buttonText, sections) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: bodyText
      },
      action: {
        button: buttonText,
        sections
      }
    }
  };

  await enviarWhatsApp(payload);
}

async function enviarUbicacionWhatsApp(to, ubicacion) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude: ubicacion.latitude,
      longitude: ubicacion.longitude,
      name: ubicacion.name,
      address: ubicacion.address
    }
  };

  await enviarWhatsApp(payload);
}

async function subirMediaWhatsAppDesdeArchivo(relativePath, mimeType) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("[CONFIG] Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID para subir media.");
    return null;
  }

  if (typeof FormData === "undefined" || typeof Blob === "undefined") {
    throw new Error("FormData o Blob no estan disponibles en esta version de Node.js.");
  }

  const absolutePath = path.resolve(__dirname, relativePath);
  const fileBuffer = await fs.promises.readFile(absolutePath);
  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("file", new Blob([fileBuffer], { type: mimeType }), path.basename(absolutePath));

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/media`;
  const response = await axios.post(url, formData, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });

  return response.data?.id || null;
}

async function enviarImagenLocalWhatsApp(to, relativePath, caption) {
  try {
    const mediaId = await subirMediaWhatsAppDesdeArchivo(relativePath, "image/png");

    if (!mediaId) {
      return;
    }

    await enviarWhatsApp({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        id: mediaId,
        caption
      }
    });
  } catch (error) {
    console.warn("[MEDIA] No se pudo enviar imagen local:", error.message);
  }
}

async function enviarMensajeConMenuPrincipal(to, message) {
  await enviarBotones(to, message, [botonMenuPrincipal()]);
}

async function enviarPromociones(to) {
  await enviarBotones(
    to,
    `🎉 ¡Tenemos promociones para ti!

En FamySALUD contamos con promociones y campañas especiales en diferentes servicios médicos para nuestros pacientes 💙

Puedes revisarlas aquí:
${PROMOCIONES_URL}`,
    [botonMenuPrincipal()]
  );
}

async function enviarUbicacionPaciente(to) {
  await enviarMensajeTexto(
    to,
    `📍 ¡Será un gusto recibirte en FamySALUD!

Nos encontramos ubicados en:

Quisquis 1109 y José Mascote
Guayaquil, Ecuador

Aquí te compartimos nuestra ubicación para que puedas llegar fácilmente 💙`
  );

  await enviarUbicacionWhatsApp(to, UBICACION_FAMYSALUD);
  await enviarImagenLocalWhatsApp(to, UBICACION_FAMYSALUD.croquisPath, "🗺️ Croquis de referencia");
  await enviarBotones(to, "¿Necesitas algo más? Puedes volver al menú principal.", [botonMenuPrincipal()]);
}

async function enviarDetalleServicioConOpciones(to, message) {
  await enviarBotones(to, message, [botonVolverCotizar(), botonMenuPrincipal()]);
}

async function enviarMensajeTexto(to, message) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: message
    }
  };

  await enviarWhatsApp(payload);
}

function esMensajeMultimedia(message) {
  return ["image", "video", "audio", "document", "sticker"].includes(message?.type);
}

async function reenviarMensajeMultimedia(destino, message) {
  const tipo = message?.type;

  if (!esMensajeMultimedia(message)) {
    return false;
  }

  const media = message[tipo];

  if (!media || !media.id) {
    console.log("[MEDIA] Mensaje multimedia sin media id:", { tipo });
    return false;
  }

  const payload = {
    messaging_product: "whatsapp",
    to: destino,
    type: tipo,
    [tipo]: {
      id: media.id
    }
  };

  if ((tipo === "image" || tipo === "video" || tipo === "document") && media.caption) {
    payload[tipo].caption = media.caption;
  }

  if (tipo === "document" && media.filename) {
    payload.document.filename = media.filename;
  }

  console.log("[MEDIA] Reenviando multimedia:", {
    tipo,
    destino
  });

  await enviarWhatsApp(payload);
  return true;
}

async function enviarWhatsApp(payload) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("[CONFIG] Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en las variables de entorno.");
    return;
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  console.log("[WHATSAPP] Enviando respuesta:", {
    to: payload.to,
    type: payload.type
  });

  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
}

app.listen(PORT, () => {
  console.log(`[SERVIDOR] Escuchando en el puerto ${PORT}`);
  console.log(`[CONFIG] Entorno: ${APP_ENV}`);
  console.log(`[CONFIG] Agendamiento habilitado: ${featureHabilitada(ENABLE_APPOINTMENT_BOOKING)}`);
  console.log(`[CONFIG] IA habilitada: ${featureHabilitada(ENABLE_AI_RESPONSES)}`);
});
