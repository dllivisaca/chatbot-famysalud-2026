require("dotenv").config();

const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Guayaquil";
process.env.TZ = process.env.TZ || APP_TIMEZONE;

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const {
  insertarEvento,
  obtenerAreasAgendables,
  obtenerServiciosAgendablesPorArea,
  obtenerProfesionalesAgendablesPorServicio,
  guardarPacienteEnColaAsesor,
  eliminarPacienteDeColaAsesor,
  guardarSesionAsesorPersistida,
  finalizarSesionAsesorPersistida,
  obtenerEstadoAsesoresPersistido,
  guardarSesionAgendamientoPersistida,
  eliminarSesionAgendamientoPersistida,
  obtenerSesionesAgendamientoPersistidas,
  obtenerHoldsActivosAgendamiento,
  crearHoldAgendamientoPersistido,
  liberarHoldAgendamientoPersistido,
  obtenerFeriadosPendientesRecordatorio,
  marcarRecordatorioFeriadoEnviado,
  obtenerConfirmacionFeriadoPendiente,
  actualizarConfirmacionHorarioEspecial,
  marcarEsperandoHorarioParcial,
  actualizarHorarioParcialFeriado,
  obtenerHorarioEspecialConfirmadoPorFecha
} = require("./db");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const CHATBOT_CATALOG_URL = process.env.CHATBOT_CATALOG_URL;
const CHATBOT_CATALOG_BASE_URL = process.env.CHATBOT_CATALOG_BASE_URL;
const CHATBOT_CATALOG_PATH = process.env.CHATBOT_CATALOG_PATH;
const APPWEB_API_BASE_URL = process.env.APPWEB_API_BASE_URL || "https://app.famysaludec.com";
const APPWEB_CHATBOT_API_KEY = process.env.APPWEB_CHATBOT_API_KEY;
const EVENT_HASH_SALT = process.env.EVENT_HASH_SALT || "";
const APP_ENV = process.env.APP_ENV || "production";
const ENABLE_APPOINTMENT_BOOKING = flagActiva(process.env.ENABLE_APPOINTMENT_BOOKING);
const APPOINTMENT_ALLOWED_PHONES = (process.env.APPOINTMENT_ALLOWED_PHONES || "0990043768,+593990043768")
  .split(",")
  .map(normalizarNumeroWhatsApp)
  .filter(Boolean);
const ENABLE_AI_RESPONSES = flagActiva(process.env.ENABLE_AI_RESPONSES);
const INTERNAL_NOTIFICATION_EMAIL = process.env.INTERNAL_NOTIFICATION_EMAIL || process.env.RESULTS_INTERNAL_EMAIL;
const INTERNAL_EMAIL_FROM = process.env.INTERNAL_EMAIL_FROM || process.env.RESULTS_EMAIL_FROM;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_SECURE = flagActiva(process.env.SMTP_SECURE);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const WHATSAPP_API_VERSION = "v20.0";
const WHATSAPP_REQUEST_TIMEOUT_MS_CONFIG = Number.parseInt(process.env.WHATSAPP_REQUEST_TIMEOUT_MS || "15000", 10);
const WHATSAPP_REQUEST_TIMEOUT_MS = Number.isInteger(WHATSAPP_REQUEST_TIMEOUT_MS_CONFIG) && WHATSAPP_REQUEST_TIMEOUT_MS_CONFIG > 0
  ? WHATSAPP_REQUEST_TIMEOUT_MS_CONFIG
  : 15000;
const SESSION_TTL_MINUTES = Number.parseInt(process.env.SESSION_TTL_MINUTES || "15", 10);
const SESION_USUARIO_TTL_MS = (Number.isInteger(SESSION_TTL_MINUTES) && SESSION_TTL_MINUTES > 0
  ? SESSION_TTL_MINUTES
  : 15) * 60 * 1000;
const CATALOG_CACHE_TTL_MINUTES = Number.parseInt(process.env.CATALOG_CACHE_TTL_MINUTES || "10", 10);
const CATALOG_CACHE_TTL_MS = (Number.isInteger(CATALOG_CACHE_TTL_MINUTES) && CATALOG_CACHE_TTL_MINUTES > 0
  ? CATALOG_CACHE_TTL_MINUTES
  : 10) * 60 * 1000;
const CATALOG_CACHE_DIR = path.join(__dirname, "data");
const CATALOG_CACHE_FILE = path.join(CATALOG_CACHE_DIR, "catalogo-servicios.json");
const MENSAJES_PROCESADOS_TTL_MS = 24 * 60 * 60 * 1000;
const AGENDAMIENTO_HOLD_TTL_MS = 20 * 60 * 1000;
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
const sesionesAgendamiento = new Map();
const sesionesResultados = new Map();
const sesionesResultadosEmpresas = new Map();
const sesionesProveedor = new Map();
const sesionesAlianza = new Map();
const mensajesProcesados = new Map();
const temporizadoresSesion = new Map();
const sesionesExpiradas = new Set();
const ASESOR_WHATSAPP_PRINCIPAL = process.env.ASESOR_WHATSAPP_PRINCIPAL || "593939034743";
const ASESOR_WHATSAPP_SECUNDARIO = process.env.ASESOR_WHATSAPP_SECUNDARIO || "593939867396";
const ASESORES_WHATSAPP = [
  { id: "principal", phone: ASESOR_WHATSAPP_PRINCIPAL },
  { id: "secundario", phone: ASESOR_WHATSAPP_SECUNDARIO }
].filter((asesor) => Boolean(asesor.phone));
const ZONA_HORARIA_ASESOR = APP_TIMEZONE;
const MENSAJE_ASESOR_FUERA_HORARIO = `🕒 En este momento no estamos en horario de atención con asesores por WhatsApp.

Puedes seguir usando el menú automático para consultar información disponible por aquí.

Los horarios de asesores por WhatsApp pueden ser distintos a la atención presencial o a los servicios médicos del centro.

Nuestro horario de atención con asesores por WhatsApp es:
Lun-Vie: 7:30 AM - 5:30 PM
Sáb: 8:00 AM - 12:30 PM

Te esperamos en el siguiente horario laboral 💙`;
const INTERVALO_REVISION_FERIADOS_MS = 60 * 1000;
const TIEMPO_EXPIRACION_ASESOR_MS = 10 * 60 * 1000;
const TIEMPO_ACEPTACION_ASESOR_MS = 3 * 60 * 1000;
const TIEMPO_EXPIRACION_PROVEEDOR_MS = 15 * 60 * 1000;
const colaEsperaAsesor = [];
const temporizadoresSesionAsesor = new Map();
const temporizadoresAceptacionAsesor = new Map();
const persistenciasAsesorPendientes = new Map();
const persistenciasAgendamientoPendientes = new Map();
const NUMEROS_INTERNOS = [
  ...ASESORES_WHATSAPP.map((asesor) => asesor.phone)
];
const ASESORES_REGISTRADOS = {
  jennifer: { nombre: "Jennifer", cargo: "asesora" },
  yadira: { nombre: "Yadira", cargo: "asesora" },
  daisy: { nombre: "Daisy", cargo: "asesora" },
  david: { nombre: "David", cargo: "asesor" }
};
const sesionesAsesores = new Map(ASESORES_WHATSAPP.map((asesor) => [
  asesor.id,
  crearSesionAsesorLibre(asesor)
]));
let catalogoServiciosCache = null;
let catalogoServiciosCacheTimestamp = 0;
let catalogoServiciosRefreshInterval = null;
let feriadosRevisionInterval = null;
let feriadosRevisionEnCurso = false;
let ultimaRevisionRecordatorioFeriados = null;

