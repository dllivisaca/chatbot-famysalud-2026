#!/usr/bin/env node

const http = require("http");
const https = require("https");
const dns = require("dns").promises;

const TIMEOUT_MS = Number.parseInt(process.env.DIAG_TIMEOUT_MS || "35000", 10);
const HOST_HEADER = process.env.DIAG_HOST_HEADER || "ia.famysaludec.com";
const CHAT_PAYLOAD = JSON.stringify({ texto: "hola" });
const DEFAULT_TARGETS = [
  { method: "GET", url: "https://ia.famysaludec.com/" },
  { method: "POST", url: "https://ia.famysaludec.com/chat", body: CHAT_PAYLOAD },
  { method: "GET", url: "http://localhost" },
  { method: "GET", url: "http://127.0.0.1" },
  { method: "GET", url: "http://localhost/", hostHeader: HOST_HEADER },
  { method: "POST", url: "http://localhost/chat", body: CHAT_PAYLOAD, hostHeader: HOST_HEADER },
  { method: "GET", url: "http://127.0.0.1/", hostHeader: HOST_HEADER },
  { method: "POST", url: "http://127.0.0.1/chat", body: CHAT_PAYLOAD, hostHeader: HOST_HEADER }
];

function parseExtraTargets() {
  return String(process.env.DIAG_EXTRA_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({
      method: url.endsWith("/chat") ? "POST" : "GET",
      url,
      body: url.endsWith("/chat") ? CHAT_PAYLOAD : null
    }));
}

function redactEnv(value) {
  if (!value) return null;
  return String(value).replace(/(token|key|secret|password|pass)=([^&\s]+)/gi, "$1=[redacted]");
}

async function resolveHost(hostname) {
  try {
    const [lookup, v4, v6] = await Promise.allSettled([
      dns.lookup(hostname, { all: true }),
      dns.resolve4(hostname),
      dns.resolve6(hostname)
    ]);

    return {
      lookup: lookup.status === "fulfilled" ? lookup.value : lookup.reason.message,
      resolve4: v4.status === "fulfilled" ? v4.value : v4.reason.message,
      resolve6: v6.status === "fulfilled" ? v6.value : v6.reason.message
    };
  } catch (error) {
    return { error: error.message };
  }
}

function requestTarget(target) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const parsed = new URL(target.url);
    const client = parsed.protocol === "https:" ? https : http;
    const body = target.body || null;

    const req = client.request(
      {
        method: target.method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        timeout: TIMEOUT_MS,
        headers: body
          ? {
              ...(target.hostHeader ? { Host: target.hostHeader } : {}),
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body)
            }
          : target.hostHeader
          ? { Host: target.hostHeader }
          : undefined
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            target,
            ok: res.statusCode >= 200 && res.statusCode < 400,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            headers: {
              server: res.headers.server || null,
              location: res.headers.location || null,
              contentType: res.headers["content-type"] || null
            },
            bodyPreview: text.slice(0, 500)
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`timeout of ${TIMEOUT_MS}ms exceeded`));
    });

    req.on("error", (error) => {
      resolve({
        target,
        ok: false,
        error: {
          code: error.code || null,
          message: error.message
        },
        durationMs: Date.now() - startedAt
      });
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

async function main() {
  const targets = [...DEFAULT_TARGETS, ...parseExtraTargets()];
  const hostnames = [...new Set(targets.map((target) => new URL(target.url).hostname))];

  console.log(JSON.stringify({
    diagnostic: "famybot_ia_connectivity_node",
    timeoutMs: TIMEOUT_MS,
    env: {
      PORT: redactEnv(process.env.PORT),
      PASSENGER_BASE_URI: redactEnv(process.env.PASSENGER_BASE_URI),
      PASSENGER_APP_ENV: redactEnv(process.env.PASSENGER_APP_ENV),
      FAMYBOT_IA_API_URL: redactEnv(process.env.FAMYBOT_IA_API_URL),
      DIAG_EXTRA_URLS: redactEnv(process.env.DIAG_EXTRA_URLS),
      DIAG_HOST_HEADER: redactEnv(HOST_HEADER)
    }
  }, null, 2));

  for (const hostname of hostnames) {
    console.log(JSON.stringify({
      type: "dns",
      hostname,
      result: await resolveHost(hostname)
    }, null, 2));
  }

  for (const target of targets) {
    console.log(JSON.stringify(await requestTarget(target), null, 2));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
});
