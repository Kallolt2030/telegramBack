
const crypto = require('crypto');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const SETUP_SECRET = process.env.WEBHOOK_SETUP_SECRET;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// Almacenamiento temporal.
// IMPORTANTE: Vercel no garantiza que este Map sobreviva entre peticiones.
const codigosVinculacion = new Map();

async function telegram(metodo, datos = {}) {
  if (!TOKEN) {
    throw new Error('Falta TELEGRAM_BOT_TOKEN.');
  }

  const respuesta = await fetch(
    `https://api.telegram.org/bot${TOKEN}/${metodo}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(datos)
    }
  );

  const resultado = await respuesta.json();

  if (!respuesta.ok || !resultado.ok) {
    throw new Error(resultado.description || 'Error en Telegram');
  }

  return resultado.result;
}

async function enviarMensaje(chatId, texto) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text: texto
  });
}

function codigoValido(codigo) {
  const vinculacion = codigosVinculacion.get(codigo);

  if (!vinculacion) {
    return null;
  }

  // El código expira después de 10 minutos.
  if (Date.now() - vinculacion.creado > 10 * 60 * 1000) {
    codigosVinculacion.delete(codigo);
    return null;
  }

  return vinculacion;
}

async function procesarMensaje(mensaje) {
  if (!mensaje?.text || !mensaje.chat?.id) {
    return;
  }

  const texto = mensaje.text.trim();
  const chatId = String(mensaje.chat.id);

  console.log('Mensaje recibido:', {
    chatId,
    texto
  });

  // Reconocer /start y /start CODIGO.
  const coincidencia = texto.match(
    /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9]+))?$/
  );

  if (!coincidencia) {
    return;
  }

  const codigo = coincidencia[1]?.toUpperCase();

  // Inicio normal del bot.
  if (!codigo) {
    await enviarMensaje(
      chatId,
      '¡Bienvenido a MyConsult MD! 🩺\n\n' +
      'Para vincular tu cuenta, solicita un enlace de vinculación ' +
      'desde tu consultorio y abre ese enlace en Telegram.'
    );

    return;
  }

  // Inicio del bot con código de vinculación.
  const vinculacion = codigoValido(codigo);

  if (!vinculacion) {
    await enviarMensaje(
      chatId,
      'Este código no existe o ya expiró. ' +
      'Solicita uno nuevo en MyConsult MD.'
    );

    return;
  }

  vinculacion.chatId = chatId;

  await enviarMensaje(
    chatId,
    'Solicitud de vinculación recibida. 🩺\n\n' +
    'Regresa a MyConsult MD y pulsa "Verificar vinculación".'
  );

  console.log('Vinculación recibida:', {
    pacienteId: vinculacion.pacienteId,
    chatId
  });
}

module.exports = async (req, res) => {
  // CORS: permitir peticiones desde Ionic.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  console.log('[TELEGRAM API]', {
  method: req.method,
  url: req.url,
  query: req.query
});

  // El navegador envía OPTIONS antes de ciertas peticiones POST.
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  console.log('[TELEGRAM API]', {
    method: req.method,
    url: req.url
  });

  if (!TOKEN) {
    return res.status(500).json({
      mensaje: 'Falta configurar TELEGRAM_BOT_TOKEN en Vercel.'
    });
  }

  const ruta = (req.url || '/')
    .split('?')[0]
    .replace(/\/+$/, '') || '/';

  try {
    // Comprobar la conexión con Telegram.
    if (ruta.endsWith('/estado') && req.method === 'GET') {
      const info = await telegram('getMe');

      return res.status(200).json({
        conectado: true,
        nombre: info.first_name,
        usuario: info.username
      });
    }

    // Configurar el webhook.
    if (
      ruta.endsWith('/configurar-webhook') &&
      req.method === 'GET'
    ) {
      if (!SETUP_SECRET || req.query?.secret !== SETUP_SECRET) {
        return res.status(403).json({
          mensaje: 'No autorizado.'
        });
      }

      if (!APP_URL) {
        return res.status(500).json({
          mensaje: 'Configura APP_URL en las variables de Vercel.'
        });
      }

      const webhookUrl = `${APP_URL}/api/telegram/webhook`;

      await telegram('setWebhook', {
        url: webhookUrl,
        allowed_updates: ['message'],
        ...(WEBHOOK_SECRET
          ? { secret_token: WEBHOOK_SECRET }
          : {})
      });

      const info = await telegram('getWebhookInfo');

      return res.status(200).json({
        configurado: true,
        webhook: info.url,
        mensajesPendientes: info.pending_update_count
      });
    }

    // Recibir mensajes enviados por Telegram.
    if (ruta.endsWith('/webhook') && req.method === 'POST') {
      if (
        WEBHOOK_SECRET &&
        req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET
      ) {
        return res.status(401).json({
          mensaje: 'Webhook no autorizado.'
        });
      }

      const actualizacion = req.body;

      if (actualizacion?.message) {
        await procesarMensaje(actualizacion.message);
      }

      return res.status(200).json({
        ok: true
      });
    }

    // Generar código para vincular un paciente.
    if (
      ruta.endsWith('/generar-codigo') &&
      req.method === 'POST'
    ) {
      if (!BOT_USERNAME) {
        return res.status(500).json({
          mensaje: 'Falta configurar TELEGRAM_BOT_USERNAME en Vercel.'
        });
      }

      const pacienteId = req.body?.pacienteId;

      if (
        !Number.isInteger(pacienteId) ||
        pacienteId <= 0
      ) {
        return res.status(400).json({
          mensaje: 'El ID del paciente no es válido.'
        });
      }

      const codigo = crypto
        .randomBytes(4)
        .toString('hex')
        .toUpperCase();

      codigosVinculacion.set(codigo, {
        pacienteId,
        creado: Date.now(),
        chatId: null
      });

      return res.status(200).json({
        codigo,
        enlace: `https://t.me/${BOT_USERNAME}?start=${codigo}`,
        expiraEnSegundos: 600
      });
    }

    // Consultar el estado de una vinculación.
    const coincidencia = ruta.match(
      /\/vinculacion\/([A-Za-z0-9]+)$/
    );

    if (coincidencia && req.method === 'GET') {
      const codigo = coincidencia[1].toUpperCase();
      const vinculacion = codigoValido(codigo);

      if (!vinculacion) {
        return res.status(404).json({
          vinculada: false,
          mensaje: 'El código no existe o ya expiró.'
        });
      }

      if (!vinculacion.chatId) {
        return res.status(200).json({
          vinculada: false,
          pendiente: true,
          mensaje: 'Todavía no se ha iniciado el bot con este código.'
        });
      }

      return res.status(200).json({
        vinculada: true,
        pacienteId: vinculacion.pacienteId,
        chatId: vinculacion.chatId
      });
    }

    // Eliminar el código después de completar la vinculación.
    if (coincidencia && req.method === 'DELETE') {
      const codigo = coincidencia[1].toUpperCase();
      const vinculacion = codigoValido(codigo);

      if (!vinculacion || !vinculacion.chatId) {
        return res.status(404).json({
          mensaje: 'No hay una vinculación pendiente.'
        });
      }

      codigosVinculacion.delete(codigo);

      return res.status(200).json({
        eliminada: true
      });
    }

    return res.status(404).json({
      mensaje: 'Ruta no encontrada.',
      ruta
    });
  } catch (error) {
    console.error('Error en backend de Telegram:', error);

    return res.status(500).json({
      mensaje: 'Error procesando la solicitud de Telegram.',
      detalle: error.message
    });
  }
};