function flagActiva(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function normalizarNumeroWhatsApp(numero) {
  const soloDigitos = String(numero || "")
    .replace(/@.+$/, "")
    .replace(/\D/g, "");

  return soloDigitos ? `+${soloDigitos}` : "";
}

function puedeUsarAgendamiento(numeroUsuario) {
  return featureHabilitada(ENABLE_APPOINTMENT_BOOKING)
    && APPOINTMENT_ALLOWED_PHONES.includes(normalizarNumeroWhatsApp(numeroUsuario));
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

  const evento = {
    event_type: eventType,
    user_hash: hashUsuario(from),
    session_id: datos.sessionId || obtenerSessionId(from),
    message_id: datos.messageId,
    button_id: datos.buttonId,
    menu_key: datos.menuKey,
    flow_key: datos.flowKey,
    payload: datos.payload
  };

  console.log("[EVENTO] Antes de insertar evento:", {
    eventType,
    sessionId: evento.session_id,
    messageId: evento.message_id,
    flowKey: evento.flow_key
  });

  const startedAt = Date.now();

  insertarEvento(evento)
    .then(() => {
      console.log("[EVENTO] Despues de insertar evento:", {
        eventType,
        sessionId: evento.session_id
      });
    })
    .catch((error) => {
      console.error("[EVENTO] Error registrando evento:", construirDetalleErrorLog(error, {
        eventType,
        action: "registrarEvento",
        elapsedMs: Date.now() - startedAt
      }));
    });
}

function construirDetalleErrorLog(error, contexto = {}) {
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

function obtenerFlowKeyAsesor(origen = "paciente") {
  if (origen === "alianza_existente") return "alianza_existente_hablar_asesor";
  if (origen === "alianza_potencial") return "alianza_potencial_hablar_asesor";
  if (origen === "proveedor_existente") return "proveedor_existente_hablar_asesor";
  if (origen === "proveedor") return "proveedor_hablar_asesor";
  if (origen === "empresa") return "empresa_hablar_asesor";
  return "paciente_hablar_asesor";
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
  trabaja: `💙 ¡Qué gusto saber que te gustaría formar parte de FamySALUD!

Nos encanta conocer personas con ganas de crecer y aportar con su talento.

Para dejarnos tu hoja de vida, por favor completa este formulario:

https://forms.gle/eNZiXpEhxiauh5hE8

Si tu perfil encaja con alguna vacante abierta, podremos contactarte a través de los datos que nos compartas.

Y si en este momento no tenemos una oportunidad disponible para tu perfil, igual guardaremos tu CV para futuros procesos 😊`
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
      boton("main_proveedores", "Proveedores"),
      boton("main_alianzas", "Alianzas estratég."),
      boton("main_trabaja", "Trabaja con nosotros")
    ]
  },
  proveedoresEntrada: {
    text: `Área de proveedores

Selecciona una opción para continuar:`,
    buttons: [
      boton("main_proveedor", "Quiero ser proveedor"),
      boton("proveedor_existente", "Ya soy proveedor"),
      botonMenuPrincipal()
    ]
  },
  proveedorExistente: {
    text: `Gracias por comunicarte con FamySALUD.

Si ya eres proveedor, puedes dejar una solicitud o comunicarte con un asesor.`,
    buttons: [
      boton("proveedor_existente_solicitud", "Dejar solicitud"),
      boton("proveedor_existente_asesor", "Hablar con asesor"),
      botonMenuPrincipal()
    ]
  },
  alianzasEntrada: {
    text: `Alianzas estratégicas

Selecciona una opción para continuar:`,
    buttons: [
      boton("main_alianza", "Quiero una alianza"),
      boton("alianza_existente", "Ya soy aliado"),
      botonMenuPrincipal()
    ]
  },
  alianzaExistente: {
    text: `Gracias por comunicarte con FamySALUD.

Si ya eres aliado estratégico, puedes dejar una solicitud o comunicarte con un asesor.`,
    buttons: [
      boton("alianza_existente_solicitud", "Dejar solicitud"),
      boton("alianza_existente_asesor", "Hablar con asesor"),
      botonMenuPrincipal()
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
      boton("empresa_solicitar_resultados", "Solicitar resultados"),
      boton("empresa_ubicacion", "Ubicación"),
      boton("empresa_mas_opciones_2", "Más opciones")
    ]
  },
  empresasMasOpciones2: {
    text: "Elige una opción:",
    buttons: [
      boton("empresa_horarios", "Horarios"),
      boton("empresa_hablar_asesor", "Hablar con asesor")
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
      boton("proveedor_hablar_asesor", "Hablar con asesor")
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
  main_proveedores: { type: "menu", menu: "proveedoresEntrada" },
  main_proveedor: { type: "menu", menu: "proveedores" },
  main_alianzas: { type: "menu", menu: "alianzasEntrada" },
  main_alianza: { type: "menu", menu: "alianzas" },
  main_trabaja: { type: "text_with_main_menu", text: TEXTOS.trabaja },
  volver_cotizar: { type: "restart_quote" },
  agendamiento_volver: { type: "appointment_back" },

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
  paciente_hablar_asesor: { type: "advisor_chat", origen: "paciente" },
  paciente_asesor: { type: "text", text: "En breve te comunicaremos con un asesor de FamySALUD." },

  empresa_salud_ocupacional: { type: "text_with_main_menu", text: `🏢 Gracias por tu interés en nuestros servicios de Salud Ocupacional.

En FamySALUD acompañamos a empresas e instituciones con atención médica preventiva, evaluaciones ocupacionales y servicios enfocados en el bienestar de sus colaboradores.

Puedes conocer más sobre lo que ofrecemos aquí:

🌐 Página principal:
https://www.famysalud.com.ec/salud-ocupacional

📄 Información adicional:
https://www.famysalud.com.ec/web/paginas/salud-ocupacional

Será un gusto ayudarte 💙` },
  empresa_cotizar: { type: "text_with_main_menu", text: `📋 ¡Gracias por tu interés en cotizar nuestros servicios para empresas!

En FamySALUD estaremos encantados de ayudarte a encontrar la opción que mejor se adapte a las necesidades de tu empresa o institución.

Puedes solicitar una cotización rápida aquí:
https://forms.gle/HexK4xYrMWCgWoi18

Nuestro equipo revisará la información y se comunicará contigo lo antes posible 💙` },
  empresa_mas_opciones_1: { type: "menu", menu: "empresasMasOpciones1" },
  empresa_solicitar_resultados: { type: "company_results_request" },
  empresa_resultados: { type: "company_results_request" },
  empresa_ubicacion: { type: "company_location" },
  empresa_mas_opciones_2: { type: "menu", menu: "empresasMasOpciones2" },
  empresa_horarios: { type: "text_with_main_menu", text: `🕒 Claro, con gusto te compartimos nuestros horarios de atención.

Si tu empresa o institución desea coordinar servicios, evaluaciones o atención ocupacional, estos son nuestros horarios disponibles:

Lun-Vie: 7:30AM - 5:30PM
Sáb: 8:00AM - 12:30PM

Será un gusto atenderte 💙` },
  empresa_hablar_asesor: { type: "advisor_chat", origen: "empresa" },
  empresa_asesor: { type: "advisor_chat", origen: "empresa" },

  proveedor_propuesta: { type: "provider_request" },
  proveedor_ubicacion: { type: "provider_location" },
  proveedor_mas_opciones: { type: "menu", menu: "proveedoresMasOpciones" },
  proveedor_horarios: { type: "text_with_main_menu", text: `🕒 Claro, con gusto te compartimos nuestros horarios de atención.

Si deseas coordinar una visita, presentar una propuesta o entregar información como proveedor, puedes contactarnos o acercarte en los siguientes horarios:

Lun-Vie: 7:30AM - 5:30PM
Sáb: 8:00AM - 12:30PM

Será un gusto atenderte 💙` },
  proveedor_hablar_asesor: { type: "advisor_chat", origen: "proveedor" },
  proveedor_asesor: { type: "advisor_chat", origen: "proveedor" },
  proveedor_existente: { type: "menu", menu: "proveedorExistente" },
  proveedor_existente_solicitud: { type: "provider_existing_request" },
  proveedor_existente_asesor: { type: "advisor_chat", origen: "proveedor_existente" },

  alianza_info: { type: "alliance_request" },
  alianza_ubicacion: { type: "alliance_location" },
  alianza_mas_opciones: { type: "menu", menu: "alianzasMasOpciones" },
  alianza_horarios: { type: "text_with_main_menu", text: `🕒 Nuestro horario de atención en FamySALUD es:

Lun-Vie: 7:30AM - 5:30PM
Sáb: 8:00AM - 12:30PM

Será un gusto conocer tu propuesta y evaluar posibles formas de colaboración con FamySALUD 💙` },
  alianza_asesor: { type: "advisor_chat", origen: "alianza_potencial" },
  alianza_existente: { type: "menu", menu: "alianzaExistente" },
  alianza_existente_solicitud: { type: "existing_ally_request" },
  alianza_existente_asesor: { type: "advisor_chat", origen: "alianza_existente" }
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

    if (await manejarRespuestaFeriadoAsesorPrincipal(from, rawText)) {
      return res.sendStatus(200);
    }

    if (await manejarMensajeAsesor(from, rawText, message)) {
      return res.sendStatus(200);
    }

    if (await manejarMensajePacienteAsesor(from, rawText, message)) {
      return res.sendStatus(200);
    }

    if (await manejarMensajeUsuarioEnEsperaAsesor(from)) {
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

    if (estaEnFlujoResultadosEmpresa(from)) {
      await manejarFlujoResultadosEmpresa(from, rawText, messageId);
      return res.sendStatus(200);
    }

    if (estaEnFlujoProveedor(from)) {
      await manejarFlujoProveedor(from, rawText, message, messageId);
      return res.sendStatus(200);
    }

    if (estaEnFlujoAlianza(from)) {
      await manejarSolicitudAlianza(from, rawText, message, messageId);
      return res.sendStatus(200);
    }

    if (!buttonId && !listReplyId && estaEnFlujoAgendamiento(from)) {
      await manejarFlujoAgendamiento(from, rawText, messageId);
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

function crearSesionAsesorLibre(asesor) {
  return {
    asesorId: asesor.id,
    paciente: null,
    asesor: asesor.phone,
    nombreAsesor: null,
    cargoAsesor: null,
    nombreTemporalAsesor: null,
    origen: "paciente",
    estado: "libre"
  };
}

function obtenerAsesorPorTelefono(phone) {
  return ASESORES_WHATSAPP.find((asesor) => asesor.phone === phone) || null;
}

function obtenerSesionAsesor(asesorId) {
  return sesionesAsesores.get(asesorId) || null;
}

function encolarPersistenciaAsesor(key, action, task) {
  const anterior = persistenciasAsesorPendientes.get(key) || Promise.resolve();
  const startedAt = Date.now();
  const siguiente = anterior
    .catch(() => {})
    .then(task)
    .catch((error) => {
      console.warn(`[ASESOR_DB] ${action}. Continuando en memoria:`, construirDetalleErrorLog(error, {
        action,
        elapsedMs: Date.now() - startedAt
      }));
    })
    .finally(() => {
      if (persistenciasAsesorPendientes.get(key) === siguiente) {
        persistenciasAsesorPendientes.delete(key);
      }
    });

  persistenciasAsesorPendientes.set(key, siguiente);
}

function persistirSesionAsesorSeguro(sesion) {
  encolarPersistenciaAsesor(
    `asesor:${sesion.asesorId}`,
    "No se pudo persistir sesion",
    () => guardarSesionAsesorPersistida(sesion)
  );
}

function persistirColaAsesorSeguro(item) {
  encolarPersistenciaAsesor(
    `cola:${item.paciente}`,
    "No se pudo persistir cola",
    () => guardarPacienteEnColaAsesor({
      paciente_phone: item.paciente,
      origen: item.origen,
      creado_en: item.creadoEn
    })
  );
}

function eliminarColaAsesorSeguro(paciente) {
  encolarPersistenciaAsesor(
    `cola:${paciente}`,
    "No se pudo eliminar cola",
    () => eliminarPacienteDeColaAsesor(paciente)
  );
}

function finalizarSesionAsesorPersistidaSeguro(asesorId, motivo) {
  encolarPersistenciaAsesor(
    `asesor:${asesorId}`,
    "No se pudo marcar sesion finalizada",
    () => finalizarSesionAsesorPersistida(asesorId, motivo)
  );
}

function guardarSesionAsesor(asesorId, sesion) {
  sesionesAsesores.set(asesorId, sesion);
  persistirSesionAsesorSeguro(sesion);
  reiniciarTemporizadorAceptacionAsesor(asesorId);
  return sesion;
}

function encolarPersistenciaAgendamiento(phone, action, task) {
  const anterior = persistenciasAgendamientoPendientes.get(phone) || Promise.resolve();
  const startedAt = Date.now();
  const siguiente = anterior
    .catch(() => {})
    .then(task)
    .catch((error) => {
      console.warn(`[AGENDAMIENTO_DB] ${action}. Continuando en memoria:`, construirDetalleErrorLog(error, {
        action,
        elapsedMs: Date.now() - startedAt
      }));
    })
    .finally(() => {
      if (persistenciasAgendamientoPendientes.get(phone) === siguiente) {
        persistenciasAgendamientoPendientes.delete(phone);
      }
    });

  persistenciasAgendamientoPendientes.set(phone, siguiente);
}

function guardarSesionAgendamiento(phone, sesion) {
  const sesionPersistible = {
    ...sesion,
    timestamp: sesion?.timestamp || Date.now()
  };

  sesionesAgendamiento.set(phone, sesionPersistible);
  encolarPersistenciaAgendamiento(
    phone,
    "No se pudo persistir sesion de agendamiento",
    () => guardarSesionAgendamientoPersistida(phone, obtenerSessionId(phone), sesionPersistible, SESION_USUARIO_TTL_MS)
  );
  return sesionPersistible;
}

function eliminarSesionAgendamiento(phone, sessionId = null) {
  const holdId = sesionesAgendamiento.get(phone)?.appointmentHoldId || null;
  sesionesAgendamiento.delete(phone);
  liberarHoldAgendamientoSeguro(phone, holdId, sessionId);
  encolarPersistenciaAgendamiento(
    phone,
    "No se pudo eliminar sesion de agendamiento",
    () => eliminarSesionAgendamientoPersistida(phone)
  );
}

function liberarHoldAgendamientoSeguro(phone, holdId = null, sessionId = null) {
  if (!phone) {
    return;
  }

  const sessionIdHold = sessionId || obtenerSessionId(phone);

  if (!sessionIdHold) {
    return;
  }

  liberarHoldAgendamientoPersistido(sessionIdHold, holdId)
    .then((liberados) => {
      console.log("[AGENDAMIENTO_DB] Hold liberado:", {
        phone,
        sessionId: sessionIdHold,
        holdId,
        liberados
      });
    })
    .catch((error) => {
      console.warn("[AGENDAMIENTO_DB] No se pudo liberar hold. Continuando:", construirDetalleErrorLog(error, {
        action: "appointment_hold_release",
        phone,
        sessionId: sessionIdHold,
        holdId
      }));
    });
}

function obtenerSesionAsesorPorTelefono(phone) {
  const asesor = obtenerAsesorPorTelefono(phone);
  return asesor ? obtenerSesionAsesor(asesor.id) : null;
}

function obtenerAsesorLibre() {
  return ASESORES_WHATSAPP.find((asesor) => obtenerSesionAsesor(asesor.id)?.estado === "libre") || null;
}

function obtenerAsesorLibreExcluyendo(asesorIdExcluido) {
  return ASESORES_WHATSAPP.find((asesor) => (
    asesor.id !== asesorIdExcluido &&
    obtenerSesionAsesor(asesor.id)?.estado === "libre"
  )) || null;
}

function obtenerSesionAsesorPorPaciente(paciente) {
  return Array.from(sesionesAsesores.values()).find((sesion) => (
    sesion.paciente === paciente && sesion.estado !== "libre"
  )) || null;
}

function obtenerSesionAsesorConectadaPorPaciente(paciente) {
  return Array.from(sesionesAsesores.values()).find((sesion) => (
    sesion.paciente === paciente && sesion.estado === "conectado"
  )) || null;
}

function construirSesionAsesorAsignada(asesor, paciente, origen = "paciente", datos = {}) {
  return {
    asesorId: asesor.id,
    paciente,
    asesor: asesor.phone,
    nombreAsesor: null,
    cargoAsesor: null,
    nombreTemporalAsesor: null,
    origen,
    estado: "esperando_nombre",
    asignadoEn: Date.now(),
    conectadoEn: null,
    waitMs: Number.isFinite(datos.waitMs) ? datos.waitMs : 0
  };
}

function obtenerEstadoAsesores() {
  return ASESORES_WHATSAPP.map((asesor) => ({
    id: asesor.id,
    phone: asesor.phone,
    estado: obtenerSesionAsesor(asesor.id)?.estado || "sin_sesion"
  }));
}

function obtenerFechaHoraEcuador(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_HORARIA_ASESOR,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(fecha);

  return {
    dia: partes.find((parte) => parte.type === "weekday")?.value,
    anio: partes.find((parte) => parte.type === "year")?.value,
    mes: partes.find((parte) => parte.type === "month")?.value,
    diaMes: partes.find((parte) => parte.type === "day")?.value,
    hora: Number.parseInt(partes.find((parte) => parte.type === "hour")?.value || "0", 10),
    minuto: Number.parseInt(partes.find((parte) => parte.type === "minute")?.value || "0", 10)
  };
}

function obtenerFechaISOEcuador(fecha = new Date()) {
  const { anio, mes, diaMes } = obtenerFechaHoraEcuador(fecha);
  return `${anio}-${mes}-${diaMes}`;
}

function sumarDiasFechaISO(fechaISO, dias) {
  const fecha = new Date(`${fechaISO}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function estaEnHorarioNormalAsesor(fecha = new Date()) {
  const { dia, hora, minuto } = obtenerFechaHoraEcuador(fecha);
  const minutosDia = hora * 60 + minuto;

  if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(dia)) {
    return minutosDia >= 7 * 60 + 30 && minutosDia <= 17 * 60 + 30;
  }

  if (dia === "Sat") {
    return minutosDia >= 8 * 60 && minutosDia <= 12 * 60 + 30;
  }

  return false;
}

function convertirHoraAMinutos(hora) {
  if (!hora) {
    return null;
  }

  const texto = String(hora).slice(0, 5);
  const match = texto.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

async function obtenerHorarioEspecialConfirmadoSeguro(fechaISO) {
  try {
    return await obtenerHorarioEspecialConfirmadoPorFecha(fechaISO);
  } catch (error) {
    console.warn("[FERIADOS] Error consultando BD:", error.message);
    return null;
  }
}

async function estaEnHorarioLaboralAsesor(fecha = new Date()) {
  const fechaISO = obtenerFechaISOEcuador(fecha);
  const horarioEspecial = await obtenerHorarioEspecialConfirmadoSeguro(fechaISO);

  if (horarioEspecial?.tipo === "cerrado") {
    return false;
  }

  if (horarioEspecial?.tipo === "parcial") {
    const { hora, minuto } = obtenerFechaHoraEcuador(fecha);
    const minutosDia = hora * 60 + minuto;
    const inicio = convertirHoraAMinutos(horarioEspecial.hora_inicio);
    const fin = convertirHoraAMinutos(horarioEspecial.hora_fin);
    return inicio !== null && fin !== null && minutosDia >= inicio && minutosDia <= fin;
  }

  return estaEnHorarioNormalAsesor(fecha);
}

function formatearFechaFeriado(fecha) {
  const fechaISO = obtenerFechaISODesdeValorBD(fecha);
  const [anio, mes, dia] = fechaISO.split("-").map((valor) => Number.parseInt(valor, 10));
  const fechaUTC = new Date(Date.UTC(anio, mes - 1, dia, 12, 0, 0));
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: ZONA_HORARIA_ASESOR,
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(fechaUTC);
}

function obtenerFechaISODesdeValorBD(fecha) {
  if (typeof fecha === "string") {
    return fecha.slice(0, 10);
  }

  return new Date(fecha).toISOString().slice(0, 10);
}

function formatearFechaNombreFeriado(feriado) {
  return `${obtenerFechaISODesdeValorBD(feriado.fecha)} / ${feriado.nombre}`;
}

function construirMensajeRecordatorioFeriado(feriado) {
  return `🗓️ Se acerca un feriado: ${formatearFechaFeriado(feriado.fecha)}.

Feriado: ${feriado.nombre}

¿Qué horario tendrá la atención por WhatsApp con asesores ese día?

1. Horario normal de asesores
2. Horario parcial de asesores
3. Sin atención con asesores

Nota: esta configuración solo aplica al canal de WhatsApp, no confirma la operación presencial del centro médico ni de todos sus servicios.

Responde con el número de la opción.`;
}

function validarRespuestaHorarioParcial(texto) {
  const match = String(texto || "").trim().match(/^parcial\s+([01]\d|2[0-3]):([0-5]\d)\s+([01]\d|2[0-3]):([0-5]\d)$/i);

  if (!match) {
    return null;
  }

  const inicio = `${match[1]}:${match[2]}`;
  const fin = `${match[3]}:${match[4]}`;

  if (convertirHoraAMinutos(inicio) >= convertirHoraAMinutos(fin)) {
    return null;
  }

  return {
    horaInicio: `${inicio}:00`,
    horaFin: `${fin}:00`,
    inicio,
    fin
  };
}

function esAsesorPrincipal(phone) {
  return phone === ASESOR_WHATSAPP_PRINCIPAL;
}

async function obtenerConfirmacionFeriadoPendienteSeguro() {
  try {
    return await obtenerConfirmacionFeriadoPendiente();
  } catch (error) {
    console.warn("[FERIADOS] Error consultando BD:", error.message);
    return null;
  }
}

async function manejarRespuestaFeriadoAsesorPrincipal(from, rawText) {
  if (!esAsesorPrincipal(from)) {
    return false;
  }

  const sesionAsesor = obtenerSesionAsesorPorTelefono(from);

  if (sesionAsesor?.estado !== "libre") {
    return false;
  }

  const confirmacion = await obtenerConfirmacionFeriadoPendienteSeguro();

  if (!confirmacion) {
    return false;
  }

  const texto = String(rawText || "").trim();

  if (confirmacion.estado_confirmacion === "esperando_horario_parcial") {
    const horario = validarRespuestaHorarioParcial(texto);

    if (!horario) {
      await enviarMensajeTexto(
        from,
        "Por favor indica el horario parcial con este formato exacto:\nparcial 08:00 12:30"
      );
      return true;
    }

    try {
      await actualizarHorarioParcialFeriado(
        confirmacion.feriado_id,
        horario.horaInicio,
        horario.horaFin,
        from
      );
      console.log("[FERIADOS] Horario parcial guardado", {
        feriadoId: confirmacion.feriado_id,
        horaInicio: horario.horaInicio,
        horaFin: horario.horaFin
      });
    } catch (error) {
      console.warn("[FERIADOS] Error consultando BD:", error.message);
      return false;
    }

    await enviarMensajeTexto(
      from,
      `✅ Listo. Para el feriado ${formatearFechaNombreFeriado(confirmacion)}, habrá atención parcial con asesores por WhatsApp de ${horario.inicio} a ${horario.fin}.`
    );
    return true;
  }

  if (texto === "1") {
    try {
      await actualizarConfirmacionHorarioEspecial(confirmacion.feriado_id, "normal", from);
      console.log("[FERIADOS] Confirmación guardada", { feriadoId: confirmacion.feriado_id, tipo: "normal" });
    } catch (error) {
      console.warn("[FERIADOS] Error consultando BD:", error.message);
      return false;
    }

    await enviarMensajeTexto(
      from,
      `✅ Listo. Para el feriado ${formatearFechaNombreFeriado(confirmacion)}, se usará el horario normal de asesores por WhatsApp.`
    );
    return true;
  }

  if (texto === "2") {
    try {
      await marcarEsperandoHorarioParcial(confirmacion.feriado_id);
      console.log("[FERIADOS] Confirmación guardada", { feriadoId: confirmacion.feriado_id, tipo: "parcial_pendiente" });
    } catch (error) {
      console.warn("[FERIADOS] Error consultando BD:", error.message);
      return false;
    }

    await enviarMensajeTexto(
      from,
      "Perfecto. Indica el horario parcial con este formato:\nparcial 08:00 12:30\n\nEjemplo:\nparcial 08:00 12:30"
    );
    return true;
  }

  if (texto === "3") {
    try {
      await actualizarConfirmacionHorarioEspecial(confirmacion.feriado_id, "cerrado", from);
      console.log("[FERIADOS] Confirmación guardada", { feriadoId: confirmacion.feriado_id, tipo: "cerrado" });
    } catch (error) {
      console.warn("[FERIADOS] Error consultando BD:", error.message);
      return false;
    }

    await enviarMensajeTexto(
      from,
      `✅ Listo. Para el feriado ${formatearFechaNombreFeriado(confirmacion)}, no habrá atención con asesores por WhatsApp.`
    );
    return true;
  }

  await enviarMensajeTexto(from, "Por favor responde con 1, 2 o 3.");
  return true;
}

async function iniciarSesionAsesor(paciente, messageId, buttonId, origen = "paciente") {
  const esEmpresa = origen === "empresa";
  const esProveedor = origen === "proveedor";
  const esProveedorExistente = origen === "proveedor_existente";
  const esAlianzaPotencial = origen === "alianza_potencial";
  const esAlianzaExistente = origen === "alianza_existente";
  const sesionExistente = obtenerSesionAsesorPorPaciente(paciente);
  console.log(esAlianzaPotencial || esAlianzaExistente ? "[ALIANZA_ASESOR] Solicita hablar con asesor:" : esProveedor || esProveedorExistente ? "[PROVEEDOR_ASESOR] Solicita hablar con asesor:" : esEmpresa ? "[EMPRESA_ASESOR] Solicita hablar con asesor:" : "[PACIENTE] Solicita hablar con asesor:", {
    paciente,
    origen,
    asesores: obtenerEstadoAsesores()
  });

  if (sesionExistente) {
    await enviarMensajeTexto(
      paciente,
      "💬 Ya estás esperando para hablar con un asesor.\n\nTe avisaremos cuando se conecte contigo 😊"
    );
    return;
  }

  if (!(await estaEnHorarioLaboralAsesor())) {
    console.log("[ASESOR_HORARIO] Solicitud fuera de horario laboral:", {
      paciente,
      origen
    });
    await enviarMensajeTexto(paciente, MENSAJE_ASESOR_FUERA_HORARIO);
    return;
  }

  const asesorLibre = obtenerAsesorLibre();

  if (!asesorLibre || colaEsperaAsesor.length > 0) {
    if (agregarPacienteAColaAsesor(paciente, origen)) {
      console.log("[COLA_ASESOR] Paciente agregado a cola:", {
        paciente,
        origen,
        totalEnCola: colaEsperaAsesor.length
      });
      registrarEvento(paciente, "advisor_queued", {
        messageId,
        buttonId,
        flowKey: obtenerFlowKeyAsesor(origen),
        payload: {
          origen,
          queueLength: colaEsperaAsesor.length,
          reason: "all_advisors_busy"
        }
      });
      await enviarMensajeTexto(
        paciente,
        esProveedor || esProveedorExistente || esAlianzaPotencial || esAlianzaExistente
          ? "⏳ En este momento nuestros asesores están atendiendo otros chats.\n\nTe dejamos en cola y en cuanto haya disponibilidad, un asesor continuará contigo por aquí. Gracias por tu paciencia 💙"
          : esEmpresa
          ? "⏳ En este momento nuestros asesores están atendiendo otros chats.\n\nTe dejamos en cola y en cuanto haya disponibilidad, un asesor continuará contigo por aquí. Gracias por tu paciencia 💙"
          : "⏳ En este momento nuestros asesores están atendiendo otros chats.\n\nTe dejamos en cola y en cuanto haya disponibilidad, un asesor continuará contigo por aquí. Gracias por tu paciencia 💙"
      );
      return;
    }

    console.log("[COLA_ASESOR] Paciente ya estaba en cola:", {
      paciente,
      origen,
      totalEnCola: colaEsperaAsesor.length
    });
    await enviarMensajeTexto(
      paciente,
      "💬 Ya estás en la cola de espera para hablar con un asesor.\n\nTe avisaremos cuando sea tu turno 😊"
    );
    return;
  }

  const sesionAsesor = guardarSesionAsesor(asesorLibre.id, construirSesionAsesorAsignada(asesorLibre, paciente, origen));
  cancelarExpiracionSesion(paciente);

  console.log("[SESION] Asesor esperando nombre:", sesionAsesor);
  registrarEvento(paciente, "advisor_session_requested", {
    messageId,
    buttonId,
    flowKey: obtenerFlowKeyAsesor(origen)
  });

  await enviarMensajeTexto(
    paciente,
    esAlianzaExistente
      ? "💬 Claro, en un momento uno de nuestros asesores de FamySALUD te atenderá.\n\nGracias por contactarnos como aliado estratégico. Por favor espera un momento 😊"
      : esAlianzaPotencial
      ? "💬 Claro, en un momento uno de nuestros asesores de FamySALUD te atenderá.\n\nGracias por contactarnos por una posible alianza estratégica. Por favor espera un momento 😊"
      : esProveedorExistente
      ? "💬 Claro, en un momento uno de nuestros asesores de FamySALUD te atenderá.\n\nGracias por contactarnos como proveedor. Por favor espera un momento 😊"
      : esProveedor
      ? "💬 Claro, en un momento uno de nuestros asesores de FamySALUD te atenderá.\n\nGracias por contactarnos desde el área de proveedores. Por favor espera un momento 😊"
      : esEmpresa
      ? "💬 Claro, en un momento uno de nuestros asesores de FamySALUD te atenderá.\n\nGracias por contactarnos desde el área de servicios para empresas. Por favor espera un momento 😊"
      : "💬 Claro, en un momento uno de nuestros asesores de FamySALUD te atenderá.\n\nPor favor espera un momento 😊"
  );
  await enviarMensajeTexto(
    sesionAsesor.asesor,
    esAlianzaExistente
      ? "📩 Nueva solicitud de atención - ALIADO ESTRATÉGICO EXISTENTE\n\nUn aliado estratégico existente está esperando atención.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : esAlianzaPotencial
      ? "📩 Nueva solicitud de atención - ALIANZA POTENCIAL\n\nUna persona interesada en una alianza estratégica está esperando atención.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : esProveedorExistente
      ? "📩 Nueva solicitud de atención - PROVEEDOR EXISTENTE\n\nUn proveedor existente está esperando atención.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : esProveedor
      ? "📩 Nueva solicitud de atención - POTENCIAL PROVEEDOR\n\nUn potencial proveedor está esperando atención.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : esEmpresa
      ? "📩 Nueva solicitud de atención - EMPRESA\n\nUna empresa o institución está esperando atención.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : "📩 Nuevo paciente esperando atención.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
  );
}

async function manejarMensajeAsesor(from, rawText, message) {
  const sesionAsesor = obtenerSesionAsesorPorTelefono(from);

  if (!sesionAsesor) {
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
      await conectarAsesorConPaciente(sesionAsesor.asesorId, asesorRegistrado);
      return true;
    }

    sesionAsesor.nombreTemporalAsesor = mensaje;
    sesionAsesor.estado = "esperando_nombre_cargo";
    console.log("[ASESOR] Nombre no reconocido:", { recibido: mensaje });
    console.log("[SESION] Esperando nombre y cargo:", sesionAsesor);

    guardarSesionAsesor(sesionAsesor.asesorId, sesionAsesor);
    await enviarMensajeTexto(
      sesionAsesor.asesor,
      "No reconocí ese nombre como asesor registrado.\n\nPor favor responde con tu nombre y cargo.\nEjemplo:\nCarlos asesor\nMaría asesora"
    );
    return true;
  }

  if (sesionAsesor.estado === "esperando_nombre_cargo") {
    const asesorConCargo = extraerAsesorConCargo(mensaje, sesionAsesor.nombreTemporalAsesor);

    if (!asesorConCargo) {
      console.log("[ASESOR] Falta cargo para conectar:", { recibido: mensaje });
      reiniciarTemporizadorAceptacionAsesor(sesionAsesor.asesorId);
      await enviarMensajeTexto(
        sesionAsesor.asesor,
        "Por favor incluye el cargo para continuar.\nEjemplo:\nCarlos asesor\nMaría asesora"
      );
      return true;
    }

    await conectarAsesorConPaciente(sesionAsesor.asesorId, asesorConCargo);
    return true;
  }

  if (sesionAsesor.estado === "conectado") {
    if (mensaje.toLowerCase() === "finalizar") {
      const paciente = sesionAsesor.paciente;
      console.log("[ASESOR] Finaliza atencion:", { asesor: from, paciente });

      await finalizarSesionAsesor(sesionAsesor.asesorId, "manual");
      return true;
    }

    if (mensaje) {
      console.log("[ASESOR] Reenviando mensaje al paciente:", {
        asesor: from,
        paciente: sesionAsesor.paciente
      });
      try {
        console.log("[ASESOR] Antes await enviarMensajeTexto asesor->paciente:", {
          asesor: from,
          paciente: sesionAsesor.paciente
        });
        await enviarMensajeTexto(sesionAsesor.paciente, mensaje);
        console.log("[ASESOR] Despues await enviarMensajeTexto asesor->paciente:", {
          asesor: from,
          paciente: sesionAsesor.paciente
        });
        reiniciarTemporizadorSesionAsesor(sesionAsesor.asesorId);
      } catch (error) {
        console.error("[ASESOR] Error reenviando mensaje al paciente:", error.response?.data || error.message);
      }
      return true;
    }

    try {
      console.log("[ASESOR] Antes await reenviarMensajeMultimediaSeguro asesor->paciente:", {
        asesor: from,
        paciente: sesionAsesor.paciente,
        tipo: message?.type
      });
      if (await reenviarMensajeMultimediaSeguro(sesionAsesor.paciente, message, from)) {
        console.log("[ASESOR] Multimedia reenviado al paciente:", {
          asesor: from,
          paciente: sesionAsesor.paciente,
          tipo: message.type
        });
        reiniciarTemporizadorSesionAsesor(sesionAsesor.asesorId);
      }
      console.log("[ASESOR] Despues await reenviarMensajeMultimediaSeguro asesor->paciente:", {
        asesor: from,
        paciente: sesionAsesor.paciente,
        tipo: message?.type
      });
    } catch (error) {
      console.error("[ASESOR] Error inesperado reenviando multimedia al paciente:", error.response?.data || error.message);
    }
    return true;
  }

  return false;
}

async function conectarAsesorConPaciente(asesorId, asesor) {
  const sesionAsesor = obtenerSesionAsesor(asesorId);

  if (!sesionAsesor?.paciente) {
    return;
  }

  sesionAsesor.nombreAsesor = asesor.nombre;
  sesionAsesor.cargoAsesor = asesor.cargo;
  sesionAsesor.estado = "conectado";
  sesionAsesor.conectadoEn = Date.now();
  guardarSesionAsesor(asesorId, sesionAsesor);
  const origen = sesionAsesor.origen || "paciente";

  console.log("[ASESOR] Conectado con paciente:", {
    paciente: sesionAsesor.paciente,
    nombreAsesor: sesionAsesor.nombreAsesor,
    cargoAsesor: sesionAsesor.cargoAsesor,
    origen
  });
  console.log("[SESION] Asesor conectado:", sesionAsesor);
  registrarEvento(sesionAsesor.paciente, "advisor_connected", {
    flowKey: obtenerFlowKeyAsesor(origen),
    payload: {
      origen,
      advisorId: sesionAsesor.asesorId
    }
  });

  await enviarMensajeTexto(
    sesionAsesor.paciente,
    origen === "alianza_existente"
      ? `Hola, soy ${sesionAsesor.nombreAsesor}, ${sesionAsesor.cargoAsesor} de FamySALUD 💙\n\nUn gusto atenderte. ¿En qué podemos ayudarte como aliado estratégico?`
      : origen === "alianza_potencial"
      ? `Hola, soy ${sesionAsesor.nombreAsesor}, ${sesionAsesor.cargoAsesor} de FamySALUD 💙\n\nUn gusto atenderte. ¿En qué podemos ayudarte con tu propuesta de alianza estratégica?`
      : origen === "proveedor_existente"
      ? `Hola, soy ${sesionAsesor.nombreAsesor}, ${sesionAsesor.cargoAsesor} de FamySALUD 💙\n\nUn gusto atenderte. ¿En qué podemos ayudarte con tu consulta como proveedor existente?`
      : origen === "proveedor"
      ? `Hola, soy ${sesionAsesor.nombreAsesor}, ${sesionAsesor.cargoAsesor} de FamySALUD 💙\nUn gusto atenderte. ¿En qué podemos ayudarte con tu propuesta o consulta como proveedor?`
      : origen === "empresa"
      ? `Hola, soy ${sesionAsesor.nombreAsesor}, ${sesionAsesor.cargoAsesor} de FamySALUD 💙\nUn gusto atenderte. ¿En qué podemos ayudarte con los servicios para tu empresa o institución?`
      : `Hola, soy ${sesionAsesor.nombreAsesor}, ${sesionAsesor.cargoAsesor} de FamySALUD 💙\nUn gusto atenderte. ¿En qué te puedo ayudar?`
  );
  await enviarMensajeTexto(
    sesionAsesor.asesor,
    `✅ Te conectaste con ${obtenerEtiquetaOrigenAsesor(origen)}.\n\nEscribe normalmente para responderle.\nPara cerrar la atención escribe: finalizar`
  );
  reiniciarTemporizadorSesionAsesor(asesorId);
}

function obtenerEtiquetaOrigenAsesor(origen = "paciente") {
  if (origen === "empresa") return "la empresa";
  if (origen === "alianza_existente") return "el aliado estratégico";
  if (origen === "alianza_potencial") return "la alianza potencial";
  if (origen === "proveedor_existente") return "el proveedor existente";
  if (origen === "proveedor") return "el proveedor";
  return "el paciente";
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

function extraerAsesorConCargo(texto, nombreTemporalAsesor = "") {
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
  const nombre = formatearNombreAsesor(nombreSinCargo || nombreTemporalAsesor);

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

function pacienteEstaEnColaAsesor(numero) {
  return colaEsperaAsesor.some((item) => item.paciente === numero);
}

function estaEnFlujoAsesor(phone) {
  return pacienteEstaEnColaAsesor(phone) || Boolean(obtenerSesionAsesorPorPaciente(phone));
}

async function manejarMensajeUsuarioEnEsperaAsesor(from) {
  const sesionAsesor = obtenerSesionAsesorPorPaciente(from);

  if (sesionAsesor?.estado === "esperando_nombre" || sesionAsesor?.estado === "esperando_nombre_cargo") {
    await enviarMensajeTexto(
      from,
      "💬 Ya solicitaste atención con un asesor de FamySALUD.\n\nEstamos esperando que un asesor se conecte contigo. Por favor espera un momento 😊"
    );
    return true;
  }

  if (pacienteEstaEnColaAsesor(from)) {
    await enviarMensajeTexto(
      from,
      "💬 Sigues en la cola de espera.\n\nTe avisaremos apenas un asesor esté disponible 😊"
    );
    return true;
  }

  return false;
}

function agregarPacienteAColaAsesor(paciente, origen = "paciente") {
  if (pacienteEstaEnColaAsesor(paciente)) {
    return false;
  }

  cancelarExpiracionSesion(paciente);
  colaEsperaAsesor.push({
    paciente,
    origen,
    creadoEn: Date.now()
  });
  persistirColaAsesorSeguro(colaEsperaAsesor[colaEsperaAsesor.length - 1]);

  return true;
}

function agregarPacienteAlInicioColaAsesor(paciente, origen = "paciente") {
  if (pacienteEstaEnColaAsesor(paciente)) {
    return false;
  }

  cancelarExpiracionSesion(paciente);
  const item = {
    paciente,
    origen,
    creadoEn: Date.now()
  };
  colaEsperaAsesor.unshift(item);
  persistirColaAsesorSeguro(item);

  return true;
}

function esSesionEsperandoAceptacionAsesor(sesionAsesor) {
  return sesionAsesor?.paciente && (
    sesionAsesor.estado === "esperando_nombre" ||
    sesionAsesor.estado === "esperando_nombre_cargo"
  );
}

function reiniciarTemporizadorAceptacionAsesor(asesorId) {
  const temporizadorActual = temporizadoresAceptacionAsesor.get(asesorId);
  const sesionAsesor = obtenerSesionAsesor(asesorId);

  if (temporizadorActual) {
    clearTimeout(temporizadorActual);
  }

  if (!esSesionEsperandoAceptacionAsesor(sesionAsesor)) {
    temporizadoresAceptacionAsesor.delete(asesorId);
    return;
  }

  const temporizador = setTimeout(async () => {
    await expirarAceptacionAsesorPorInactividad(asesorId);
  }, TIEMPO_ACEPTACION_ASESOR_MS);
  temporizadoresAceptacionAsesor.set(asesorId, temporizador);

  console.log("[ASESOR_TIMEOUT] Temporizador de aceptacion reiniciado:", {
    asesorId,
    paciente: sesionAsesor.paciente,
    estado: sesionAsesor.estado,
    tiempoMs: TIEMPO_ACEPTACION_ASESOR_MS
  });
}

function reiniciarTemporizadorSesionAsesor(asesorId) {
  const temporizadorActual = temporizadoresSesionAsesor.get(asesorId);
  const sesionAsesor = obtenerSesionAsesor(asesorId);

  if (temporizadorActual) {
    clearTimeout(temporizadorActual);
  }

  if (sesionAsesor?.estado !== "conectado" || !sesionAsesor.paciente) {
    temporizadoresSesionAsesor.delete(asesorId);
    return;
  }

  const temporizador = setTimeout(async () => {
    await expirarSesionAsesorPorInactividad(asesorId);
  }, TIEMPO_EXPIRACION_ASESOR_MS);
  temporizadoresSesionAsesor.set(asesorId, temporizador);

  console.log("[SESION] Temporizador de asesor reiniciado:", {
    asesorId,
    paciente: sesionAsesor.paciente,
    tiempoMs: TIEMPO_EXPIRACION_ASESOR_MS
  });
}

async function expirarSesionAsesorPorInactividad(asesorId) {
  const sesionAsesor = obtenerSesionAsesor(asesorId);

  if (sesionAsesor?.estado !== "conectado" || !sesionAsesor.paciente) {
    return;
  }

  console.log("[EXPIRACION_ASESOR] Sesion expirada por inactividad:", {
    paciente: sesionAsesor.paciente,
    asesor: sesionAsesor.asesor
  });

  await finalizarSesionAsesor(asesorId, "inactividad");
}

async function expirarAceptacionAsesorPorInactividad(asesorId) {
  const sesionAsesor = obtenerSesionAsesor(asesorId);

  if (!esSesionEsperandoAceptacionAsesor(sesionAsesor)) {
    return;
  }

  temporizadoresAceptacionAsesor.delete(asesorId);
  const paciente = sesionAsesor.paciente;
  const asesor = sesionAsesor.asesor;
  const origen = sesionAsesor.origen || "paciente";

  console.log("[ASESOR_TIMEOUT] Aceptacion expirada por falta de respuesta:", {
    asesorId,
    paciente,
    asesor,
    estado: sesionAsesor.estado
  });

  try {
    await enviarMensajeTexto(
      paciente,
      "⏳ Seguimos buscando un asesor disponible para continuar contigo. Gracias por tu paciencia 💙"
    );
    await enviarMensajeTexto(
      asesor,
      "⏱️ La solicitud fue reasignada por falta de respuesta."
    );
  } catch (error) {
    console.warn("[ASESOR_TIMEOUT] Error notificando reasignacion:", error.response?.data || error.message);
  }

  finalizarSesionAsesorPersistidaSeguro(asesorId, "aceptacion_expirada");
  resetearSesionAsesor(asesorId);

  const asesorLibre = obtenerAsesorLibreExcluyendo(asesorId);

  if (asesorLibre) {
    const nuevaSesion = guardarSesionAsesor(
      asesorLibre.id,
      construirSesionAsesorAsignada(asesorLibre, paciente, origen)
    );
    cancelarExpiracionSesion(paciente);
    console.log("[ASESOR_TIMEOUT] Solicitud reasignada a otro asesor:", {
      paciente,
      asesorAnteriorId: asesorId,
      asesorNuevoId: asesorLibre.id
    });
    await enviarMensajeTexto(
      nuevaSesion.asesor,
      "📩 Nueva solicitud de atención reasignada.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
    );
    return;
  }

  if (agregarPacienteAlInicioColaAsesor(paciente, origen)) {
    console.log("[ASESOR_TIMEOUT] Paciente devuelto a cola por falta de asesor alterno:", {
      paciente,
      origen,
      totalEnCola: colaEsperaAsesor.length
    });
  }
}

async function finalizarSesionAsesor(asesorId, motivo = "manual") {
  const sesionAsesor = obtenerSesionAsesor(asesorId);

  if (!sesionAsesor?.paciente) {
    resetearSesionAsesor(asesorId);
    await atenderSiguientePacienteEnCola(asesorId);
    return;
  }

  const paciente = sesionAsesor.paciente;
  const asesor = sesionAsesor.asesor;
  const origen = sesionAsesor.origen || "paciente";
  const conectadoEn = sesionAsesor.conectadoEn || Date.now();
  const durationMs = Math.max(Date.now() - conectadoEn, 0);

  try {
    if (motivo === "inactividad") {
      await enviarBotones(
        paciente,
        origen === "alianza_existente"
          ? "⏱️ La conversación con el asesor finalizó por inactividad.\n\nPuedes volver al menú principal si necesitas realizar otra consulta como aliado estratégico."
          : origen === "alianza_potencial"
          ? "⏱️ La conversación con el asesor finalizó por inactividad.\n\nPuedes volver al menú principal si necesitas realizar otra consulta sobre una posible alianza estratégica."
          : origen === "proveedor_existente"
          ? "⏱️ La conversación con el asesor finalizó por inactividad.\n\nPuedes volver al menú principal si necesitas realizar otra consulta como proveedor existente."
          : origen === "proveedor"
          ? "⏱️ La conversación con el asesor finalizó por inactividad.\n\nPuedes volver al menú principal si necesitas realizar otra consulta como proveedor."
          : origen === "empresa"
          ? "⏱️ La conversación con el asesor finalizó por inactividad.\n\nPuedes volver al menú principal si necesitas realizar otra consulta para tu empresa o institución."
          : "⏱️ La conversación con el asesor finalizó por inactividad.\n\nPuedes volver al menú principal si necesitas realizar otra consulta.",
        [boton("menu_principal", "Menú principal")]
      );
      await enviarMensajeTexto(
        asesor,
        `⏱️ La atención con ${obtenerEtiquetaOrigenAsesor(origen)} finalizó por inactividad.`
      );
    } else {
      await enviarBotones(
        paciente,
        origen === "alianza_existente"
          ? "✅ Gracias por comunicarte con FamySALUD.\n\nHa sido un gusto atender tu consulta como aliado estratégico 💙"
          : origen === "alianza_potencial"
          ? "✅ Gracias por comunicarte con FamySALUD.\n\nHa sido un gusto atender tu consulta sobre una posible alianza estratégica 💙"
          : origen === "proveedor_existente"
          ? "✅ Gracias por comunicarte con FamySALUD.\n\nHa sido un gusto atender tu consulta como proveedor existente 💙"
          : origen === "proveedor"
          ? "✅ Gracias por comunicarte con FamySALUD.\n\nHa sido un gusto atender tu consulta como potencial proveedor 💙"
          : origen === "empresa"
          ? "✅ Gracias por comunicarte con FamySALUD.\n\nHa sido un gusto atender tu solicitud empresarial 💙"
          : "✅ Gracias por comunicarte con FamySALUD. Ha sido un gusto atenderte 💙",
        [boton("menu_principal", "Menú principal")]
      );
      await enviarMensajeTexto(
        asesor,
        "✅ Atención finalizada. Ya puedes recibir otro chat."
      );
    }
  } catch (error) {
    console.error("[SESION] Error notificando cierre asesor:", error.response?.data || error.message);
  }

  console.log("[SESION] Finalizando sesion asesor:", {
    motivo,
    paciente,
    asesor,
    origen,
    pacientesEnCola: colaEsperaAsesor.length
  });
  registrarEvento(paciente, "advisor_finished", {
    flowKey: obtenerFlowKeyAsesor(origen),
    payload: {
      origen,
      advisorId: asesorId,
      durationMs,
      waitMs: Number.isFinite(sesionAsesor.waitMs) ? sesionAsesor.waitMs : 0
    }
  });

  finalizarSesionAsesorPersistidaSeguro(asesorId, motivo);
  resetearSesionAsesor(asesorId);
  await atenderSiguientePacienteEnCola(asesorId);
}

async function atenderSiguientePacienteEnCola(asesorId) {
  const asesor = ASESORES_WHATSAPP.find((item) => item.id === asesorId);
  const sesionActual = obtenerSesionAsesor(asesorId);

  if (!asesor || sesionActual?.estado !== "libre" || colaEsperaAsesor.length === 0) {
    return;
  }

  const siguiente = colaEsperaAsesor.shift();
  eliminarColaAsesorSeguro(siguiente.paciente);
  const waitMs = Math.max(Date.now() - (siguiente.creadoEn || Date.now()), 0);

  const sesionAsesor = guardarSesionAsesor(
    asesorId,
    construirSesionAsesorAsignada(asesor, siguiente.paciente, siguiente.origen || "paciente", { waitMs })
  );
  cancelarExpiracionSesion(sesionAsesor.paciente);

  console.log("[COLA_ASESOR] Atendiendo siguiente paciente en cola:", {
    paciente: sesionAsesor.paciente,
    origen: sesionAsesor.origen,
    restantesEnCola: colaEsperaAsesor.length
  });
  console.log("[SESION] Asesor esperando nombre desde cola:", sesionAsesor);
  registrarEvento(sesionAsesor.paciente, "advisor_dequeued", {
    flowKey: obtenerFlowKeyAsesor(sesionAsesor.origen),
    payload: {
      origen: sesionAsesor.origen,
      advisorId: asesorId,
      queueLength: colaEsperaAsesor.length,
      waitMs
    }
  });

  await enviarMensajeTexto(
    sesionAsesor.paciente,
    "💬 Ya es tu turno. En un momento uno de nuestros asesores de FamySALUD se conectará contigo 😊"
  );
  await enviarMensajeTexto(
    sesionAsesor.asesor,
    sesionAsesor.origen === "alianza_existente"
      ? "📩 Nueva solicitud de atención - ALIADO ESTRATÉGICO EXISTENTE\n\nUn aliado estratégico existente está listo para ser atendido.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : sesionAsesor.origen === "alianza_potencial"
      ? "📩 Nueva solicitud de atención - ALIANZA POTENCIAL\n\nUna persona interesada en una alianza estratégica está lista para ser atendida.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : sesionAsesor.origen === "proveedor_existente"
      ? "📩 Nueva solicitud de atención - PROVEEDOR EXISTENTE\n\nUn proveedor existente está listo para ser atendido.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : sesionAsesor.origen === "proveedor"
      ? "📩 Nueva solicitud de atención - POTENCIAL PROVEEDOR\n\nUn potencial proveedor está listo para ser atendido.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : sesionAsesor.origen === "empresa"
      ? "📩 Nueva solicitud de atención - EMPRESA\n\nUna empresa o institución está lista para ser atendida.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
      : "📩 Nuevo paciente en espera listo para ser atendido.\n\nResponde con tu nombre para conectarte.\nEjemplo: Jennifer"
  );
}

async function manejarMensajePacienteAsesor(from, rawText, message) {
  const sesionAsesor = obtenerSesionAsesorConectadaPorPaciente(from);

  if (!sesionAsesor) {
    return false;
  }

  const mensaje = (rawText || "").trim();
  const origen = sesionAsesor.origen || "paciente";

  if (mensaje) {
    console.log(origen === "alianza_potencial" || origen === "alianza_existente" ? "[ALIANZA_ASESOR] Reenviando mensaje al asesor:" : origen === "proveedor" || origen === "proveedor_existente" ? "[PROVEEDOR_ASESOR] Reenviando mensaje al asesor:" : origen === "empresa" ? "[EMPRESA_ASESOR] Reenviando mensaje al asesor:" : "[PACIENTE] Reenviando mensaje al asesor:", {
      paciente: from,
      asesor: sesionAsesor.asesor,
      origen
    });
    console.log("[PACIENTE] Antes await enviarMensajeTexto usuario->asesor:", {
      paciente: from,
      asesor: sesionAsesor.asesor,
      origen
    });
    await enviarMensajeTexto(
      sesionAsesor.asesor,
      origen === "alianza_existente" ? `🤝 Aliado Estratégico:\n${mensaje}` : origen === "alianza_potencial" ? `🤝 Alianza Potencial:\n${mensaje}` : origen === "proveedor_existente" ? `🤝 Proveedor Existente:\n${mensaje}` : origen === "proveedor" ? `🤝 Potencial Proveedor:\n${mensaje}` : origen === "empresa" ? `🏢 Empresa:\n${mensaje}` : `👤 Paciente:\n${mensaje}`
    );
    console.log("[PACIENTE] Despues await enviarMensajeTexto usuario->asesor:", {
      paciente: from,
      asesor: sesionAsesor.asesor,
      origen
    });
    reiniciarTemporizadorSesionAsesor(sesionAsesor.asesorId);
    return true;
  }

  if (esMensajeMultimedia(message)) {
    console.log(origen === "alianza_potencial" || origen === "alianza_existente" ? "[ALIANZA_ASESOR] Reenviando multimedia al asesor:" : origen === "proveedor" || origen === "proveedor_existente" ? "[PROVEEDOR_ASESOR] Reenviando multimedia al asesor:" : origen === "empresa" ? "[EMPRESA_ASESOR] Reenviando multimedia al asesor:" : "[PACIENTE] Reenviando multimedia al asesor:", {
      paciente: from,
      asesor: sesionAsesor.asesor,
      tipo: message.type,
      origen
    });
    await enviarMensajeTexto(
      sesionAsesor.asesor,
      origen === "alianza_existente" ? "🤝 Aliado Estratégico envió un archivo:" : origen === "alianza_potencial" ? "🤝 Alianza Potencial envió un archivo:" : origen === "proveedor_existente" ? "🤝 Proveedor Existente envió un archivo:" : origen === "proveedor" ? "🤝 Potencial Proveedor envió un archivo:" : origen === "empresa" ? "🏢 Empresa envió un archivo:" : "👤 Paciente envió un archivo:"
    );
    console.log("[PACIENTE] Antes await reenviarMensajeMultimediaSeguro usuario->asesor:", {
      paciente: from,
      asesor: sesionAsesor.asesor,
      tipo: message?.type,
      origen
    });
    if (await reenviarMensajeMultimediaSeguro(sesionAsesor.asesor, message, from)) {
      reiniciarTemporizadorSesionAsesor(sesionAsesor.asesorId);
    }
    console.log("[PACIENTE] Despues await reenviarMensajeMultimediaSeguro usuario->asesor:", {
      paciente: from,
      asesor: sesionAsesor.asesor,
      tipo: message?.type,
      origen
    });
  }

  return true;
}

function resetearSesionAsesor(asesorId) {
  const temporizadorActual = temporizadoresSesionAsesor.get(asesorId);
  const temporizadorAceptacionActual = temporizadoresAceptacionAsesor.get(asesorId);

  if (temporizadorActual) {
    clearTimeout(temporizadorActual);
    temporizadoresSesionAsesor.delete(asesorId);
  }

  if (temporizadorAceptacionActual) {
    clearTimeout(temporizadorAceptacionActual);
    temporizadoresAceptacionAsesor.delete(asesorId);
  }

  const asesor = ASESORES_WHATSAPP.find((item) => item.id === asesorId);

  if (!asesor) {
    return;
  }

  const sesionAsesor = guardarSesionAsesor(asesorId, crearSesionAsesorLibre(asesor));
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

  if (accion.type === "appointment_back") {
    await volverAgendamiento(to, messageId);
    return;
  }

  if (accion.type === "results_request") {
    await iniciarSolicitudResultados(to, messageId);
    return;
  }

  if (accion.type === "company_results_request") {
    await iniciarSolicitudResultadosEmpresa(to, messageId, buttonId);
    return;
  }

  if (accion.type === "provider_request") {
    await iniciarSolicitudProveedor(to, messageId, buttonId);
    return;
  }

  if (accion.type === "provider_existing_request") {
    await iniciarSolicitudProveedorExistente(to, messageId, buttonId);
    return;
  }

  if (accion.type === "alliance_request") {
    await iniciarSolicitudAlianza(to, messageId, buttonId);
    return;
  }

  if (accion.type === "existing_ally_request") {
    await iniciarSolicitudAliadoExistente(to, messageId, buttonId);
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

  if (accion.type === "company_location") {
    await enviarUbicacionEmpresa(to);
    return;
  }

  if (accion.type === "provider_location") {
    await enviarUbicacionProveedor(to);
    return;
  }

  if (accion.type === "alliance_location") {
    await enviarUbicacionAlianza(to);
    return;
  }

  if (accion.type === "advisor_chat") {
    await iniciarSesionAsesor(to, messageId, buttonId, accion.origen || "paciente");
    return;
  }

  if (accion.type === "appointment_booking") {
    if (!puedeUsarAgendamiento(to)) {
      registrarEvento(to, "flow_completed", {
        messageId,
        buttonId,
        flowKey: buttonId,
        payload: {
          actionType: accion.type,
          enabled: false,
          allowed: false
        }
      });
      await enviarMensajeConMenuPrincipal(to, accion.text);
      return;
    }

    await manejarAgendamientoCita(to, messageId);
    return;
  }

  if (accion.type === "text_with_main_menu") {
    if (buttonId === "main_trabaja") {
      registrarEvento(to, "work_with_us_opened", {
        messageId,
        buttonId,
        flowKey: "trabaja_con_nosotros",
        payload: {
          flowKey: "trabaja_con_nosotros"
        }
      });
    }

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
  const sesionActual = sesionesAgendamiento.get(to) || {};

  sesionesCotizacion.delete(to);
  sesionesResultados.delete(to);
  sesionesResultadosEmpresas.delete(to);
  guardarSesionAgendamiento(to, {
    ...sesionActual,
    paso: "seleccionando_area",
    areas: [],
    timestamp: Date.now()
  });

  registrarEvento(to, "flow_started", {
    messageId,
    buttonId: "paciente_agendar_cita",
    flowKey: "agendamiento_citas",
    payload: {
      actionType: accion.type,
      enabled: true,
      step: "seleccionando_area"
    }
  });

  try {
    const areas = await obtenerAreasAgendables();

    guardarSesionAgendamiento(to, {
      ...sesionesAgendamiento.get(to),
      areas,
      timestamp: Date.now()
    });

    if (!areas.length) {
      await enviarMensajeAgendamientoConNavegacion(
        to,
        "En este momento no encontramos áreas de atención disponibles para agendar por WhatsApp. Por favor intenta más tarde o comunícate con un asesor de FamySALUD."
      );
      return;
    }

    await enviarMensajeAgendamientoConNavegacionSeguro(to, construirMensajeAreasAgendamiento(areas), "seleccionando_area");
  } catch (error) {
    console.warn("[AGENDAMIENTO] No se pudieron cargar áreas de atención:", construirDetalleErrorLog(error, {
      action: "load_appointment_areas",
      flowKey: "agendamiento_citas"
    }));

    await enviarMensajeAgendamientoConNavegacion(
      to,
      `🩺 Bienvenida al agendamiento de citas de FamySALUD.

Estoy preparando tu cita paso a paso.

Por ahora no pude cargar las áreas de atención disponibles. Por favor intenta nuevamente más tarde o vuelve al menú principal.`
    );
  }
}

async function manejarFlujoAgendamiento(from, text, messageId) {
  const sesion = obtenerSesionAgendamiento(from);

  if (!sesion) {
    await enviarMenu(from, "pacientes");
    return;
  }

  if (sesion.paso === "seleccionando_area") {
    await manejarSeleccionAreaAgendamiento(from, text, messageId, sesion);
    return;
  }

  if (sesion.paso === "seleccionando_servicio") {
    await manejarSeleccionServicioAgendamiento(from, text, messageId, sesion);
    return;
  }

  if (sesion.paso === "seleccionando_profesional") {
    await manejarSeleccionProfesionalAgendamiento(from, text, messageId, sesion);
    return;
  }

  if (sesion.paso === "seleccionando_modalidad") {
    await manejarSeleccionModalidadAgendamiento(from, text, messageId, sesion);
    return;
  }

  if (sesion.paso === "seleccionando_fecha") {
    await manejarSeleccionFechaAgendamiento(from, text, messageId, sesion);
    return;
  }

  if (sesion.paso === "seleccionando_horario") {
    await manejarSeleccionHorarioAgendamiento(from, text, messageId, sesion);
    return;
  }

  await enviarMensajeAgendamientoConNavegacion(
    from,
    "Estoy preparando el siguiente paso del agendamiento. Por favor usa las opciones disponibles para continuar."
  );
}

async function manejarSeleccionAreaAgendamiento(from, text, messageId, sesion) {
  const indiceArea = obtenerIndiceDesdeTexto(String(text || "").trim());
  const areaSeleccionada = indiceArea === null ? null : sesion.areas?.[indiceArea];

  if (!areaSeleccionada) {
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "agendamiento_area",
      payload: {
        reason: "invalid_appointment_area",
        totalOptions: sesion.areas?.length || 0
      }
    });

    await enviarMensajeAgendamientoConNavegacion(
      from,
      `No encontré esa opción 😅
Por favor responde con un número de la lista.
Ejemplo: 2`
    );
    return;
  }

  try {
    const servicios = await obtenerServiciosAgendablesPorArea(areaSeleccionada.id);

    guardarSesionAgendamiento(from, {
      ...sesion,
      paso: "seleccionando_servicio",
      areaId: areaSeleccionada.id,
      areaTitle: areaSeleccionada.title,
      servicios,
      timestamp: Date.now()
    });

    registrarEvento(from, "button_click", {
      messageId,
      flowKey: "agendamiento_area",
      payload: {
        action: "select_appointment_area",
        selectedIndex: indiceArea,
        areaId: areaSeleccionada.id,
        areaTitle: areaSeleccionada.title
      }
    });

    if (!servicios.length) {
      await enviarMensajeAgendamientoConNavegacion(
        from,
        `Área seleccionada: ${areaSeleccionada.title}

En este momento no encontramos servicios activos para esta área. Puedes volver atrás para seleccionar otra área o regresar al menú principal.`
      );
      return;
    }

    await enviarMensajeAgendamientoConNavegacionSeguro(
      from,
      construirMensajeServiciosAgendamiento(areaSeleccionada.title, servicios),
      "seleccionando_servicio"
    );
  } catch (error) {
    console.warn("[AGENDAMIENTO] No se pudieron cargar servicios del área:", construirDetalleErrorLog(error, {
      action: "load_appointment_services",
      flowKey: "agendamiento_servicios",
      areaId: areaSeleccionada.id
    }));

    await enviarMensajeAgendamientoConNavegacion(
      from,
      "No pude cargar los servicios de esa área en este momento. Por favor intenta nuevamente más tarde o vuelve atrás."
    );
  }
}

async function manejarSeleccionServicioAgendamiento(from, text, messageId, sesion) {
  const indiceServicio = obtenerIndiceDesdeTexto(String(text || "").trim());
  const servicioSeleccionado = indiceServicio === null ? null : sesion.servicios?.[indiceServicio];

  if (!servicioSeleccionado) {
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "agendamiento_servicio",
      payload: {
        reason: "invalid_appointment_service",
        totalOptions: sesion.servicios?.length || 0
      }
    });

    await enviarMensajeAgendamientoConNavegacion(
      from,
      `No encontré esa opción 😅
Por favor elige un número válido de la lista de servicios.
Ejemplo: 1`
    );
    return;
  }

  try {
    const profesionales = await obtenerProfesionalesAgendablesPorServicio(servicioSeleccionado.id);

    guardarSesionAgendamiento(from, {
      ...sesion,
      paso: "seleccionando_profesional",
      serviceId: servicioSeleccionado.id,
      serviceTitle: servicioSeleccionado.title,
      servicePrice: servicioSeleccionado.price,
      salePrice: servicioSeleccionado.sale_price,
      isPresential: servicioSeleccionado.is_presential,
      isVirtual: servicioSeleccionado.is_virtual,
      profesionales,
      timestamp: Date.now()
    });

    registrarEvento(from, "button_click", {
      messageId,
      flowKey: "agendamiento_servicio",
      payload: {
        action: "select_appointment_service",
        selectedIndex: indiceServicio,
        areaId: sesion.areaId,
        areaTitle: sesion.areaTitle,
        serviceId: servicioSeleccionado.id,
        serviceTitle: servicioSeleccionado.title
      }
    });

    if (!profesionales.length) {
      await enviarMensajeAgendamientoConNavegacion(
        from,
        `Servicio seleccionado: ${servicioSeleccionado.title}

Por ahora no encontramos profesionales con horarios configurados para este servicio. Puedes volver atrás para seleccionar otro servicio o regresar al menú principal.`
      );
      return;
    }

    await enviarMensajeAgendamientoConNavegacionSeguro(
      from,
      construirMensajeProfesionalesAgendamiento(servicioSeleccionado.title, profesionales),
      "seleccionando_profesional"
    );
  } catch (error) {
    console.warn("[AGENDAMIENTO] No se pudieron cargar profesionales del servicio:", construirDetalleErrorLog(error, {
      action: "load_appointment_professionals",
      flowKey: "agendamiento_profesionales",
      serviceId: servicioSeleccionado.id
    }));

    await enviarMensajeAgendamientoConNavegacion(
      from,
      "No pude cargar los profesionales de ese servicio en este momento. Por favor intenta nuevamente más tarde o vuelve atrás."
    );
  }
}

async function manejarSeleccionProfesionalAgendamiento(from, text, messageId, sesion) {
  const indiceProfesional = obtenerIndiceDesdeTexto(String(text || "").trim());
  const profesionalSeleccionado = indiceProfesional === null ? null : sesion.profesionales?.[indiceProfesional];

  if (!profesionalSeleccionado) {
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "agendamiento_profesional",
      payload: {
        reason: "invalid_appointment_professional",
        totalOptions: sesion.profesionales?.length || 0
      }
    });

    await enviarMensajeAgendamientoConNavegacion(
      from,
      `No encontré esa opción 😅
Por favor elige un número válido de la lista de profesionales.
Ejemplo: 1`
    );
    return;
  }

  const modalidades = obtenerModalidadesServicio(sesion);

  registrarEvento(from, "button_click", {
    messageId,
    flowKey: "agendamiento_profesional",
    payload: {
      action: "select_appointment_professional",
      selectedIndex: indiceProfesional,
      professionalId: profesionalSeleccionado.id,
      professionalName: profesionalSeleccionado.name,
      serviceId: sesion.serviceId,
      serviceTitle: sesion.serviceTitle
    }
  });

  if (modalidades.length === 2) {
    guardarSesionAgendamiento(from, {
      ...sesion,
      paso: "seleccionando_modalidad",
      professionalId: profesionalSeleccionado.id,
      professionalName: profesionalSeleccionado.name,
      modalidades,
      timestamp: Date.now()
    });

    await enviarMensajeAgendamientoConNavegacion(
      from,
      construirMensajeModalidadesAgendamiento(profesionalSeleccionado.name)
    );
    return;
  }

  if (modalidades.length === 1) {
    const modalidad = modalidades[0];
    const nuevaSesion = {
      ...sesion,
      paso: "seleccionando_fecha",
      professionalId: profesionalSeleccionado.id,
      professionalName: profesionalSeleccionado.name,
      modalidades,
      appointmentMode: modalidad.value,
      modalidadSeleccionUnica: true,
      timestamp: Date.now()
    };

    guardarSesionAgendamiento(from, nuevaSesion);
    await enviarMensajeAgendamientoConNavegacion(
      from,
      construirMensajeModalidadUnicaAgendamiento(profesionalSeleccionado.name, modalidad.label)
    );
    await iniciarSeleccionFechaAgendamiento(from, nuevaSesion);
    return;
  }

  guardarSesionAgendamiento(from, {
    ...sesion,
    professionalId: profesionalSeleccionado.id,
    professionalName: profesionalSeleccionado.name,
    modalidades: [],
    timestamp: Date.now()
  });

  await enviarMensajeAgendamientoConNavegacion(
    from,
    `Profesional seleccionado: ${profesionalSeleccionado.name}

No pude determinar la modalidad disponible para este servicio. Puedes volver atrás para elegir otro profesional o regresar al menú principal.`
  );
}

async function manejarSeleccionModalidadAgendamiento(from, text, messageId, sesion) {
  const indiceModalidad = obtenerIndiceDesdeTexto(String(text || "").trim());
  const modalidadSeleccionada = indiceModalidad === null ? null : sesion.modalidades?.[indiceModalidad];

  if (!modalidadSeleccionada) {
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "agendamiento_modalidad",
      payload: {
        reason: "invalid_appointment_mode",
        totalOptions: sesion.modalidades?.length || 0
      }
    });

    await enviarMensajeAgendamientoConNavegacion(
      from,
      `No encontré esa modalidad 😅
Por favor responde con 1 para Presencial o 2 para Virtual.`
    );
    return;
  }

  const nuevaSesion = {
    ...sesion,
    paso: "seleccionando_fecha",
    appointmentMode: modalidadSeleccionada.value,
    modalidadSeleccionUnica: false,
    timestamp: Date.now()
  };

  guardarSesionAgendamiento(from, nuevaSesion);

  registrarEvento(from, "button_click", {
    messageId,
    flowKey: "agendamiento_modalidad",
    payload: {
      action: "select_appointment_mode",
      selectedIndex: indiceModalidad,
      appointmentMode: modalidadSeleccionada.value,
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId
    }
  });

  await iniciarSeleccionFechaAgendamiento(from, nuevaSesion);
}

async function manejarSeleccionFechaAgendamiento(from, text, messageId, sesion) {
  const indiceFecha = obtenerIndiceDesdeTexto(String(text || "").trim());
  const fechaSeleccionada = indiceFecha === null ? null : sesion.fechasDisponibles?.[indiceFecha];

  if (!fechaSeleccionada) {
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "agendamiento_fecha",
      payload: {
        reason: "invalid_appointment_date",
        totalOptions: sesion.fechasDisponibles?.length || 0
      }
    });

    await enviarMensajeAgendamientoConNavegacion(
      from,
      `No encontré esa fecha 😅
Por favor responde con un número válido de la lista de fechas.
Ejemplo: 1`
    );
    return;
  }

  const sesionConFecha = {
    ...sesion,
    appointmentDate: fechaSeleccionada.date,
    appointmentDateLabel: fechaSeleccionada.label,
    timestamp: Date.now()
  };

  guardarSesionAgendamiento(from, sesionConFecha);

  registrarEvento(from, "button_click", {
    messageId,
    flowKey: "agendamiento_fecha",
    payload: {
      action: "select_appointment_date",
      selectedIndex: indiceFecha,
      appointmentDate: fechaSeleccionada.date,
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId
    }
  });

  await iniciarSeleccionHorarioAgendamiento(from, sesionConFecha);
}

async function iniciarSeleccionHorarioAgendamiento(to, sesion) {
  try {
    if (!sesion.appointmentMode) {
      await enviarMensajeAgendamientoConNavegacion(
        to,
        "No pude determinar la modalidad de atención para consultar horarios. Puedes volver atrás para seleccionar la modalidad o regresar al menú principal."
      );
      return;
    }

    const horariosDisponibles = await consultarHorariosDisponiblesAgendamiento(sesion);

    guardarSesionAgendamiento(to, {
      ...sesionesAgendamiento.get(to),
      paso: "seleccionando_horario",
      horariosDisponibles,
      timestamp: Date.now()
    });

    if (!horariosDisponibles.length) {
      await enviarMensajeAgendamientoConNavegacion(
        to,
        `Fecha seleccionada: ${sesion.appointmentDateLabel}

Por ahora no encontramos horarios disponibles para esta fecha. Puedes volver atrás para elegir otra fecha o regresar al menú principal.`
      );
      return;
    }

    await enviarMensajeAgendamientoConNavegacionSeguro(
      to,
      construirMensajeHorariosAgendamiento(sesion, horariosDisponibles),
      "seleccionando_horario"
    );
  } catch (error) {
    console.warn("[AGENDAMIENTO] No se pudieron cargar horarios disponibles:", construirDetalleErrorLog(error, {
      action: "load_available_times",
      flowKey: "agendamiento_horarios",
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId,
      appointmentDate: sesion.appointmentDate
    }));

    await enviarMensajeAgendamientoConNavegacion(
      to,
      "No pude cargar los horarios disponibles en este momento. Por favor intenta nuevamente más tarde o vuelve atrás."
    );
  }
}

async function manejarSeleccionHorarioAgendamiento(from, text, messageId, sesion) {
  const indiceHorario = obtenerIndiceDesdeTexto(String(text || "").trim());
  const horarioSeleccionado = indiceHorario === null ? null : sesion.horariosDisponibles?.[indiceHorario];

  if (!horarioSeleccionado) {
    registrarEvento(from, "invalid_message", {
      messageId,
      flowKey: "agendamiento_horario",
      payload: {
        reason: "invalid_appointment_time",
        totalOptions: sesion.horariosDisponibles?.length || 0
      }
    });

    await enviarMensajeAgendamientoConNavegacion(
      from,
      `No encontré ese horario 😅
Por favor responde con un número válido de la lista de horarios.
Ejemplo: 1`
    );
    return;
  }

  if (!horarioSeleccionado.end) {
    await enviarMensajeAgendamientoConNavegacion(
      from,
      "No pude determinar la hora de finalización de ese turno. Por favor intenta con otro horario o vuelve atrás."
    );
    return;
  }

  const slotStartEc = formatearHoraHoldAgendamiento(horarioSeleccionado.start);
  const slotEndEc = formatearHoraHoldAgendamiento(horarioSeleccionado.end);

  if (!slotStartEc || !slotEndEc) {
    await enviarMensajeAgendamientoConNavegacion(
      from,
      "No pude normalizar la hora de ese turno. Por favor intenta con otro horario o vuelve atrás."
    );
    return;
  }

  let hold;

  try {
    hold = await crearHoldAgendamientoPersistido({
      phone: from,
      sessionId: obtenerSessionId(from),
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId,
      appointmentDate: sesion.appointmentDate,
      appointmentMode: sesion.appointmentMode,
      slotStartEc,
      slotEndEc,
      expiresAtMs: Date.now() + AGENDAMIENTO_HOLD_TTL_MS
    });
  } catch (error) {
    console.warn("[AGENDAMIENTO] No se pudo crear hold:", construirDetalleErrorLog(error, {
      action: "appointment_hold_create",
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId,
      appointmentDate: sesion.appointmentDate,
      appointmentTime: slotStartEc
    }));

    await enviarMensajeAgendamientoConNavegacion(
      from,
      "No pude reservar temporalmente ese turno en este momento. Por favor intenta con otro horario o vuelve atrás."
    );
    return;
  }

  if (!hold) {
    await enviarMensajeAgendamientoConNavegacion(
      from,
      "Ese turno acaba de ser reservado por otra persona. Por favor elige otro horario disponible."
    );
    return;
  }

  const appointmentTimeLabel = construirEtiquetaHorarioVisibleAgendamiento(horarioSeleccionado, sesion);

  guardarSesionAgendamiento(from, {
    ...sesion,
    paso: "confirmando_turno",
    appointmentTime: slotStartEc,
    appointmentEndTime: slotEndEc,
    appointmentTimeLabel,
    appointmentHoldId: hold.id,
    appointmentHoldExpiresAt: hold.expiresAtMs,
    timestamp: Date.now()
  });

  registrarEvento(from, "button_click", {
    messageId,
    flowKey: "agendamiento_horario",
    payload: {
      action: "select_appointment_time",
      selectedIndex: indiceHorario,
      appointmentDate: sesion.appointmentDate,
      appointmentTime: slotStartEc,
      appointmentEndTime: slotEndEc,
      appointmentHoldId: hold.id,
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId
    }
  });

  await enviarMensajeAgendamientoConNavegacion(
    from,
    `Turno seleccionado:
${sesion.appointmentDateLabel}
${appointmentTimeLabel}

Reservamos temporalmente este turno durante 20 minutos.`
  );
}

async function volverAgendamiento(to, messageId) {
  const sesion = obtenerSesionAgendamiento(to);

  registrarEvento(to, "button_click", {
    messageId,
    buttonId: "agendamiento_volver",
    flowKey: "agendamiento_citas",
    payload: {
      action: "appointment_back",
      step: sesion?.paso || null
    }
  });

  if (sesion?.paso === "seleccionando_fecha") {
    if (!sesion.modalidadSeleccionUnica && Array.isArray(sesion.modalidades) && sesion.modalidades.length > 1) {
      guardarSesionAgendamiento(to, {
        ...sesion,
        paso: "seleccionando_modalidad",
        appointmentMode: null,
        timestamp: Date.now()
      });
      await enviarMensajeAgendamientoConNavegacion(
        to,
        construirMensajeModalidadesAgendamiento(sesion.professionalName)
      );
      return;
    }

    if (Array.isArray(sesion.profesionales) && sesion.profesionales.length) {
      guardarSesionAgendamiento(to, {
        ...sesion,
        paso: "seleccionando_profesional",
        professionalId: null,
        professionalName: null,
        appointmentMode: null,
        modalidadSeleccionUnica: null,
        timestamp: Date.now()
      });
      await enviarMensajeAgendamientoConNavegacionSeguro(
        to,
        construirMensajeProfesionalesAgendamiento(sesion.serviceTitle, sesion.profesionales),
        "seleccionando_profesional"
      );
      return;
    }
  }

  if ((sesion?.paso === "seleccionando_horario" || sesion?.paso === "confirmando_turno")
    && Array.isArray(sesion.fechasDisponibles)
    && sesion.fechasDisponibles.length) {
    if (sesion.appointmentHoldId) {
      liberarHoldAgendamientoSeguro(to, sesion.appointmentHoldId, obtenerSessionId(to));
    }

    guardarSesionAgendamiento(to, {
      ...sesion,
      paso: "seleccionando_fecha",
      appointmentDate: null,
      appointmentDateLabel: null,
      horariosDisponibles: [],
      appointmentTime: null,
      appointmentEndTime: null,
      appointmentTimeLabel: null,
      appointmentHoldId: null,
      appointmentHoldExpiresAt: null,
      timestamp: Date.now()
    });
    await enviarMensajeAgendamientoConNavegacionSeguro(
      to,
      construirMensajeFechasAgendamiento(sesion.fechasDisponibles),
      "seleccionando_fecha"
    );
    return;
  }

  if (sesion?.paso === "seleccionando_modalidad" && Array.isArray(sesion.profesionales) && sesion.profesionales.length) {
    guardarSesionAgendamiento(to, {
      ...sesion,
      paso: "seleccionando_profesional",
      professionalId: null,
      professionalName: null,
      appointmentMode: null,
      modalidades: [],
      timestamp: Date.now()
    });
    await enviarMensajeAgendamientoConNavegacionSeguro(
      to,
      construirMensajeProfesionalesAgendamiento(sesion.serviceTitle, sesion.profesionales),
      "seleccionando_profesional"
    );
    return;
  }

  if (sesion?.paso === "seleccionando_profesional" && Array.isArray(sesion.servicios) && sesion.servicios.length) {
    guardarSesionAgendamiento(to, {
      ...sesion,
      paso: "seleccionando_servicio",
      serviceId: null,
      serviceTitle: null,
      servicePrice: null,
      salePrice: null,
      isPresential: null,
      isVirtual: null,
      profesionales: [],
      timestamp: Date.now()
    });
    await enviarMensajeAgendamientoConNavegacionSeguro(
      to,
      construirMensajeServiciosAgendamiento(sesion.areaTitle, sesion.servicios),
      "seleccionando_servicio"
    );
    return;
  }

  if (sesion?.paso === "seleccionando_servicio" && Array.isArray(sesion.areas) && sesion.areas.length) {
    guardarSesionAgendamiento(to, {
      ...sesion,
      paso: "seleccionando_area",
      areaId: null,
      areaTitle: null,
      servicios: [],
      timestamp: Date.now()
    });
    await enviarMensajeAgendamientoConNavegacionSeguro(to, construirMensajeAreasAgendamiento(sesion.areas), "seleccionando_area");
    return;
  }

  eliminarSesionAgendamiento(to);
  await enviarMenu(to, "pacientes");
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

async function iniciarSolicitudResultadosEmpresa(from, messageId, buttonId) {
  sesionesCotizacion.delete(from);
  sesionesResultados.delete(from);
  sesionesResultadosEmpresas.set(from, {
    paso: "empresa_solicitando_resultados",
    timestamp: Date.now()
  });

  console.log("[EMPRESA_RESULTADOS] Flujo iniciado:", { from });
  registrarEvento(from, "flow_completed", {
    messageId,
    buttonId,
    flowKey: "empresa_resultados",
    payload: {
      action: "company_results_request_started"
    }
  });

  await enviarMensajeTexto(
    from,
    `📄 Claro, con gusto te ayudamos con la solicitud de resultados para empresa.

Para poder ayudarte, por favor envíanos la siguiente información:

1️⃣ Nombre de la empresa  
2️⃣ RUC  
3️⃣ Nombre de la persona que solicita  
4️⃣ Número de contacto  
5️⃣ Correo electrónico  
6️⃣ Detalle de los resultados que necesita consultar

Puedes enviar todo en un solo mensaje 😊

Importante:
Esta solicitud será registrada como EMPRESA.`
  );
}

function obtenerSesionResultados(from) {
  return sesionesResultados.get(from) || null;
}

function estaEnFlujoResultados(from) {
  return Boolean(obtenerSesionResultados(from));
}

function obtenerSesionResultadosEmpresa(from) {
  return sesionesResultadosEmpresas.get(from) || null;
}

function estaEnFlujoResultadosEmpresa(from) {
  return Boolean(obtenerSesionResultadosEmpresa(from));
}

async function iniciarSolicitudProveedor(from, messageId, buttonId) {
  sesionesCotizacion.delete(from);
  sesionesResultados.delete(from);
  sesionesResultadosEmpresas.delete(from);
  limpiarSesionAlianza(from);
  sesionesProveedor.set(from, {
    tipo: "potencial",
    paso: "proveedor_esperando_texto",
    datosProveedor: null,
    mensajesAdicionales: [],
    adjuntos: [],
    temporizador: null,
    timestamp: Date.now()
  });
  reiniciarTemporizadorProveedor(from);

  console.log("[PROVEEDOR] Flujo iniciado:", { from });
  registrarEvento(from, "flow_completed", {
    messageId,
    buttonId,
    flowKey: "proveedor",
    payload: {
      action: "provider_request_started"
    }
  });

  await enviarMensajeTexto(
    from,
    `🤝 ¡Gracias por tu interés en ser proveedor de FamySALUD!

Para revisar tu propuesta, primero envíanos la información principal en texto, en un solo mensaje:

1️⃣ Nombre de la empresa o proveedor  
2️⃣ RUC o cédula  
3️⃣ Producto o servicio que ofreces  
4️⃣ Ciudad  
5️⃣ Nombre de contacto  
6️⃣ Número de contacto  
7️⃣ Correo electrónico  
8️⃣ Breve descripción de tu propuesta

📌 Después de enviar estos datos, podrás adjuntar catálogos, listas de precios, presentaciones o documentos adicionales si los tienes disponibles.`
  );
}

async function iniciarSolicitudProveedorExistente(from, messageId, buttonId) {
  sesionesCotizacion.delete(from);
  sesionesResultados.delete(from);
  sesionesResultadosEmpresas.delete(from);
  limpiarSesionAlianza(from);
  sesionesProveedor.set(from, {
    tipo: "existente",
    paso: "proveedor_existente_esperando_contenido",
    datosProveedor: null,
    mensajesAdicionales: [],
    adjuntos: [],
    temporizador: null,
    timestamp: Date.now()
  });
  reiniciarTemporizadorProveedor(from);

  console.log("[PROVEEDOR_EXISTENTE] Flujo iniciado:", { from });
  registrarEvento(from, "flow_completed", {
    messageId,
    buttonId,
    flowKey: "proveedor_existente",
    payload: {
      action: "existing_provider_request_started"
    }
  });

  await enviarMensajeTexto(
    from,
    `🤝 Gracias por comunicarte con FamySALUD.

Para revisar tu solicitud como proveedor, primero envíanos la información principal en texto, en un solo mensaje:

1️⃣ Nombre de la empresa o proveedor
2️⃣ Motivo de la solicitud
3️⃣ Detalle de lo que necesitas
4️⃣ Nombre y número de contacto

📎 Después de enviar estos datos, podrás adjuntar documentos, imágenes o archivos adicionales si lo deseas.

✅ Cuando termines, escribe *finalizar* para enviar tu solicitud.`
  );
}

function obtenerSesionProveedor(from) {
  return sesionesProveedor.get(from) || null;
}

function estaEnFlujoProveedor(from) {
  return Boolean(obtenerSesionProveedor(from));
}

async function manejarFlujoProveedor(from, text, message, messageId) {
  const sesion = obtenerSesionProveedor(from);

  if (!sesion) {
    await iniciarSolicitudProveedor(from, messageId, "proveedor_propuesta");
    return;
  }

  if (sesion.paso === "proveedor_esperando_texto") {
    await manejarTextoInicialProveedor(from, text, message, messageId, sesion);
    return;
  }

  if (sesion.paso === "proveedor_esperando_archivos") {
    await manejarArchivosProveedor(from, text, message, messageId, sesion);
    return;
  }

  if (sesion.paso === "proveedor_existente_esperando_contenido") {
    await manejarSolicitudProveedorExistente(from, text, message, messageId, sesion);
    return;
  }

  console.log("[PROVEEDOR] Paso no reconocido:", { from, paso: sesion.paso });
  limpiarSesionProveedor(from);
  await enviarMenu(from, "proveedores");
}

async function manejarTextoInicialProveedor(from, text, message, messageId, sesion) {
  if (!text || !text.trim()) {
    console.log("[PROVEEDOR] Archivo recibido antes del texto:", {
      from,
      tipo: message?.type
    });
    await enviarMensajeTexto(
      from,
      "📄 Antes de enviar archivos o catálogos, por favor envíanos primero la información solicitada en texto 😊"
    );
    return;
  }

  const datosProveedor = text.trim();
  sesionesProveedor.set(from, {
    ...sesion,
    paso: "proveedor_esperando_archivos",
    datosProveedor,
    mensajesAdicionales: sesion.mensajesAdicionales || [],
    adjuntos: sesion.adjuntos || [],
    timestamp: Date.now()
  });
  reiniciarTemporizadorProveedor(from);

  registrarEvento(from, "flow_completed", {
    messageId,
    flowKey: "proveedor",
    payload: {
      action: "provider_text_received"
    }
  });

  console.log("[PROVEEDOR] Informacion principal recibida:", { from });
  await enviarMensajeTexto(
    from,
    `✅ Hemos recibido la información principal de tu propuesta.

Si deseas, ahora puedes enviarnos:
📎 catálogos
📎 listas de precios
📎 documentos
📎 imágenes
📎 presentaciones

Cuando hayas terminado, escribe:
finalizar`
  );
}

async function manejarArchivosProveedor(from, text, message, messageId, sesion) {
  const mensaje = (text || "").trim();

  if (mensaje.toLowerCase() === "finalizar") {
    await finalizarSolicitudProveedor(from, "manual", messageId);
    return;
  }

  if (mensaje) {
    sesionesProveedor.set(from, {
      ...sesion,
      mensajesAdicionales: [...(sesion.mensajesAdicionales || []), mensaje],
      timestamp: Date.now()
    });
    reiniciarTemporizadorProveedor(from);
    await enviarMensajeTexto(
      from,
      "✅ Mensaje adicional recibido.\n\nPuedes seguir enviando más información o escribir:\nfinalizar"
    );
    return;
  }

  if (esMensajeMultimedia(message)) {
    console.log("[PROVEEDOR_ADJUNTO] Recibiendo archivo:", {
      from,
      tipo: message.type
    });
    const adjuntos = [...(sesion.adjuntos || [])];
    try {
      const adjunto = await descargarAdjuntoProveedor(message);
      adjuntos.push(adjunto);
    } catch (error) {
      console.warn("[PROVEEDOR_ADJUNTO] Error descargando archivo:", error.message);
      adjuntos.push({
        tipo: message.type,
        mediaId: message?.[message.type]?.id || null,
        error: error.message,
        caption: message?.[message.type]?.caption || ""
      });
    }
    sesionesProveedor.set(from, {
      ...sesion,
      adjuntos,
      timestamp: Date.now()
    });
    reiniciarTemporizadorProveedor(from);
    await enviarMensajeTexto(
      from,
      "✅ Archivo recibido correctamente.\n\nPuedes seguir enviando más archivos o escribir:\nfinalizar"
    );
    return;
  }

  await enviarMensajeTexto(
    from,
    "Puedes enviar archivos adicionales o escribir:\nfinalizar"
  );
}

async function manejarSolicitudProveedorExistente(from, text, message, messageId, sesion) {
  const mensaje = (text || "").trim();

  if (mensaje.toLowerCase() === "finalizar") {
    if (!solicitudProveedorTieneContenido(sesion)) {
      await enviarMensajeTexto(
        from,
        "Antes de finalizar, por favor envíanos la información de tu solicitud o adjunta un archivo de respaldo."
      );
      return;
    }

    await finalizarSolicitudProveedorExistente(from, "manual", messageId);
    return;
  }

  if (mensaje) {
    sesionesProveedor.set(from, {
      ...sesion,
      mensajesAdicionales: [...(sesion.mensajesAdicionales || []), mensaje],
      timestamp: Date.now()
    });
    reiniciarTemporizadorProveedor(from);
    await enviarMensajeTexto(
      from,
      "✅ Mensaje recibido.\n\nPuedes seguir enviando información, adjuntar archivos o escribir:\nfinalizar"
    );
    return;
  }

  if (esMensajeMultimedia(message)) {
    console.log("[PROVEEDOR_EXISTENTE_ADJUNTO] Recibiendo archivo:", {
      from,
      tipo: message.type
    });
    const adjuntos = [...(sesion.adjuntos || [])];
    try {
      const adjunto = await descargarAdjuntoProveedor(message);
      adjuntos.push(adjunto);
    } catch (error) {
      console.warn("[PROVEEDOR_EXISTENTE_ADJUNTO] Error descargando archivo:", error.message);
      adjuntos.push({
        tipo: message.type,
        mediaId: message?.[message.type]?.id || null,
        error: error.message,
        caption: message?.[message.type]?.caption || ""
      });
    }
    sesionesProveedor.set(from, {
      ...sesion,
      adjuntos,
      timestamp: Date.now()
    });
    reiniciarTemporizadorProveedor(from);
    await enviarMensajeTexto(
      from,
      "✅ Archivo recibido correctamente.\n\nPuedes seguir enviando información o escribir:\nfinalizar"
    );
    return;
  }

  await enviarMensajeTexto(
    from,
    "Puedes enviarnos la información de tu solicitud, adjuntar archivos o escribir:\nfinalizar"
  );
}

async function iniciarSolicitudAlianza(from, messageId, buttonId) {
  sesionesCotizacion.delete(from);
  sesionesResultados.delete(from);
  sesionesResultadosEmpresas.delete(from);
  limpiarSesionProveedor(from);
  sesionesAlianza.set(from, {
    tipo: "potencial",
    datosAlianza: null,
    mensajesAdicionales: [],
    adjuntos: [],
    temporizador: null,
    timestamp: Date.now()
  });
  reiniciarTemporizadorAlianza(from);

  console.log("[ALIANZA] Flujo iniciado:", { from });
  registrarEvento(from, "flow_completed", {
    messageId,
    buttonId,
    flowKey: "alianza",
    payload: {
      action: "alliance_request_started"
    }
  });

  await enviarMensajeTexto(
    from,
    `🤝 ¡Gracias por tu interés en crear una alianza estratégica con FamySALUD!

Para revisar tu propuesta, primero envíanos la información principal en texto, en un solo mensaje:

1️⃣ Nombre de la empresa, institución o persona
2️⃣ Tipo de alianza que deseas proponer
3️⃣ Ciudad
4️⃣ Nombre de contacto
5️⃣ Número de contacto
6️⃣ Correo electrónico
7️⃣ Breve descripción de la propuesta

📌 Después de enviar estos datos, podrás adjuntar documentos, presentaciones, imágenes o archivos adicionales si los tienes disponibles.

✅ Cuando termines, escribe *finalizar* para enviar tu información.`
  );
}

async function iniciarSolicitudAliadoExistente(from, messageId, buttonId) {
  sesionesCotizacion.delete(from);
  sesionesResultados.delete(from);
  sesionesResultadosEmpresas.delete(from);
  limpiarSesionProveedor(from);
  sesionesAlianza.set(from, {
    tipo: "existente",
    datosAlianza: null,
    mensajesAdicionales: [],
    adjuntos: [],
    temporizador: null,
    timestamp: Date.now()
  });
  reiniciarTemporizadorAlianza(from);

  console.log("[ALIADO_EXISTENTE] Flujo iniciado:", { from });
  registrarEvento(from, "flow_completed", {
    messageId,
    buttonId,
    flowKey: "aliado_existente",
    payload: {
      action: "existing_ally_request_started"
    }
  });

  await enviarMensajeTexto(
    from,
    `🤝 Gracias por comunicarte con FamySALUD.

Para revisar tu solicitud como aliado estratégico, primero envíanos la información principal en texto, en un solo mensaje:

1️⃣ Nombre de la empresa, institución o aliado
2️⃣ Motivo de la solicitud
3️⃣ Detalle de lo que necesitas
4️⃣ Nombre y número de contacto

📎 Después de enviar estos datos, podrás adjuntar documentos, imágenes o archivos adicionales si lo deseas.

✅ Cuando termines, escribe *finalizar* para enviar tu solicitud.`
  );
}

function obtenerSesionAlianza(from) {
  return sesionesAlianza.get(from) || null;
}

function estaEnFlujoAlianza(from) {
  return Boolean(obtenerSesionAlianza(from));
}

async function manejarSolicitudAlianza(from, text, message, messageId) {
  const sesion = obtenerSesionAlianza(from);

  if (!sesion) {
    await iniciarSolicitudAlianza(from, messageId, "alianza_info");
    return;
  }

  if (sesion.tipo === "existente") {
    await manejarSolicitudAliadoExistente(from, text, message, messageId, sesion);
    return;
  }

  const mensaje = (text || "").trim();

  if (mensaje.toLowerCase() === "finalizar") {
    if (!solicitudAlianzaTieneContenido(sesion)) {
      await enviarMensajeTexto(
        from,
        "Antes de finalizar, por favor envíanos la información principal de la alianza o adjunta un archivo de respaldo."
      );
      return;
    }

    await finalizarSolicitudAlianza(from, "manual", messageId);
    return;
  }

  if (mensaje) {
    const datosAlianza = sesion.datosAlianza || mensaje;
    const mensajesAdicionales = sesion.datosAlianza
      ? [...(sesion.mensajesAdicionales || []), mensaje]
      : sesion.mensajesAdicionales || [];

    sesionesAlianza.set(from, {
      ...sesion,
      datosAlianza,
      mensajesAdicionales,
      timestamp: Date.now()
    });
    reiniciarTemporizadorAlianza(from);
    await enviarMensajeTexto(
      from,
      sesion.datosAlianza
        ? "✅ Mensaje adicional recibido.\n\nPuedes seguir enviando información, adjuntar archivos o escribir:\nfinalizar"
        : "✅ Hemos recibido la información principal de tu propuesta.\n\nPuedes adjuntar documentos, presentaciones, imágenes o archivos adicionales si lo deseas.\n\nCuando hayas terminado, escribe:\nfinalizar"
    );
    return;
  }

  if (esMensajeMultimedia(message)) {
    console.log("[ALIANZA_ADJUNTO] Recibiendo archivo:", {
      from,
      tipo: message.type
    });
    const adjuntos = [...(sesion.adjuntos || [])];
    try {
      const adjunto = await descargarAdjuntoProveedor(message);
      adjuntos.push(adjunto);
    } catch (error) {
      console.warn("[ALIANZA_ADJUNTO] Error descargando archivo:", error.message);
      adjuntos.push({
        tipo: message.type,
        mediaId: message?.[message.type]?.id || null,
        error: error.message,
        caption: message?.[message.type]?.caption || ""
      });
    }
    sesionesAlianza.set(from, {
      ...sesion,
      adjuntos,
      timestamp: Date.now()
    });
    reiniciarTemporizadorAlianza(from);
    await enviarMensajeTexto(
      from,
      "✅ Archivo recibido correctamente.\n\nPuedes seguir enviando información o escribir:\nfinalizar"
    );
    return;
  }

  await enviarMensajeTexto(
    from,
    "Puedes enviarnos la información principal de la alianza, adjuntar archivos o escribir:\nfinalizar"
  );
}

async function manejarSolicitudAliadoExistente(from, text, message, messageId, sesion) {
  const mensaje = (text || "").trim();

  if (mensaje.toLowerCase() === "finalizar") {
    if (!solicitudAlianzaTieneContenido(sesion)) {
      await enviarMensajeTexto(
        from,
        "Antes de finalizar, por favor envíanos la información principal de tu solicitud o adjunta un archivo de respaldo."
      );
      return;
    }

    await finalizarSolicitudAliadoExistente(from, "manual", messageId);
    return;
  }

  if (mensaje) {
    sesionesAlianza.set(from, {
      ...sesion,
      mensajesAdicionales: [...(sesion.mensajesAdicionales || []), mensaje],
      timestamp: Date.now()
    });
    reiniciarTemporizadorAlianza(from);
    await enviarMensajeTexto(
      from,
      "✅ Mensaje recibido.\n\nPuedes seguir enviando información, adjuntar archivos o escribir:\nfinalizar"
    );
    return;
  }

  if (esMensajeMultimedia(message)) {
    console.log("[ALIADO_EXISTENTE_ADJUNTO] Recibiendo archivo:", {
      from,
      tipo: message.type
    });
    const adjuntos = [...(sesion.adjuntos || [])];
    try {
      const adjunto = await descargarAdjuntoProveedor(message);
      adjuntos.push(adjunto);
    } catch (error) {
      console.warn("[ALIADO_EXISTENTE_ADJUNTO] Error descargando archivo:", error.message);
      adjuntos.push({
        tipo: message.type,
        mediaId: message?.[message.type]?.id || null,
        error: error.message,
        caption: message?.[message.type]?.caption || ""
      });
    }
    sesionesAlianza.set(from, {
      ...sesion,
      adjuntos,
      timestamp: Date.now()
    });
    reiniciarTemporizadorAlianza(from);
    await enviarMensajeTexto(
      from,
      "✅ Archivo recibido correctamente.\n\nPuedes seguir enviando información o escribir:\nfinalizar"
    );
    return;
  }

  await enviarMensajeTexto(
    from,
    "Puedes enviarnos la información de tu solicitud, adjuntar archivos o escribir:\nfinalizar"
  );
}

function reiniciarTemporizadorAlianza(from) {
  const sesion = obtenerSesionAlianza(from);

  if (!sesion) {
    return;
  }

  if (sesion.temporizador) {
    clearTimeout(sesion.temporizador);
  }

  const temporizador = setTimeout(async () => {
    await expirarSolicitudAlianzaPorInactividad(from);
  }, TIEMPO_EXPIRACION_PROVEEDOR_MS);

  sesionesAlianza.set(from, {
    ...sesion,
    temporizador,
    timestamp: Date.now()
  });

  console.log("[ALIANZA] Temporizador reiniciado:", {
    from,
    tiempoMs: TIEMPO_EXPIRACION_PROVEEDOR_MS
  });
}

async function expirarSolicitudAlianzaPorInactividad(from) {
  const sesion = obtenerSesionAlianza(from);

  if (!sesion) {
    return;
  }

  console.log("[ALIANZA_EXPIRACION] Solicitud expirada por inactividad:", { from });
  if (sesion.tipo === "existente") {
    await finalizarSolicitudAliadoExistente(from, "inactividad");
    return;
  }

  await finalizarSolicitudAlianza(from, "inactividad");
}

function solicitudAlianzaTieneContenido(sesion) {
  return Boolean(
    sesion?.datosAlianza ||
    sesion?.mensajesAdicionales?.length ||
    sesion?.adjuntos?.length
  );
}

async function finalizarSolicitudAlianza(from, motivo = "manual", messageId = null) {
  const sesion = obtenerSesionAlianza(from);

  if (!sesion) {
    return;
  }

  if (!solicitudAlianzaTieneContenido(sesion)) {
    limpiarSesionAlianza(from);
    if (motivo === "inactividad") {
      cancelarExpiracionSesion(from);
      await enviarMensajeConMenuPrincipal(
        from,
        "⏱️ La recepción de tu propuesta de alianza finalizó por inactividad.\n\nNo recibimos información o adjuntos para enviar."
      );
    }
    return;
  }

  try {
    await notificarSolicitudAlianza(from, sesion);
  } catch (error) {
    console.error("[ALIANZA][EMAIL][ERROR] No se pudo enviar la propuesta de alianza:", {
      fromHash: hashUsuario(from),
      attachmentCount: sesion.adjuntos?.length || 0,
      message: error.message
    });
  }

  limpiarSesionAlianza(from, { eliminarAdjuntos: true });
  if (motivo === "inactividad") {
    cancelarExpiracionSesion(from);
  }

  if (messageId) {
    registrarEvento(from, "flow_completed", {
      messageId,
      flowKey: "alianza",
      payload: {
        action: motivo === "inactividad" ? "alliance_request_expired" : "alliance_request_completed",
        attachmentCount: sesion.adjuntos?.length || 0
      }
    });
  }

  console.log("[ALIANZA] Solicitud finalizada:", {
    from,
    motivo,
    adjuntos: sesion.adjuntos?.length || 0
  });

  if (motivo === "inactividad") {
    await enviarMensajeConMenuPrincipal(
      from,
      "⏱️ Tu propuesta de alianza fue enviada por tiempo de espera.\n\nHemos recibido la información enviada y la revisaremos pronto."
    );
    return;
  }

  await enviarMensajeConMenuPrincipal(
    from,
    "✅ Hemos recibido tu información para alianza estratégica.\n\nNuestro equipo la revisará y, si encaja con las necesidades actuales de FamySALUD, podremos tomarla en cuenta para una posible colaboración."
  );
}

async function finalizarSolicitudAliadoExistente(from, motivo = "manual", messageId = null) {
  const sesion = obtenerSesionAlianza(from);

  if (!sesion) {
    return;
  }

  if (!solicitudAlianzaTieneContenido(sesion)) {
    limpiarSesionAlianza(from);
    if (motivo === "inactividad") {
      cancelarExpiracionSesion(from);
      await enviarMensajeConMenuPrincipal(
        from,
        "⏱️ La solicitud como aliado estratégico finalizó por inactividad.\n\nNo recibimos información o adjuntos para enviar."
      );
    }
    return;
  }

  try {
    await notificarSolicitudAliadoExistente(from, sesion);
  } catch (error) {
    console.error("[ALIADO_EXISTENTE][EMAIL][ERROR] No se pudo enviar la solicitud:", {
      fromHash: hashUsuario(from),
      attachmentCount: sesion.adjuntos?.length || 0,
      message: error.message
    });
  }

  limpiarSesionAlianza(from, { eliminarAdjuntos: true });
  if (motivo === "inactividad") {
    cancelarExpiracionSesion(from);
  }

  if (messageId) {
    registrarEvento(from, "flow_completed", {
      messageId,
      flowKey: "aliado_existente",
      payload: {
        action: motivo === "inactividad" ? "existing_ally_request_expired" : "existing_ally_request_completed",
        attachmentCount: sesion.adjuntos?.length || 0
      }
    });
  }

  console.log("[ALIADO_EXISTENTE] Solicitud finalizada:", {
    from,
    motivo,
    adjuntos: sesion.adjuntos?.length || 0
  });

  if (motivo === "inactividad") {
    await enviarMensajeConMenuPrincipal(
      from,
      "⏱️ Tu solicitud como aliado estratégico fue enviada por tiempo de espera.\n\nHemos recibido la información enviada y la revisaremos pronto."
    );
    return;
  }

  await enviarMensajeConMenuPrincipal(
    from,
    "✅ Gracias por comunicarte con FamySALUD.\n\nHemos recibido tu solicitud como aliado estratégico y la revisaremos pronto."
  );
}

function limpiarSesionAlianza(from, opciones = {}) {
  const { eliminarAdjuntos = true } = opciones;
  const sesion = obtenerSesionAlianza(from);

  if (sesion?.temporizador) {
    clearTimeout(sesion.temporizador);
  }

  sesionesAlianza.delete(from);

  if (eliminarAdjuntos && sesion?.adjuntos?.length) {
    eliminarAdjuntosProveedor(sesion.adjuntos);
  }
}

function reiniciarTemporizadorProveedor(from) {
  const sesion = obtenerSesionProveedor(from);

  if (!sesion) {
    return;
  }

  if (sesion.temporizador) {
    clearTimeout(sesion.temporizador);
  }

  const temporizador = setTimeout(async () => {
    await expirarSolicitudProveedorPorInactividad(from);
  }, TIEMPO_EXPIRACION_PROVEEDOR_MS);

  sesionesProveedor.set(from, {
    ...sesion,
    temporizador,
    timestamp: Date.now()
  });

  console.log("[PROVEEDOR] Temporizador reiniciado:", {
    from,
    tiempoMs: TIEMPO_EXPIRACION_PROVEEDOR_MS
  });
}

async function expirarSolicitudProveedorPorInactividad(from) {
  const sesion = obtenerSesionProveedor(from);

  if (!sesion) {
    return;
  }

  console.log("[PROVEEDOR_EXPIRACION] Solicitud expirada por inactividad:", { from });
  if (sesion.tipo === "existente") {
    await finalizarSolicitudProveedorExistente(from, "inactividad");
    return;
  }

  await finalizarSolicitudProveedor(from, "inactividad");
}

function solicitudProveedorTieneContenido(sesion) {
  return Boolean(
    sesion?.datosProveedor ||
    sesion?.mensajesAdicionales?.length ||
    sesion?.adjuntos?.length
  );
}

async function finalizarSolicitudProveedor(from, motivo = "manual", messageId = null) {
  const sesion = obtenerSesionProveedor(from);

  if (!sesion) {
    return;
  }

  try {
    await notificarSolicitudProveedor(from, sesion);
  } catch (error) {
    console.warn("[PROVEEDOR] Error notificando propuesta:", error.message);
  }

  limpiarSesionProveedor(from, { eliminarAdjuntos: true });
  if (motivo === "inactividad") {
    cancelarExpiracionSesion(from);
  }

  if (messageId) {
    registrarEvento(from, "flow_completed", {
      messageId,
      flowKey: "proveedor",
      payload: {
        action: motivo === "inactividad" ? "provider_request_expired" : "provider_request_completed",
        attachmentCount: sesion.adjuntos?.length || 0
      }
    });
  }

  console.log("[PROVEEDOR] Solicitud finalizada:", {
    from,
    motivo,
    adjuntos: sesion.adjuntos?.length || 0
  });

  if (motivo === "inactividad") {
    await enviarMensajeConMenuPrincipal(
      from,
      "⏱️ La recepción de tu propuesta finalizó por inactividad.\n\nHemos recibido la información enviada y nuestro equipo la revisará. Gracias por pensar en FamySALUD 💙"
    );
    return;
  }

  await enviarMensajeConMenuPrincipal(
    from,
    "✅ Hemos recibido tu propuesta de proveedor.\n\nNuestro equipo revisará la información y se comunicará contigo si la propuesta se ajusta a nuestras necesidades actuales.\n\nGracias por pensar en FamySALUD 💙"
  );
}

async function finalizarSolicitudProveedorExistente(from, motivo = "manual", messageId = null) {
  const sesion = obtenerSesionProveedor(from);

  if (!sesion) {
    return;
  }

  if (!solicitudProveedorTieneContenido(sesion)) {
    limpiarSesionProveedor(from);
    if (motivo === "inactividad") {
      cancelarExpiracionSesion(from);
      await enviarMensajeConMenuPrincipal(
        from,
        "⏱️ La solicitud como proveedor finalizó por inactividad.\n\nNo recibimos información o adjuntos para enviar."
      );
    }
    return;
  }

  try {
    await notificarSolicitudProveedorExistente(from, sesion);
  } catch (error) {
    console.warn("[PROVEEDOR_EXISTENTE] Error notificando solicitud:", error.message);
  }

  limpiarSesionProveedor(from, { eliminarAdjuntos: true });
  if (motivo === "inactividad") {
    cancelarExpiracionSesion(from);
  }

  if (messageId) {
    registrarEvento(from, "flow_completed", {
      messageId,
      flowKey: "proveedor_existente",
      payload: {
        action: motivo === "inactividad" ? "existing_provider_request_expired" : "existing_provider_request_completed",
        attachmentCount: sesion.adjuntos?.length || 0
      }
    });
  }

  console.log("[PROVEEDOR_EXISTENTE] Solicitud finalizada:", {
    from,
    motivo,
    adjuntos: sesion.adjuntos?.length || 0
  });

  if (motivo === "inactividad") {
    await enviarMensajeConMenuPrincipal(
      from,
      "⏱️ Tu solicitud como proveedor fue enviada por tiempo de espera.\n\nHemos recibido la información enviada y la revisaremos pronto."
    );
    return;
  }

  await enviarMensajeConMenuPrincipal(
    from,
    "✅ Gracias por comunicarte con FamySALUD.\n\nHemos recibido tu solicitud como proveedor y la revisaremos pronto."
  );
}

function limpiarSesionProveedor(from, opciones = {}) {
  const { eliminarAdjuntos = true } = opciones;
  const sesion = obtenerSesionProveedor(from);

  if (sesion?.temporizador) {
    clearTimeout(sesion.temporizador);
  }

  sesionesProveedor.delete(from);

  if (eliminarAdjuntos && sesion?.adjuntos?.length) {
    eliminarAdjuntosProveedor(sesion.adjuntos);
  }
}

async function descargarAdjuntoProveedor(message) {
  const tipo = message?.type;
  const media = message?.[tipo];

  if (!media?.id) {
    throw new Error("Mensaje multimedia sin media id.");
  }

  if (!WHATSAPP_TOKEN) {
    throw new Error("WHATSAPP_TOKEN no está configurado.");
  }

  const mediaUrl = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${media.id}`;
  const metadata = await axios.get(mediaUrl, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });
  const downloadUrl = metadata.data?.url;

  if (!downloadUrl) {
    throw new Error("No se recibió URL de descarga de media.");
  }

  const archivo = await axios.get(downloadUrl, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });
  const mimeType = media.mime_type || archivo.headers["content-type"] || "application/octet-stream";
  const tmpDir = path.join(__dirname, "tmp", "proveedor-adjuntos");
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const filename = sanitizarNombreArchivoProveedor(
    media.filename || `${Date.now()}-${media.id}.${extensionPorMimeType(mimeType)}`
  );
  const filePath = path.join(tmpDir, filename);
  await fs.promises.writeFile(filePath, Buffer.from(archivo.data));

  console.log("[PROVEEDOR_ADJUNTO] Archivo descargado:", {
    tipo,
    filename,
    mimeType
  });

  return {
    tipo,
    mediaId: media.id,
    path: filePath,
    filename,
    mime_type: mimeType,
    caption: media.caption || ""
  };
}

function eliminarAdjuntosProveedor(adjuntos) {
  for (const adjunto of adjuntos) {
    if (!adjunto.path) {
      continue;
    }

    fs.promises.unlink(adjunto.path).catch((error) => {
      if (error.code !== "ENOENT") {
        console.warn("[PROVEEDOR_ADJUNTO] No se pudo eliminar archivo temporal:", error.message);
      }
    });
  }
}

function sanitizarNombreArchivoProveedor(filename) {
  return String(filename || `adjunto-${Date.now()}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .slice(0, 120);
}

function extensionPorMimeType(mimeType) {
  const extensiones = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "application/pdf": "pdf"
  };

  return extensiones[mimeType] || "bin";
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

async function manejarFlujoResultadosEmpresa(from, text, messageId) {
  const sesion = obtenerSesionResultadosEmpresa(from);

  if (!sesion) {
    await iniciarSolicitudResultadosEmpresa(from, messageId, "empresa_solicitar_resultados");
    return;
  }

  if (sesion.paso !== "empresa_solicitando_resultados") {
    console.log("[EMPRESA_RESULTADOS] Paso no reconocido:", { from, paso: sesion.paso });
    sesionesResultadosEmpresas.delete(from);
    await enviarMenu(from, "empresas");
    return;
  }

  if (!text || !text.trim()) {
    console.log("[EMPRESA_RESULTADOS] Mensaje vacio recibido:", { from });
    await enviarMensajeTexto(
      from,
      "Por favor envíanos la información solicitada en un solo mensaje para continuar."
    );
    return;
  }

  sesionesResultadosEmpresas.delete(from);
  await notificarSolicitudResultadosEmpresa(from, text.trim());

  registrarEvento(from, "flow_completed", {
    messageId,
    flowKey: "empresa_resultados",
    payload: {
      action: "company_results_request_completed"
    }
  });

  console.log("[EMPRESA_RESULTADOS] Solicitud completada:", { from });
  await enviarMensajeConMenuPrincipal(
    from,
    "✅ Hemos recibido tu solicitud de resultados empresariales.\n\nNuestro equipo revisará la información y se comunicará contigo lo antes posible 💙"
  );
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

async function enviarCorreoInternoConEstadisticas(from, flowKey, subject, message, attachments = []) {
  const payloadBase = {
    flowKey,
    attachmentCount: attachments.length
  };

  registrarEvento(from, "email_attempted", {
    flowKey,
    payload: payloadBase
  });

  try {
    await enviarCorreoInterno(subject, message, attachments);
    registrarEvento(from, "email_sent", {
      flowKey,
      payload: payloadBase
    });
  } catch (error) {
    registrarEvento(from, "email_failed", {
      flowKey,
      payload: {
        ...payloadBase,
        errorType: error?.code || error?.name || "email_error"
      }
    });
    throw error;
  }
}

async function notificarSolicitudResultados(from, datos) {
  const message = construirMensajeInternoResultados(from, datos);
  const subject = "Nueva solicitud de resultados - Paciente";
  const resultados = await Promise.allSettled([
    enviarCorreoInternoConEstadisticas(from, "resultados_paciente", subject, message)
  ]);
  const emailStatus = resultados[0].status;

  resultados.forEach((resultado) => {
    if (resultado.status === "rejected") {
      console.warn("[RESULTADOS] Error en notificación interna por correo", {
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
    emailStatus
  });
}

async function notificarSolicitudResultadosEmpresa(from, mensajeUsuario) {
  const message = construirMensajeInternoResultadosEmpresa(from, mensajeUsuario);
  const subject = "Nueva solicitud de resultados - EMPRESA";
  const resultados = await Promise.allSettled([
    enviarCorreoInternoConEstadisticas(from, "resultados_empresa", subject, message)
  ]);
  const emailStatus = resultados[0].status;

  resultados.forEach((resultado) => {
    if (resultado.status === "rejected") {
      console.warn("[CORREO]", "Error en notificación de resultados empresa:", resultado.reason?.message);
      return;
    }

    console.log("[CORREO]", "Notificación de resultados empresa enviada.");
  });

  console.log("[EMPRESA_RESULTADOS] Notificación interna procesada", {
    fromHash: hashUsuario(from),
    emailStatus
  });
}

async function notificarSolicitudProveedor(from, sesion) {
  const message = construirMensajeInternoProveedor(from, sesion);
  const subject = "Nueva propuesta de proveedor - FamySALUD";
  const attachments = construirAdjuntosCorreoProveedor(sesion.adjuntos || []);
  const resultados = await Promise.allSettled([
    enviarCorreoInternoConEstadisticas(from, "proveedor_potencial_propuesta", subject, message, attachments)
  ]);
  const emailStatus = resultados[0].status;

  resultados.forEach((resultado) => {
    if (resultado.status === "rejected") {
      console.warn("[CORREO]", "Error en notificación de proveedor:", resultado.reason?.message);
      return;
    }

    console.log("[CORREO]", "Notificación de proveedor enviada.");
  });

  console.log("[PROVEEDOR] Notificación interna procesada", {
    fromHash: hashUsuario(from),
    emailStatus,
    attachmentCount: attachments.length
  });
}

async function notificarSolicitudProveedorExistente(from, sesion) {
  const message = construirMensajeInternoProveedorExistente(from, sesion);
  const subject = "Nueva solicitud de proveedor existente - FamySALUD";
  const attachments = construirAdjuntosCorreoProveedor(sesion.adjuntos || []);
  const resultados = await Promise.allSettled([
    enviarCorreoInternoConEstadisticas(from, "proveedor_existente_solicitud", subject, message, attachments)
  ]);
  const emailStatus = resultados[0].status;

  resultados.forEach((resultado) => {
    if (resultado.status === "rejected") {
      console.warn("[CORREO]", "Error en notificación de proveedor existente:", resultado.reason?.message);
      return;
    }

    console.log("[CORREO]", "Notificación de proveedor existente enviada.");
  });

  console.log("[PROVEEDOR_EXISTENTE] Notificación interna procesada", {
    fromHash: hashUsuario(from),
    emailStatus,
    attachmentCount: attachments.length
  });
}

async function notificarSolicitudAlianza(from, sesion) {
  const message = construirMensajeInternoAlianza(from, sesion);
  const subject = "Nueva propuesta de alianza estratégica - FamySALUD";
  const attachments = construirAdjuntosCorreoProveedor(sesion.adjuntos || []);
  const resultados = await Promise.allSettled([
    enviarCorreoInternoConEstadisticas(from, "alianza_potencial_propuesta", subject, message, attachments)
  ]);
  const emailResult = resultados[0];
  const emailStatus = emailResult.status;

  if (emailResult.status === "rejected") {
    console.error("[ALIANZA][EMAIL][ERROR] Error enviando correo de alianza:", {
      fromHash: hashUsuario(from),
      subject,
      attachmentCount: attachments.length,
      message: emailResult.reason?.message
    });
    throw emailResult.reason;
  }

  console.log("[ALIANZA][EMAIL] Correo de alianza enviado.", {
    fromHash: hashUsuario(from),
    subject,
    attachmentCount: attachments.length
  });

  console.log("[ALIANZA] Notificación interna procesada", {
    fromHash: hashUsuario(from),
    emailStatus,
    attachmentCount: attachments.length
  });
}

async function notificarSolicitudAliadoExistente(from, sesion) {
  const message = construirMensajeInternoAliadoExistente(from, sesion);
  const subject = "Nueva solicitud de aliado estratégico existente - FamySALUD";
  const attachments = construirAdjuntosCorreoProveedor(sesion.adjuntos || []);
  const resultados = await Promise.allSettled([
    enviarCorreoInternoConEstadisticas(from, "alianza_existente_solicitud", subject, message, attachments)
  ]);
  const emailResult = resultados[0];
  const emailStatus = emailResult.status;

  if (emailResult.status === "rejected") {
    console.error("[ALIADO_EXISTENTE][EMAIL][ERROR] Error enviando correo:", {
      fromHash: hashUsuario(from),
      subject,
      attachmentCount: attachments.length,
      message: emailResult.reason?.message
    });
    throw emailResult.reason;
  }

  console.log("[ALIADO_EXISTENTE][EMAIL] Correo enviado.", {
    fromHash: hashUsuario(from),
    subject,
    attachmentCount: attachments.length
  });

  console.log("[ALIADO_EXISTENTE] Notificación interna procesada", {
    fromHash: hashUsuario(from),
    emailStatus,
    attachmentCount: attachments.length
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

function construirMensajeInternoProveedor(from, sesion) {
  const mensajesAdicionales = sesion.mensajesAdicionales?.length
    ? sesion.mensajesAdicionales.join("\n\n")
    : "Sin mensajes adicionales";
  const adjuntos = sesion.adjuntos || [];
  const archivosConError = adjuntos
    .filter((adjunto) => adjunto.error)
    .map((adjunto) => `- ${adjunto.tipo || "archivo"}: ${adjunto.error}`);

  return [
    "🤝 Nueva propuesta de proveedor",
    "",
    "Datos solicitados:",
    "1️⃣ Nombre de la empresa o proveedor",
    "2️⃣ RUC o cédula",
    "3️⃣ Producto o servicio que ofrece",
    "4️⃣ Ciudad",
    "5️⃣ Nombre de contacto",
    "6️⃣ Número de contacto",
    "7️⃣ Correo electrónico",
    "8️⃣ Breve descripción de la propuesta",
    "",
    "Datos enviados por el usuario:",
    sesion.datosProveedor || "Sin datos principales",
    "",
    "Mensajes adicionales:",
    mensajesAdicionales,
    "",
    "Archivos recibidos:",
    String(adjuntos.length),
    ...(archivosConError.length ? ["", "Notas de adjuntos:", ...archivosConError] : []),
    "",
    "Número de WhatsApp del solicitante:",
    from
  ].join("\n");
}

function construirMensajeInternoProveedorExistente(from, sesion) {
  const mensajes = sesion.mensajesAdicionales?.length
    ? sesion.mensajesAdicionales.join("\n\n")
    : "Sin mensaje de texto";
  const adjuntos = sesion.adjuntos || [];
  const archivosConError = adjuntos
    .filter((adjunto) => adjunto.error)
    .map((adjunto) => `- ${adjunto.tipo || "archivo"}: ${adjunto.error}`);

  return [
    "Nueva solicitud de proveedor existente",
    "",
    "Datos solicitados:",
    "1️⃣ Nombre de la empresa o proveedor",
    "2️⃣ Motivo de la solicitud",
    "3️⃣ Detalle de lo que necesitas",
    "4️⃣ Nombre y número de contacto",
    "",
    "Datos enviados por el usuario:",
    mensajes,
    "",
    "Adjuntos:",
    adjuntos.length
      ? `Se adjuntaron ${adjuntos.length} archivo(s).`
      : "No se adjuntaron archivos.",
    ...(archivosConError.length ? ["", "Notas de adjuntos:", ...archivosConError] : []),
    "",
    "Número de WhatsApp del solicitante:",
    from
  ].join("\n");
}

function construirMensajeInternoAlianza(from, sesion) {
  const mensajesAdicionales = sesion.mensajesAdicionales?.length
    ? sesion.mensajesAdicionales.join("\n\n")
    : "Sin mensajes adicionales";
  const adjuntos = sesion.adjuntos || [];
  const archivosConError = adjuntos
    .filter((adjunto) => adjunto.error)
    .map((adjunto) => `- ${adjunto.tipo || "archivo"}: ${adjunto.error}`);

  return [
    "Nueva propuesta de alianza estratégica",
    "",
    "Datos solicitados:",
    "1️⃣ Nombre de la empresa, institución o persona",
    "2️⃣ Tipo de alianza que deseas proponer",
    "3️⃣ Ciudad",
    "4️⃣ Nombre de contacto",
    "5️⃣ Número de contacto",
    "6️⃣ Correo electrónico",
    "7️⃣ Breve descripción de la propuesta",
    "",
    "Datos enviados por el usuario:",
    sesion.datosAlianza || "Sin datos principales",
    "",
    "Mensajes adicionales:",
    mensajesAdicionales,
    "",
    "Archivos recibidos:",
    String(adjuntos.length),
    ...(archivosConError.length ? ["", "Notas de adjuntos:", ...archivosConError] : []),
    "",
    "Número de WhatsApp del solicitante:",
    from
  ].join("\n");
}

function construirMensajeInternoAliadoExistente(from, sesion) {
  const mensajes = sesion.mensajesAdicionales?.length
    ? sesion.mensajesAdicionales.join("\n\n")
    : "Sin mensaje de texto";
  const adjuntos = sesion.adjuntos || [];
  const archivosConError = adjuntos
    .filter((adjunto) => adjunto.error)
    .map((adjunto) => `- ${adjunto.tipo || "archivo"}: ${adjunto.error}`);

  return [
    "Nueva solicitud de aliado estratégico existente",
    "",
    "Datos solicitados:",
    "1️⃣ Nombre de la empresa, institución o aliado",
    "2️⃣ Motivo de la solicitud",
    "3️⃣ Detalle de lo que necesitas",
    "4️⃣ Nombre y número de contacto",
    "",
    "Datos enviados por el usuario:",
    mensajes,
    "",
    "Adjuntos:",
    adjuntos.length
      ? `Se adjuntaron ${adjuntos.length} archivo(s).`
      : "No se adjuntaron archivos.",
    ...(archivosConError.length ? ["", "Notas de adjuntos:", ...archivosConError] : []),
    "",
    "Número de WhatsApp del solicitante:",
    from
  ].join("\n");
}

function construirAdjuntosCorreoProveedor(adjuntos) {
  return adjuntos
    .filter((adjunto) => adjunto.path && !adjunto.error)
    .map((adjunto) => ({
      filename: adjunto.filename,
      path: adjunto.path,
      contentType: adjunto.mime_type
    }));
}

function construirMensajeInternoResultadosEmpresa(from, mensajeUsuario) {
  return [
    "📄 Nueva solicitud de resultados - EMPRESA",
    "",
    "Datos solicitados:",
    "1️⃣ Nombre de la empresa",
    "2️⃣ RUC",
    "3️⃣ Nombre de la persona que solicita",
    "4️⃣ Número de contacto",
    "5️⃣ Correo electrónico",
    "6️⃣ Detalle de los resultados que necesita consultar",
    "",
    "Datos enviados por el usuario:",
    mensajeUsuario,
    "",
    "Número de WhatsApp del solicitante:",
    from
  ].join("\n");
}

async function enviarCorreoInterno(subject, message, attachments = []) {
  console.log("[EMAIL][CONFIG]", {
    from: INTERNAL_EMAIL_FROM,
    toConfigured: Boolean(INTERNAL_NOTIFICATION_EMAIL),
    smtpHostConfigured: Boolean(SMTP_HOST)
  });

  if (!INTERNAL_NOTIFICATION_EMAIL || !INTERNAL_EMAIL_FROM || !SMTP_HOST) {
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
    from: INTERNAL_EMAIL_FROM,
    to: INTERNAL_NOTIFICATION_EMAIL,
    subject,
    text: message,
    attachments
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

  const sesionAgendamiento = sesionesAgendamiento.get(from);
  if (sesionAgendamiento) {
    guardarSesionAgendamiento(from, {
      ...sesionAgendamiento,
      timestamp: Date.now()
    });
  }
}

function limpiarSesionesUsuario(from) {
  const sessionId = obtenerSessionId(from);
  sesionesUsuarios.delete(from);
  sesionesCotizacion.delete(from);
  eliminarSesionAgendamiento(from, sessionId);
  sesionesResultados.delete(from);
  sesionesResultadosEmpresas.delete(from);
  limpiarSesionProveedor(from);
  sesionesExpiradas.delete(from);
  cancelarExpiracionSesion(from);
}

function programarExpiracionSesion(from, delayMs = SESION_USUARIO_TTL_MS) {
  cancelarExpiracionSesion(from);

  const timer = setTimeout(() => {
    expirarSesionUsuario(from);
  }, delayMs);

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

  if (estaEnFlujoAsesor(from)) {
    cancelarExpiracionSesion(from);
    return;
  }

  if (obtenerSesionProveedor(from)) {
    await expirarSolicitudProveedorPorInactividad(from);
    return;
  }

  if (obtenerSesionAlianza(from)) {
    await expirarSolicitudAlianzaPorInactividad(from);
    return;
  }

  const sessionId = sesion.sessionId;
  sesionesUsuarios.delete(from);
  sesionesCotizacion.delete(from);
  eliminarSesionAgendamiento(from, sessionId);
  sesionesResultados.delete(from);
  sesionesResultadosEmpresas.delete(from);
  limpiarSesionProveedor(from);
  limpiarSesionAlianza(from);
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

  if (estaEnFlujoAsesor(from)) {
    cancelarExpiracionSesion(from);
    return false;
  }

  const sessionId = sesion.sessionId;
  sesionesUsuarios.delete(from);
  sesionesCotizacion.delete(from);
  eliminarSesionAgendamiento(from, sessionId);
  sesionesResultados.delete(from);
  sesionesResultadosEmpresas.delete(from);
  limpiarSesionProveedor(from);
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

function obtenerSesionAgendamiento(from) {
  return sesionesAgendamiento.get(from) || null;
}

function estaEnFlujoAgendamiento(from) {
  return Boolean(obtenerSesionAgendamiento(from));
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

function botonVolverAgendamiento() {
  return boton("agendamiento_volver", "⬅️ Volver atrás");
}

function catalogoServiciosValido(catalogo) {
  return Boolean(catalogo && typeof catalogo === "object" && Array.isArray(catalogo.areas));
}

async function cargarCatalogoServiciosPersistente({ usarComoFallback = false } = {}) {
  try {
    await fs.promises.mkdir(CATALOG_CACHE_DIR, { recursive: true });
    const contenido = await fs.promises.readFile(CATALOG_CACHE_FILE, "utf8");
    const catalogo = JSON.parse(contenido);

    if (!catalogoServiciosValido(catalogo)) {
      throw new Error("El archivo no contiene un catalogo valido.");
    }

    catalogoServiciosCache = catalogo;
    catalogoServiciosCacheTimestamp = Date.now();

    console.log(usarComoFallback
      ? "[CATALOGO] Usando cache persistente local."
      : "[CATALOGO] Cache persistente cargada.", {
      path: CATALOG_CACHE_FILE,
      areas: catalogo.areas.length,
      updated_at: catalogo.updated_at
    });

    return catalogo;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn("[CATALOGO] Cache persistente no encontrada.", {
        path: CATALOG_CACHE_FILE
      });
      return null;
    }

    console.warn("[CATALOGO] Error leyendo cache persistente.", {
      path: CATALOG_CACHE_FILE,
      message: error.message
    });
    return null;
  }
}

async function guardarCatalogoServiciosPersistente(catalogo) {
  try {
    await fs.promises.mkdir(CATALOG_CACHE_DIR, { recursive: true });
    await fs.promises.writeFile(
      CATALOG_CACHE_FILE,
      JSON.stringify(catalogo, null, 2),
      "utf8"
    );
    console.log("[CATALOGO] Cache persistente actualizada.", {
      path: CATALOG_CACHE_FILE,
      areas: Array.isArray(catalogo?.areas) ? catalogo.areas.length : 0,
      updated_at: catalogo?.updated_at
    });
  } catch (error) {
    console.warn("[CATALOGO] Error actualizando cache persistente.", {
      path: CATALOG_CACHE_FILE,
      message: error.message
    });
  }
}

function unirUrlBaseYPath(baseUrl, ruta) {
  const base = String(baseUrl || "").trim();
  const pathCatalogo = String(ruta || "").trim();

  if (!base || !pathCatalogo) {
    return "";
  }

  return `${base.replace(/\/+$/, "")}/${pathCatalogo.replace(/^\/+/, "")}`;
}

function obtenerCatalogoServiciosUrl() {
  const urlCompleta = String(CHATBOT_CATALOG_URL || "").trim();

  if (urlCompleta) {
    return urlCompleta;
  }

  return unirUrlBaseYPath(CHATBOT_CATALOG_BASE_URL, CHATBOT_CATALOG_PATH);
}

function sanearUrlParaLog(url) {
  try {
    const parsedUrl = new URL(url);

    parsedUrl.username = parsedUrl.username ? "[redacted]" : "";
    parsedUrl.password = parsedUrl.password ? "[redacted]" : "";

    for (const key of parsedUrl.searchParams.keys()) {
      if (/token|key|secret|password|pass|auth|credential/i.test(key)) {
        parsedUrl.searchParams.set(key, "[redacted]");
      }
    }

    return parsedUrl.toString();
  } catch (error) {
    return String(url || "").replace(/([?&][^=]*(?:token|key|secret|password|pass|auth|credential)[^=]*=)[^&]*/gi, "$1[redacted]");
  }
}

async function refrescarCatalogoServiciosDesdeApi() {
  const catalogoUrl = obtenerCatalogoServiciosUrl();
  const catalogoUrlLog = sanearUrlParaLog(catalogoUrl);

  if (!catalogoUrl) {
    throw new Error("Configura CHATBOT_CATALOG_URL o CHATBOT_CATALOG_BASE_URL + CHATBOT_CATALOG_PATH.");
  }

  console.log("[CATALOGO] Consultando API.", {
    catalogUrl: catalogoUrlLog
  });

  const response = await axios.get(catalogoUrl, {
    timeout: 10000
  });

  if (!catalogoServiciosValido(response.data)) {
    throw new Error("La API no devolvio un catalogo valido.");
  }

  catalogoServiciosCache = response.data;
  catalogoServiciosCacheTimestamp = Date.now();
  await guardarCatalogoServiciosPersistente(response.data);

  console.log("[CATALOGO] Catalogo recibido:", {
    catalogUrl: catalogoUrlLog,
    status: response.status,
    areas: response.data.areas.length,
    updated_at: response.data?.updated_at
  });

  return response.data;
}

async function consultarCatalogoServicios() {
  const now = Date.now();

  if (catalogoServiciosCache && now - catalogoServiciosCacheTimestamp <= CATALOG_CACHE_TTL_MS) {
    console.log("[CATALOGO] Usando cache", {
      ageMs: now - catalogoServiciosCacheTimestamp
    });
    return catalogoServiciosCache;
  }

  try {
    return await refrescarCatalogoServiciosDesdeApi();
  } catch (error) {
    if (catalogoServiciosCache) {
      console.warn("[CATALOGO] Usando cache anterior por error", {
        message: error.message,
        status: error.response?.status,
        catalogUrl: sanearUrlParaLog(obtenerCatalogoServiciosUrl())
      });
      return catalogoServiciosCache;
    }

    const catalogoPersistente = await cargarCatalogoServiciosPersistente({ usarComoFallback: true });

    if (catalogoPersistente) {
      return catalogoPersistente;
    }

    console.error("[CATALOGO] Error sin cache disponible", {
      message: error.message,
      status: error.response?.status,
      catalogUrl: sanearUrlParaLog(obtenerCatalogoServiciosUrl())
    });
    throw error;
  }
}

async function refrescarCatalogoServiciosEnSegundoPlano() {
  try {
    await refrescarCatalogoServiciosDesdeApi();
    console.log("[CATALOGO] Refresh automatico completado.");
  } catch (error) {
    console.warn("[CATALOGO] Refresh automatico fallido. Se mantiene cache previa.", {
      message: error.message,
      status: error.response?.status,
      catalogUrl: sanearUrlParaLog(obtenerCatalogoServiciosUrl())
    });
  }
}

function iniciarRefreshAutomaticoCatalogo() {
  if (catalogoServiciosRefreshInterval) {
    return;
  }

  catalogoServiciosRefreshInterval = setInterval(() => {
    refrescarCatalogoServiciosEnSegundoPlano();
  }, CATALOG_CACHE_TTL_MS);

  if (typeof catalogoServiciosRefreshInterval.unref === "function") {
    catalogoServiciosRefreshInterval.unref();
  }

  console.log("[CATALOGO] Refresh automatico configurado.", {
    intervalMs: CATALOG_CACHE_TTL_MS
  });
}

async function inicializarCatalogoServicios() {
  await cargarCatalogoServiciosPersistente();
  iniciarRefreshAutomaticoCatalogo();
  refrescarCatalogoServiciosEnSegundoPlano();
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

function construirMensajeAreasAgendamiento(areas) {
  const listadoAreas = areas
    .map((area, index) => `${index + 1}. ${area.title}`)
    .join("\n");

  return `Selecciona el área de atención que deseas agendar:

${listadoAreas}

Responde con el número del área.
Ejemplo: 2`;
}

function construirMensajeServiciosAgendamiento(areaTitle, servicios) {
  const listadoServicios = servicios
    .map((servicio, index) => `${index + 1}. ${construirTituloServicioAgendamiento(servicio)}`)
    .join("\n");

  return `Área seleccionada: ${areaTitle}

Ahora selecciona el servicio que deseas agendar:

${listadoServicios}

Responde con el número del servicio.
Ejemplo: 1`;
}

function construirTituloServicioAgendamiento(servicio) {
  const precio = obtenerPrecioNumerico(servicio.price);

  if (precio === null) {
    return servicio.title;
  }

  return `${servicio.title} (Transferencia: ${formatearPrecio(precio)})`;
}

function construirMensajeProfesionalesAgendamiento(serviceTitle, profesionales) {
  const listadoProfesionales = profesionales
    .map((profesional, index) => `${index + 1}. ${profesional.name}`)
    .join("\n");

  return `Servicio seleccionado: ${serviceTitle}

Ahora selecciona el profesional con quien deseas agendar:

${listadoProfesionales}

Responde con el número del profesional.
Ejemplo: 1`;
}

function obtenerModalidadesServicio(sesion) {
  const modalidades = [];

  if (sesion.isPresential) {
    modalidades.push({ value: "presencial", label: "Presencial" });
  }

  if (sesion.isVirtual) {
    modalidades.push({ value: "virtual", label: "Virtual" });
  }

  return modalidades;
}

function construirMensajeModalidadesAgendamiento(professionalName) {
  return `Profesional seleccionado: ${professionalName}

Selecciona la modalidad de atención:

1. Presencial
2. Virtual

Responde con el número de la modalidad.
Ejemplo: 1`;
}

function construirMensajeModalidadUnicaAgendamiento(professionalName, modalidadLabel) {
  return `Profesional seleccionado: ${professionalName}

Modalidad disponible: ${modalidadLabel}`;
}

async function iniciarSeleccionFechaAgendamiento(to, sesion) {
  try {
    const fechas = await consultarFechasDisponiblesAgendamiento(sesion);

    guardarSesionAgendamiento(to, {
      ...sesionesAgendamiento.get(to),
      paso: "seleccionando_fecha",
      fechasDisponibles: fechas.fechasDisponibles,
      minAllowed: fechas.minAllowed,
      maxAllowed: fechas.maxAllowed,
      timestamp: Date.now()
    });

    if (!fechas.fechasDisponibles.length) {
      await enviarMensajeAgendamientoConNavegacion(
        to,
        "Por ahora no encontramos fechas disponibles para este profesional y servicio en el mes actual. Puedes volver atrás o regresar al menú principal."
      );
      return;
    }

    await enviarMensajeAgendamientoConNavegacionSeguro(
      to,
      construirMensajeFechasAgendamiento(fechas.fechasDisponibles),
      "seleccionando_fecha"
    );
  } catch (error) {
    console.warn("[AGENDAMIENTO] No se pudieron cargar fechas disponibles:", construirDetalleErrorLog(error, {
      action: "load_available_dates",
      flowKey: "agendamiento_fechas",
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId
    }));

    await enviarMensajeAgendamientoConNavegacion(
      to,
      "No pude cargar las fechas disponibles en este momento. Por favor intenta nuevamente más tarde o vuelve atrás."
    );
  }
}

async function consultarFechasDisponiblesAgendamiento(sesion) {
  if (!APPWEB_CHATBOT_API_KEY) {
    throw new Error("Falta APPWEB_CHATBOT_API_KEY para consultar fechas disponibles.");
  }

  const { mes, anio } = obtenerMesAnioActualAgendamiento();
  const url = construirAppWebApiUrl(`/api/chatbot/employees/${encodeURIComponent(sesion.professionalId)}/available-dates`);

  console.log("[AGENDAMIENTO_API] Consultando fechas disponibles:", {
    action: "available_dates_select",
    professionalId: sesion.professionalId,
    serviceId: sesion.serviceId,
    month: mes,
    year: anio
  });

  const response = await axios.get(url, {
    timeout: 10000,
    params: {
      service_id: sesion.serviceId,
      month: mes,
      year: anio
    },
    headers: {
      "X-Chatbot-Api-Key": APPWEB_CHATBOT_API_KEY
    }
  });

  return normalizarRespuestaFechasDisponibles(response.data);
}

function construirAppWebApiUrl(pathname) {
  const baseUrl = String(APPWEB_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const pathApi = String(pathname || "").trim().replace(/^\/+/, "");

  if (!baseUrl) {
    throw new Error("Falta APPWEB_API_BASE_URL para consultar la API de la app web.");
  }

  return `${baseUrl}/${pathApi}`;
}

function obtenerMesAnioActualAgendamiento(fecha = new Date()) {
  const { mes, anio } = obtenerFechaHoraEcuador(fecha);
  return {
    mes: Number.parseInt(mes, 10),
    anio: Number.parseInt(anio, 10)
  };
}

function normalizarRespuestaFechasDisponibles(data) {
  const posiblesListas = [
    data?.available_dates,
    data?.dates,
    data?.data?.available_dates,
    data?.data?.dates,
    data?.data,
    data
  ];
  const lista = posiblesListas.find((item) => Array.isArray(item)) || [];
  const fechasDisponibles = lista
    .map((item) => normalizarFechaDisponible(item))
    .filter(Boolean);
  const minAllowed = obtenerValorFechaPermitida(data, "minAllowed", "min_allowed") || fechasDisponibles[0]?.date || null;
  const maxAllowed = obtenerValorFechaPermitida(data, "maxAllowed", "max_allowed")
    || fechasDisponibles[fechasDisponibles.length - 1]?.date
    || null;

  return {
    fechasDisponibles,
    minAllowed,
    maxAllowed
  };
}

function normalizarFechaDisponible(item) {
  const date = typeof item === "string"
    ? item
    : item?.date || item?.fecha || item?.value || item?.day;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return null;
  }

  return {
    date,
    label: formatearFechaDisponibleAgendamiento(date),
    raw: item
  };
}

function obtenerValorFechaPermitida(data, camelKey, snakeKey) {
  return data?.[camelKey]
    || data?.[snakeKey]
    || data?.data?.[camelKey]
    || data?.data?.[snakeKey]
    || null;
}

function formatearFechaDisponibleAgendamiento(fechaISO) {
  const [anio, mes, dia] = String(fechaISO).split("-").map((parte) => Number.parseInt(parte, 10));
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12, 0, 0));
  const diaSemana = new Intl.DateTimeFormat("es-EC", {
    weekday: "long",
    timeZone: "UTC"
  }).format(fecha);
  const diaCapitalizado = diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1);
  const nombreMes = new Intl.DateTimeFormat("es-EC", {
    month: "long",
    timeZone: "UTC"
  }).format(fecha);

  return `${diaCapitalizado} ${String(dia).padStart(2, "0")} de ${nombreMes} de ${anio}`;
}

function construirMensajeFechasAgendamiento(fechasDisponibles) {
  const listadoFechas = fechasDisponibles
    .map((fecha, index) => `${index + 1}. ${fecha.label}`)
    .join("\n");

  return `Selecciona la fecha de tu cita:

${listadoFechas}

Responde con el número de la fecha.
Ejemplo: 1`;
}

async function consultarHorariosDisponiblesAgendamiento(sesion) {
  if (!APPWEB_CHATBOT_API_KEY) {
    throw new Error("Falta APPWEB_CHATBOT_API_KEY para consultar horarios disponibles.");
  }

  const url = construirAppWebApiUrl(
    `/api/chatbot/employees/${encodeURIComponent(sesion.professionalId)}/availability/${encodeURIComponent(sesion.appointmentDate)}`
  );

  console.log("[AGENDAMIENTO_API] Consultando horarios disponibles:", {
    action: "available_times_select",
    professionalId: sesion.professionalId,
    serviceId: sesion.serviceId,
    appointmentDate: sesion.appointmentDate,
    appointmentMode: sesion.appointmentMode
  });

  const response = await axios.get(url, {
    timeout: 10000,
    params: {
      service_id: sesion.serviceId,
      mode: sesion.appointmentMode,
      appointment_mode: sesion.appointmentMode,
      modality: sesion.appointmentMode
    },
    headers: {
      "X-Chatbot-Api-Key": APPWEB_CHATBOT_API_KEY
    }
  });

  const totalSlotsApi = contarSlotsApiHorarios(response.data);

  console.log("[AGENDAMIENTO] Horarios API recibidos:", {
    url,
    employeeId: sesion.professionalId,
    serviceId: sesion.serviceId,
    appointmentDate: sesion.appointmentDate,
    appointmentMode: sesion.appointmentMode,
    totalSlotsApi,
    payload: response.data
  });

  const horariosDisponibles = await filtrarHorariosConHoldsActivos(
    normalizarRespuestaHorariosDisponibles(response.data),
    sesion
  );

  console.log("[AGENDAMIENTO] Horarios normalizados:", {
    employeeId: sesion.professionalId,
    serviceId: sesion.serviceId,
    appointmentDate: sesion.appointmentDate,
    appointmentMode: sesion.appointmentMode,
    totalSlotsNormalizados: horariosDisponibles.length,
    horariosDisponibles
  });

  return horariosDisponibles;
}

function normalizarRespuestaHorariosDisponibles(data) {
  const posiblesListas = [
    data?.available_slots,
    data?.available_times,
    data?.times,
    data?.slots,
    data?.data?.available_slots,
    data?.data?.available_times,
    data?.data?.times,
    data?.data?.slots,
    data?.data,
    data
  ];
  const lista = posiblesListas.find((item) => Array.isArray(item)) || [];

  return lista
    .map((item) => normalizarHorarioDisponible(item))
    .filter(Boolean);
}

async function filtrarHorariosConHoldsActivos(horariosDisponibles, sesion) {
  if (!horariosDisponibles.length) {
    return [];
  }

  let holdsActivos = [];

  try {
    holdsActivos = await obtenerHoldsActivosAgendamiento({
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId,
      appointmentDate: sesion.appointmentDate
    });
  } catch (error) {
    console.warn("[AGENDAMIENTO_DB] No se pudieron consultar holds activos. Continuando con disponibilidad API:", construirDetalleErrorLog(error, {
      action: "appointment_holds_active_select",
      professionalId: sesion.professionalId,
      serviceId: sesion.serviceId,
      appointmentDate: sesion.appointmentDate
    }));
    return horariosDisponibles;
  }

  if (!holdsActivos.length) {
    return horariosDisponibles;
  }

  const slotsOcupados = new Set(
    holdsActivos.map((hold) => construirClaveSlotAgendamiento(hold.appointment_time, hold.appointment_end_time))
  );

  return horariosDisponibles.filter((horario) => (
    !slotsOcupados.has(construirClaveSlotAgendamiento(horario.start, horario.end))
  ));
}

function contarSlotsApiHorarios(data) {
  const posiblesListas = [
    data?.available_slots,
    data?.available_times,
    data?.times,
    data?.slots,
    data?.data?.available_slots,
    data?.data?.available_times,
    data?.data?.times,
    data?.data?.slots,
    data?.data,
    data
  ];
  const lista = posiblesListas.find((item) => Array.isArray(item));
  return Array.isArray(lista) ? lista.length : 0;
}

function normalizarHorarioDisponible(item) {
  const start = typeof item === "string"
    ? item
    : item?.start || item?.start_time || item?.time || item?.from || item?.hora_inicio || item?.slot_start;
  const end = typeof item === "string"
    ? null
    : item?.end || item?.end_time || item?.to || item?.hora_fin || item?.slot_end;

  if (!start) {
    return null;
  }

  const startEc = normalizarHoraEcuadorAgendamiento(start);
  const endEc = end ? normalizarHoraEcuadorAgendamiento(end) : null;

  if (!startEc) {
    return null;
  }

  return {
    start: startEc,
    end: endEc,
    label: construirEtiquetaHorarioAgendamiento(startEc, endEc, item?.label),
    raw: item
  };
}

function construirClaveSlotAgendamiento(start, end) {
  return `${normalizarHoraEcuadorAgendamiento(start) || ""}|${normalizarHoraEcuadorAgendamiento(end) || ""}`;
}

function normalizarHoraEcuadorAgendamiento(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return obtenerHoraEcuadorDesdeFecha(value);
  }

  const texto = String(value).trim();
  const match = texto.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);

  if (!match) {
    return null;
  }

  const hora = Number.parseInt(match[1], 10);

  if (!Number.isInteger(hora) || hora < 0 || hora > 23) {
    return null;
  }

  return `${String(hora).padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
}

function formatearHoraHoldAgendamiento(value) {
  const hora = normalizarHoraEcuadorAgendamiento(value);
  return hora ? hora.slice(0, 5) : null;
}

function obtenerHoraEcuadorDesdeFecha(fecha) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(fecha);
  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
  return `${valor("hour")}:${valor("minute")}:${valor("second")}`;
}

function construirEtiquetaHorarioAgendamiento(start, end, label) {
  if (label) {
    return String(label).trim();
  }

  const inicio = formatearHoraAgendamiento(start);
  const fin = end ? formatearHoraAgendamiento(end) : "";

  return fin ? `${inicio} - ${fin}` : inicio;
}

function formatearHoraAgendamiento(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);

  if (!match) {
    return String(value || "").trim();
  }

  const hora24 = Number.parseInt(match[1], 10);
  const minuto = match[2];
  const periodo = hora24 >= 12 ? "PM" : "AM";
  const hora12 = hora24 % 12 || 12;

  return `${String(hora12).padStart(2, "0")}:${minuto} ${periodo}`;
}

function construirMensajeHorariosAgendamiento(sesion, horariosDisponibles) {
  const listadoHorarios = horariosDisponibles
    .map((horario, index) => `${index + 1}. ${construirEtiquetaHorarioVisibleAgendamiento(horario, sesion)}`)
    .join("\n");
  const notaZonaHoraria = construirNotaZonaHorariaAgendamiento(sesion);

  return `Fecha seleccionada: ${sesion.appointmentDateLabel}

${notaZonaHoraria}

Selecciona el horario de tu cita:

${listadoHorarios}

Responde con el número del horario.
Ejemplo: 1`;
}

function construirNotaZonaHorariaAgendamiento(sesion) {
  if (sesion.appointmentMode === "virtual") {
    const zonaHorariaUsuario = obtenerZonaHorariaUsuarioAgendamiento(sesion);

    if (zonaHorariaUsuario) {
      return `Turnos virtuales mostrados en tu zona horaria: ${zonaHorariaUsuario}. Internamente se reservan en hora de Ecuador.`;
    }

    return "Aún no tenemos tu zona horaria. Todos los turnos se muestran en hora de Ecuador.";
  }

  return "Todos los turnos se muestran en hora de Ecuador.";
}

function obtenerZonaHorariaUsuarioAgendamiento(sesion) {
  return sesion.userTimeZone || sesion.timeZone || sesion.timezone || null;
}

function construirEtiquetaHorarioVisibleAgendamiento(horario, sesion) {
  const zonaHorariaUsuario = sesion.appointmentMode === "virtual"
    ? obtenerZonaHorariaUsuarioAgendamiento(sesion)
    : null;

  if (!zonaHorariaUsuario) {
    return horario.label;
  }

  const inicio = convertirHoraEcuadorAZonaUsuario(sesion.appointmentDate, horario.start, zonaHorariaUsuario);
  const fin = horario.end
    ? convertirHoraEcuadorAZonaUsuario(sesion.appointmentDate, horario.end, zonaHorariaUsuario)
    : "";

  if (!inicio) {
    return horario.label;
  }

  return fin ? `${inicio} - ${fin}` : inicio;
}

function convertirHoraEcuadorAZonaUsuario(fechaISO, horaEcuador, timeZone) {
  try {
    const horaNormalizada = normalizarHoraEcuadorAgendamiento(horaEcuador);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaISO || "")) || !horaNormalizada) {
      return null;
    }

    const fecha = new Date(`${fechaISO}T${horaNormalizada}-05:00`);

    return new Intl.DateTimeFormat("es-EC", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h12"
    }).format(fecha);
  } catch (error) {
    console.warn("[AGENDAMIENTO] No se pudo convertir zona horaria:", {
      timeZone,
      error: error.message
    });
    return null;
  }
}

