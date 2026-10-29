
const crypto = require('crypto');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const SETUP_SECRET = process.env.WEBHOOK_SETUP_SECRET;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// Solo sirve como almacenamiento temporal.
// Vercel NO garantiza que esta memoria sobreviva entre peticiones.
const codigosVinculacion = new Map();

async function telegram(metodo, datos = {}) {
  const respuesta = await fetch(
    `https://api.telegram.org/bot${TOKEN}/${metodo}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  if (!vinculacion) return null;

  if (Date.now() - vinculacion.creado > 10 * 60 * 1000) {
    codigosVinculacion.delete(codigo);
    return null;
  }

  return vinculacion;
}

async function procesarMensaje(mensaje) {
  if (!mensaje?.text || !mensaje.chat?.id) return;

  const texto = mensaje.text.trim();
  const chatId = String(mensaje.chat.id);

  console.log('Mensaje recibido:', {
    chatId,
    texto
  });

  const coincidencia = texto.match(
    /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9]+))?$/
  );

  if (!coincidencia) return;

  const codigo = coincidencia[1]?.toUpperCase();

  if (!codigo) {
    await enviarMensaje(
      chatId,
      '¡Bienvenido a MyConsult MD! 🩺\n\n' +
      'Para vincular tu cuenta, solicita un enlace de vinculación ' +
      'desde tu consultorio y abre ese enlace en Telegram.'
    );
    return;
  }

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
  if (!TOKEN || !BOT_USERNAME) {
    return res.status(500).json({
      mensaje: 'Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_BOT_USERNAME.'
    });
  }

  const ruta = (req.url || '/').split('?')[0]
    .replace(/\/+$/, '') || '/';

  try {
    // Comprobar que el token funciona.
    if (ruta.endsWith('/estado') && req.method === 'GET') {
      const info = await telegram('getMe');

      return res.json({
        conectado: true,
        nombre: info.first_name,
        usuario: info.username
      });
    }

    // Configurar el webhook una sola vez.
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
        secret_token: WEBHOOK_SECRET || undefined
      });

      const info = await telegram('getWebhookInfo');

      return res.json({
        configurado: true,
        webhook: info.url,
        mensajesPendientes: info.pending_update_count
      });
    }

    // Telegram envía aquí los mensajes recibidos por el bot.
    if (ruta.endsWith('/webhook') && req.method === 'POST') {
      if (
        WEBHOOK_SECRET &&
        req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET
      ) {
        return res.status(401).json({ mensaje: 'Webhook no autorizado.' });
      }

      // Responder a Telegram después de procesar el mensaje.
      const actualizacion = req.body;

      if (actualizacion?.message) {
        await procesarMensaje(actualizacion.message);
      }

      return res.status(200).json({ ok: true });
    }

    // Generar código para vincular un paciente.
    if (
      ruta.endsWith('/generar-codigo') &&
      req.method === 'POST'
    ) {
      const pacienteId = req.body?.pacienteId;

      if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
        return res.status(400).json({
          mensaje: 'El ID del paciente no es válido.'
        });
      }

      const codigo = crypto.randomBytes(4)
        .toString('hex')
        .toUpperCase();

      codigosVinculacion.set(codigo, {
        pacienteId,
        creado: Date.now(),
        chatId: null
      });

      return res.json({
        codigo,
        enlace: `https://t.me/${BOT_USERNAME}?start=${codigo}`,
        expiraEnSegundos: 600
      });
    }

    // Consultar si se inició la vinculación.
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
        return res.json({
          vinculada: false,
          pendiente: true,
          mensaje: 'Todavía no se ha iniciado el bot con este código.'
        });
      }

      return res.json({
        vinculada: true,
        pacienteId: vinculacion.pacienteId,
        chatId: vinculacion.chatId
      });
    }

    // Eliminar el código después de guardar la vinculación.
    if (coincidencia && req.method === 'DELETE') {
      const codigo = coincidencia[1].toUpperCase();
      const vinculacion = codigoValido(codigo);

      if (!vinculacion || !vinculacion.chatId) {
        return res.status(404).json({
          mensaje: 'No hay una vinculación pendiente.'
        });
      }

      codigosVinculacion.delete(codigo);

      return res.json({ eliminada: true });
    }

    return res.status(404).json({
      mensaje: 'Ruta no encontrada.',
      ruta
    });
  } catch (error) {
    console.error('Error en backend de Telegram:', error.message);

    return res.status(500).json({
      mensaje: 'Error procesando la solicitud de Telegram.'
    });
  }
};
