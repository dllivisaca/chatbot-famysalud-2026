require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const MENU_INICIAL = `Hola 👋 Soy el asistente virtual de FamySALUD.
Por favor elige una opción:
1. Soy paciente
2. Soy proveedor
3. Soy empresa
4. Soy aliado estratégico`;

// Verificacion del webhook requerida por Meta WhatsApp Cloud API.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Recibe mensajes entrantes desde WhatsApp Cloud API.
app.post("/webhook", async (req, res) => {
  const body = req.body;

  try {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from;
    const text = message?.text?.body?.trim().toLowerCase();

    if (from && debeMostrarMenu(text)) {
      await responderMensaje(from, MENU_INICIAL);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error procesando el mensaje:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// En esta base inicial cualquier mensaje de texto muestra el menu principal.
function debeMostrarMenu(text) {
  if (!text) {
    return true;
  }

  return true;
}

// Envia un mensaje de texto usando WhatsApp Cloud API.
async function responderMensaje(to, message) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en las variables de entorno.");
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body: message
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