function dividirMensajePorLineas(message, maxLength = 1200) {
  const lineas = String(message || "").split("\n");
  const partes = [];
  let parteActual = "";

  for (const linea of lineas) {
    const candidato = parteActual ? `${parteActual}\n${linea}` : linea;

    if (candidato.length <= maxLength) {
      parteActual = candidato;
      continue;
    }

    if (parteActual) {
      partes.push(parteActual);
    }

    parteActual = linea;
  }

  if (parteActual) {
    partes.push(parteActual);
  }

  return partes.length ? partes : [""];
}

async function enviarMensajeAgendamientoConNavegacion(to, message) {
  await enviarBotones(to, message, [botonVolverAgendamiento(), botonMenuPrincipal()]);
}

async function enviarMensajeAgendamientoConNavegacionSeguro(to, message, step = "agendamiento") {
  const messageLength = String(message || "").length;
  const buttons = [botonVolverAgendamiento(), botonMenuPrincipal()];
  let partes = [message];

  try {
    if (messageLength <= 900) {
      await enviarBotones(to, message, buttons);
      return;
    }

    partes = dividirMensajePorLineas(message);

    for (const parte of partes) {
      await enviarMensajeTexto(to, parte);
    }

    await enviarBotones(
      to,
      "Responde con el número de la opción que deseas seleccionar o usa los botones de navegación.",
      buttons
    );
  } catch (error) {
    console.error("[AGENDAMIENTO] Error enviando mensaje con navegación:", construirDetalleErrorLog(error, {
      action: "send_appointment_navigation_message",
      messageLength,
      parts: partes.length,
      step
    }));
    throw error;
  }
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

  return `$${numero.toFixed(2)}`;
}

