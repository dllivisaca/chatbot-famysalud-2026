require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const CHATBOT_CATALOG_URL = process.env.CHATBOT_CATALOG_URL;
const WHATSAPP_API_VERSION = "v20.0";
const sesionesCotizacion = new Map();

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
      boton("main_atenderme", "Quiero atenderme"),
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
      boton("paciente_asesor", "Hablar con asesor")
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
  main_atenderme: { type: "menu", menu: "pacientes" },
  main_empresas: { type: "menu", menu: "empresas" },
  main_mas_opciones: { type: "menu", menu: "principalMasOpciones" },
  main_proveedor: { type: "menu", menu: "proveedores" },
  main_alianza: { type: "menu", menu: "alianzas" },
  main_trabaja: { type: "text", text: TEXTOS.trabaja },

  paciente_agendar_cita: { type: "text", text: `¡Perfecto! 💙

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
  paciente_resultados: { type: "text", text: "Para solicitar resultados, por favor comparte tus datos con un asesor." },
  paciente_promociones: { type: "text", text: "Pronto te compartiremos nuestras promociones disponibles." },
  paciente_mas_opciones_2: { type: "menu", menu: "pacientesMasOpciones2" },
  paciente_ubicacion: { type: "text", text: "Te compartiremos nuestra ubicación para que puedas visitarnos." },
  paciente_horarios: { type: "text", text: "Nuestros horarios serán confirmados por un asesor." },
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
    const from = message.from;
    const text = extraerTexto(message);
    const buttonId = extraerButtonReplyId(message);

    console.log("[MENSAJE] Recibido:", {
      from,
      type: message.type,
      text,
      buttonId
    });

    if (buttonId) {
      await manejarBoton(from, buttonId);
      return res.sendStatus(200);
    }

    if (debeMostrarMenu(text)) {
      await enviarMenu(from, "principal");
      return res.sendStatus(200);
    }

    await enviarMenu(from, "principal");
    return res.sendStatus(200);
  } catch (error) {
    console.error("[ERROR] Procesando mensaje:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

async function manejarBoton(to, buttonId) {
  const accion = ACCIONES_BOTONES[buttonId];

  if (!accion) {
    console.warn("[BOTON] ID no reconocido:", buttonId);
    await enviarMenu(to, "principal");
    return;
  }

  console.log("[BOTON] Accion resuelta:", accion);

  if (accion.type === "menu") {
    await enviarMenu(to, accion.menu);
    return;
  }

  if (accion.type === "catalog_areas") {
    await enviarAreasCotizacion(to);
    return;
  }

  await enviarMensajeTexto(to, accion.text);
}

function debeMostrarMenu(text) {
  if (!text) {
    return true;
  }

  return ["hola", "menu", "menú"].includes(text);
}

function extraerMensaje(body) {
  return body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
}

function extraerTexto(message) {
  return message.text?.body?.trim().toLowerCase() || "";
}

function extraerButtonReplyId(message) {
  return message.interactive?.button_reply?.id || "";
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

async function consultarCatalogoServicios() {
  if (!CHATBOT_CATALOG_URL) {
    throw new Error("CHATBOT_CATALOG_URL no esta configurada.");
  }

  console.log("[CATALOGO] Consultando endpoint del catalogo.");

  const response = await axios.get(CHATBOT_CATALOG_URL, {
    timeout: 10000
  });

  console.log("[CATALOGO] Catalogo recibido:", {
    status: response.status,
    areas: Array.isArray(response.data?.areas) ? response.data.areas.length : 0,
    updated_at: response.data?.updated_at
  });

  return response.data;
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
      title
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
});