function obtenerPrecioNumerico(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  const numero = Number(valor);

  return Number.isFinite(numero) ? numero : null;
}

function calcularPrecioEstandarTarjeta(valor) {
  const numero = obtenerPrecioNumerico(valor);

  if (numero === null) {
    return null;
  }

  return Math.round((numero / 0.9425) * 100) / 100;
}

function construirBloquesPrecioServicio(servicio, numeroUsuario) {
  const precio = obtenerPrecioNumerico(servicio.price);
  const precioPromocional = obtenerPrecioNumerico(servicio.sale_price);

  if (precio === null && precioPromocional === null) {
    return "💲 Precio: Disponible con asesor";
  }

  const precioEstandarTarjeta = calcularPrecioEstandarTarjeta(servicio.price);
  const bloques = [
    "💰 ¡Ahorra según tu método de pago!",
    `💳 Precio estándar: ${formatearPrecio(precioEstandarTarjeta)} (Pagando en línea con tarjeta)`,
    `💵 Precio con descuento: ${formatearPrecio(servicio.price)} (Efectivo o transferencia)`
  ];

  if (tienePromocion(servicio)) {
    bloques.push(
      `🏷️ Precio promo especial: Desde ${formatearPrecio(servicio.sale_price)}*`,
      `⚠️ La tarifa de ${formatearPrecio(servicio.sale_price)} es válida únicamente al agendar en línea y pagar vía transferencia. Los pagos con tarjeta en línea para esta promoción pueden tener variaciones.`
    );
  }

  return bloques
    .filter((bloque) => puedeUsarAgendamiento(numeroUsuario) || !String(bloque).includes("agendar en"))
    .join("\n\n");
}

function tienePromocion(servicio) {
  const precioPromocional = obtenerPrecioNumerico(servicio.sale_price);

  if (precioPromocional === null) {
    return false;
  }

  const precio = obtenerPrecioNumerico(servicio.price);

  return precio === null || precioPromocional !== precio;
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

function construirMensajeDetalleServicio(servicio, numeroUsuario) {
  const bloques = [
    `📌 Servicio: ${servicio.title}`,
    construirBloquesPrecioServicio(servicio, numeroUsuario)
  ];

  bloques.push(construirTextoModalidad(servicio));

  if (servicio.excerpt) {
    bloques.push(`📝 ${servicio.excerpt}`);
  }

  bloques.push(`📲 ¿Necesitas ayuda personalizada?

Si deseas más información sobre este servicio, métodos de pago o disponibilidad, nuestro equipo estará encantado de ayudarte 😊

WhatsApp:
wa.me/593939034743`);

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
  await enviarDetalleServicioConOpciones(from, construirMensajeDetalleServicio(servicioSeleccionado, from));
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
  const menu = obtenerMenuDisponible(menuKey, to);

  if (!menu) {
    console.warn("[MENU] Menu no encontrado:", menuKey);
    await enviarMenu(to, "principal");
    return;
  }

  console.log("[MENU] Enviando:", {
    menuKey,
    buttons: menu.buttons.map((button) => ({
      id: button.reply?.id,
      title: button.reply?.title
    }))
  });
  await enviarBotones(to, menu.text, menu.buttons);
  registrarEvento(to, "menu_opened", { menuKey });
}

function obtenerMenuDisponible(menuKey, numeroUsuario) {
  const menu = MENUS[menuKey];

  if (!menu) {
    return null;
  }

  return menu;
}

async function enviarBotones(to, bodyText, buttons) {
  console.log("[WHATSAPP_BUTTONS] Botones finales:", {
    to,
    buttons: buttons.map((button) => ({
      id: button.reply?.id,
      title: button.reply?.title
    }))
  });

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
  console.log("[WHATSAPP_MEDIA] Antes await axios.post /media:", {
    relativePath,
    mimeType,
    timeoutMs: WHATSAPP_REQUEST_TIMEOUT_MS
  });
  const response = await axios.post(url, formData, {
    timeout: WHATSAPP_REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });
  console.log("[WHATSAPP_MEDIA] Despues await axios.post /media:", {
    relativePath,
    status: response.status,
    mediaId: response.data?.id
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
  await enviarUbicacionFamysalud(
    to,
    `📍 ¡Será un gusto recibirte en FamySALUD!

Nos encontramos ubicados en:

Quisquis 1109 y José Mascote
Guayaquil, Ecuador

Aquí te compartimos nuestra ubicación para que puedas llegar fácilmente 💙`
  );
}

async function enviarUbicacionEmpresa(to) {
  await enviarUbicacionFamysalud(
    to,
    `📍 Claro, con gusto te compartimos nuestra ubicación.

Si tu empresa o institución desea visitarnos, coordinar servicios o conocer más sobre FamySALUD, puedes encontrarnos aquí:

Quisquis 1109 y José Mascote
Guayaquil, Ecuador`
  );
}

async function enviarUbicacionProveedor(to) {
  await enviarUbicacionFamysalud(
    to,
    `📍 Claro, con gusto te compartimos nuestra ubicación.

Si deseas visitarnos para presentar productos, coordinar una propuesta o conocer más sobre FamySALUD, puedes encontrarnos aquí:

Quisquis 1109 y José Mascote
Guayaquil, Ecuador`
  );
}

async function enviarUbicacionAlianza(to) {
  await enviarUbicacionFamysalud(
    to,
    `📍 Estamos ubicados en Guayaquil.

Si estás interesado en crear una alianza estratégica con FamySALUD, puedes tomar como referencia nuestra ubicación para coordinar cualquier acercamiento o propuesta.

Quisquis 1109 y José Mascote
Guayaquil, Ecuador`
  );
}

async function enviarUbicacionFamysalud(to, mensajeInicial) {
  await enviarMensajeTexto(to, mensajeInicial);
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

  console.log("[WHATSAPP_TEXT] Antes await enviarWhatsApp:", {
    to,
    length: String(message || "").length
  });

  try {
    await enviarWhatsApp(payload);
    console.log("[WHATSAPP_TEXT] Despues await enviarWhatsApp:", {
      to,
      length: String(message || "").length
    });
  } catch (error) {
    console.error("[WHATSAPP_TEXT] Error enviando texto:", {
      to,
      error: error.response?.data || error.message
    });
  }
}

function esMensajeMultimedia(message) {
  return ["image", "video", "audio", "document", "sticker"].includes(message?.type);
}

async function reenviarMensajeMultimediaSeguro(destino, message, remitente) {
  try {
    console.log("[MEDIA] Antes await reenviarMensajeMultimedia:", {
      destino,
      tipo: message?.type
    });
    const reenviado = await reenviarMensajeMultimedia(destino, message);
    console.log("[MEDIA] Despues await reenviarMensajeMultimedia:", {
      destino,
      tipo: message?.type,
      reenviado
    });
    return reenviado;
  } catch (error) {
    console.warn("[MEDIA] Error reenviando multimedia:", {
      tipo: message?.type,
      destino,
      error: error.response?.data || error.message
    });

    if (message?.type === "video" && remitente) {
      try {
        console.log("[MEDIA] Antes await enviarMensajeTexto aviso fallo video:", {
          remitente,
          destino
        });
        await enviarMensajeTexto(
          remitente,
          "No pudimos reenviar ese video. Por favor intenta enviarlo nuevamente o compártelo como documento."
        );
        console.log("[MEDIA] Despues await enviarMensajeTexto aviso fallo video:", {
          remitente,
          destino
        });
      } catch (notifyError) {
        console.warn("[MEDIA] No se pudo notificar fallo de video:", {
          remitente,
          error: notifyError.response?.data || notifyError.message
        });
      }
    }

    return false;
  }
}

async function reenviarMensajeMultimedia(destino, message) {
  const tipo = message?.type;

  if (!esMensajeMultimedia(message)) {
    return false;
  }

  if (tipo === "video") {
    return reenviarVideoWhatsApp(destino, message);
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

async function reenviarVideoWhatsApp(destino, message) {
  const media = message?.video;
  const mediaId = media?.id;
  const caption = media?.caption;
  let tempPath = null;

  if (!mediaId) {
    console.log("[MEDIA_VIDEO] Mensaje de video sin media id.");
    return false;
  }

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID para reenviar video.");
  }

  if (typeof FormData === "undefined" || typeof Blob === "undefined") {
    throw new Error("FormData o Blob no estan disponibles. Se requiere soporte nativo de FormData o instalar form-data.");
  }

  try {
    const mediaUrl = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`;
    console.log("[MEDIA_VIDEO] Antes await axios.get metadata:", {
      mediaId,
      timeoutMs: WHATSAPP_REQUEST_TIMEOUT_MS
    });
    const metadata = await axios.get(mediaUrl, {
      timeout: WHATSAPP_REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      }
    });
    console.log("[MEDIA_VIDEO] Despues await axios.get metadata:", {
      mediaId,
      status: metadata.status
    });
    const downloadUrl = metadata.data?.url;

    if (!downloadUrl) {
      throw new Error("No se recibió URL temporal para descargar el video.");
    }

    console.log("[MEDIA_VIDEO] Antes await axios.get descarga:", {
      mediaId,
      timeoutMs: WHATSAPP_REQUEST_TIMEOUT_MS
    });
    const response = await axios.get(downloadUrl, {
      timeout: WHATSAPP_REQUEST_TIMEOUT_MS,
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      }
    });
    console.log("[MEDIA_VIDEO] Despues await axios.get descarga:", {
      mediaId,
      status: response.status,
      bytes: response.data?.byteLength
    });
    const mimeType = media.mime_type || response.headers["content-type"] || "video/mp4";
    const tmpDir = path.join(__dirname, "tmp", "asesor-videos");
    await fs.promises.mkdir(tmpDir, { recursive: true });

    const filename = sanitizarNombreArchivoProveedor(`${Date.now()}-${mediaId}.${extensionPorMimeType(mimeType)}`);
    tempPath = path.join(tmpDir, filename);
    await fs.promises.writeFile(tempPath, Buffer.from(response.data));

    const fileBuffer = await fs.promises.readFile(tempPath);
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("type", mimeType);
    formData.append("file", new Blob([fileBuffer], { type: mimeType }), filename);

    const uploadUrl = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/media`;
    console.log("[MEDIA_VIDEO] Antes await axios.post upload:", {
      mediaId,
      mimeType,
      timeoutMs: WHATSAPP_REQUEST_TIMEOUT_MS
    });
    const upload = await axios.post(uploadUrl, formData, {
      timeout: WHATSAPP_REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      }
    });
    console.log("[MEDIA_VIDEO] Despues await axios.post upload:", {
      mediaId,
      status: upload.status,
      nuevoMediaId: upload.data?.id
    });
    const nuevoMediaId = upload.data?.id;

    if (!nuevoMediaId) {
      throw new Error("WhatsApp no devolvió media id al subir el video.");
    }

    const payload = {
      messaging_product: "whatsapp",
      to: destino,
      type: "video",
      video: {
        id: nuevoMediaId
      }
    };

    if (caption) {
      payload.video.caption = caption;
    }

    console.log("[MEDIA_VIDEO] Reenviando video con nuevo media id:", {
      destino,
      originalMediaId: mediaId,
      nuevoMediaId
    });

    await enviarWhatsApp(payload);
    return true;
  } catch (error) {
    console.warn("[MEDIA_VIDEO] Error reenviando video:", {
      destino,
      mediaId,
      error: error.response?.data || error.message
    });
    throw error;
  } finally {
    if (tempPath) {
      fs.promises.unlink(tempPath).catch((error) => {
        if (error.code !== "ENOENT") {
          console.warn("[MEDIA_VIDEO] No se pudo eliminar video temporal:", error.message);
        }
      });
    }
  }
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

  try {
    console.log("[WHATSAPP] Antes await axios.post /messages:", {
      to: payload.to,
      type: payload.type,
      timeoutMs: WHATSAPP_REQUEST_TIMEOUT_MS
    });
    const response = await axios.post(url, payload, {
      timeout: WHATSAPP_REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
    console.log("[WHATSAPP] Despues await axios.post /messages:", {
      to: payload.to,
      type: payload.type,
      status: response.status
    });
  } catch (error) {
    console.error("[WHATSAPP] Error en axios.post /messages:", {
      to: payload.to,
      type: payload.type,
      code: error.code,
      error: error.response?.data || error.message
    });
    throw error;
  }
}

function fechaPersistidaAMs(value, fallback = Date.now()) {
  if (!value) {
    return fallback;
  }

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function construirSesionAsesorDesdePersistencia(row) {
  const asesor = ASESORES_WHATSAPP.find((item) => item.id === row.asesor_id);

  if (!asesor || !row.paciente_phone) {
    return null;
  }

  const asignadoEn = fechaPersistidaAMs(row.asignado_en || row.creado_en);

  return {
    asesorId: asesor.id,
    paciente: row.paciente_phone,
    asesor: row.asesor_phone || asesor.phone,
    nombreAsesor: row.nombre_asesor || null,
    cargoAsesor: row.cargo_asesor || null,
    nombreTemporalAsesor: row.nombre_temporal_asesor || null,
    origen: row.origen || "paciente",
    estado: row.estado,
    asignadoEn,
    conectadoEn: row.conectado_en ? fechaPersistidaAMs(row.conectado_en) : null,
    waitMs: 0
  };
}

function construirSesionAgendamientoDesdePersistencia(row) {
  if (!row?.phone || !row.payload_json) {
    return null;
  }

  try {
    const payload = typeof row.payload_json === "string"
      ? JSON.parse(row.payload_json)
      : row.payload_json;

    if (!payload?.paso) {
      return null;
    }

    const timestamp = Number.isFinite(Number(payload.timestamp))
      ? Number(payload.timestamp)
      : fechaPersistidaAMs(row.updated_at);

    if (Date.now() - timestamp > SESION_USUARIO_TTL_MS) {
      return null;
    }

    return {
      phone: row.phone,
      sessionId: row.session_id || null,
      sesion: {
        ...payload,
        timestamp
      }
    };
  } catch (error) {
    console.warn("[AGENDAMIENTO_DB] Payload persistido invalido:", construirDetalleErrorLog(error, {
      action: "appointment_session_parse",
      phone: row.phone
    }));
    return null;
  }
}

async function restaurarEstadoAsesoresDesdeBD() {
  const startedAt = Date.now();

  try {
    const estado = await obtenerEstadoAsesoresPersistido();

    colaEsperaAsesor.length = 0;
    for (const item of estado.cola || []) {
      if (!item.paciente_phone || pacienteEstaEnColaAsesor(item.paciente_phone)) {
        continue;
      }

      colaEsperaAsesor.push({
        paciente: item.paciente_phone,
        origen: item.origen || "paciente",
        creadoEn: fechaPersistidaAMs(item.creado_en)
      });
    }

    for (const row of estado.sesiones || []) {
      const sesion = construirSesionAsesorDesdePersistencia(row);

      if (!sesion) {
        continue;
      }

      sesionesAsesores.set(sesion.asesorId, sesion);
      cancelarExpiracionSesion(sesion.paciente);
    }

    for (const sesion of sesionesAsesores.values()) {
      if (sesion.estado === "conectado") {
        reiniciarTemporizadorSesionAsesor(sesion.asesorId);
      } else if (esSesionEsperandoAceptacionAsesor(sesion)) {
        reiniciarTemporizadorAceptacionAsesor(sesion.asesorId);
      }
    }

    console.log("[ASESOR_DB] Estado restaurado:", {
      enCola: colaEsperaAsesor.length,
      sesionesActivas: Array.from(sesionesAsesores.values()).filter((sesion) => sesion.estado !== "libre").length
    });
  } catch (error) {
    console.warn("[ASESOR_DB] No se pudo restaurar estado. Iniciando solo en memoria:", construirDetalleErrorLog(error, {
      action: "restore_active",
      elapsedMs: Date.now() - startedAt
    }));
  }
}

async function restaurarSesionesAgendamientoDesdeBD() {
  const startedAt = Date.now();

  try {
    const rows = await obtenerSesionesAgendamientoPersistidas();
    let restauradas = 0;

    for (const row of rows || []) {
      const restaurada = construirSesionAgendamientoDesdePersistencia(row);

      if (!restaurada) {
        continue;
      }

      sesionesAgendamiento.set(restaurada.phone, restaurada.sesion);
      sesionesUsuarios.set(restaurada.phone, {
        timestamp: restaurada.sesion.timestamp,
        sessionId: restaurada.sessionId || generarSessionId()
      });
      sesionesExpiradas.delete(restaurada.phone);

      const tiempoRestante = Math.max(1, SESION_USUARIO_TTL_MS - (Date.now() - restaurada.sesion.timestamp));
      programarExpiracionSesion(restaurada.phone, tiempoRestante);
      restauradas += 1;
    }

    console.log("[AGENDAMIENTO_DB] Sesiones restauradas:", {
      total: restauradas,
      elapsedMs: Date.now() - startedAt
    });
  } catch (error) {
    console.warn("[AGENDAMIENTO_DB] No se pudo restaurar sesiones. Iniciando solo en memoria:", construirDetalleErrorLog(error, {
      action: "appointment_session_restore_active",
      elapsedMs: Date.now() - startedAt
    }));
  }
}

async function revisarRecordatoriosFeriados(fecha = new Date()) {
  const { hora, minuto } = obtenerFechaHoraEcuador(fecha);

  if (hora !== 20 || minuto !== 0) {
    return;
  }

  const fechaHoy = obtenerFechaISOEcuador(fecha);
  const revisionKey = `${fechaHoy}-${hora}:${minuto}`;

  if (ultimaRevisionRecordatorioFeriados === revisionKey || feriadosRevisionEnCurso) {
    return;
  }

  ultimaRevisionRecordatorioFeriados = revisionKey;
  feriadosRevisionEnCurso = true;

  try {
    const fechaFeriado = sumarDiasFechaISO(fechaHoy, 2);
    const feriados = await obtenerFeriadosPendientesRecordatorio(fechaFeriado);

    if (!feriados.length) {
      console.log("[FERIADOS] Sin recordatorios pendientes", { fechaFeriado });
      return;
    }

    for (const feriado of feriados) {
      await enviarMensajeTexto(ASESOR_WHATSAPP_PRINCIPAL, construirMensajeRecordatorioFeriado(feriado));
      await marcarRecordatorioFeriadoEnviado(feriado.feriado_id);
      console.log("[FERIADOS] Recordatorio enviado", {
        feriadoId: feriado.feriado_id,
        fecha: obtenerFechaISODesdeValorBD(feriado.fecha),
        nombre: feriado.nombre
      });
    }
  } catch (error) {
    console.warn("[FERIADOS] Error consultando BD:", error.message);
  } finally {
    feriadosRevisionEnCurso = false;
  }
}

function programarRevisionFeriados() {
  if (feriadosRevisionInterval) {
    clearInterval(feriadosRevisionInterval);
  }

  feriadosRevisionInterval = setInterval(() => {
    revisarRecordatoriosFeriados().catch((error) => {
      console.warn("[FERIADOS] Error consultando BD:", error.message);
    });
  }, INTERVALO_REVISION_FERIADOS_MS);

  revisarRecordatoriosFeriados().catch((error) => {
    console.warn("[FERIADOS] Error consultando BD:", error.message);
  });
}

Promise.all([
  restaurarEstadoAsesoresDesdeBD(),
  restaurarSesionesAgendamientoDesdeBD()
]).finally(() => {
  app.listen(PORT, () => {
    console.log(`[SERVIDOR] Escuchando en el puerto ${PORT}`);
    console.log(`[CONFIG] Entorno: ${APP_ENV}`);
    console.log(`[CONFIG] Agendamiento habilitado: ${featureHabilitada(ENABLE_APPOINTMENT_BOOKING)}`);
    console.log(`[CONFIG] IA habilitada: ${featureHabilitada(ENABLE_AI_RESPONSES)}`);
    inicializarCatalogoServicios();
    programarRevisionFeriados();
  });
});
