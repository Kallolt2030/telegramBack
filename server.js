
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME;

const codigosVinculacion = new Map();

if (!TOKEN) {
  throw new Error('Falta TELEGRAM_BOT_TOKEN en el archivo .env');
}

if (!BOT_USERNAME) {
  throw new Error('Falta TELEGRAM_BOT_USERNAME en el archivo .env');
}

app.use(cors());
app.use(express.json());

// Crear el bot con recepción de mensajes.
const bot = new TelegramBot(TOKEN, { polling: true });

// Backend activo.
app.get('/', (req, res) => {
  res.json({ mensaje: 'Backend de MyConsult MD activo' });
});

// Comprobar conexión con Telegram.
app.get('/api/telegram/estado', async (req, res) => {
  try {
    const info = await bot.getMe();

    res.json({
      conectado: true,
      nombre: info.first_name,
      usuario: info.username
    });
  } catch (error) {
    console.error('Error de Telegram:', error.message);

    res.status(502).json({
      conectado: false,
      mensaje: 'No se pudo conectar con Telegram',
      detalle: error.message
    });
  }
});

// Generar código de vinculación.
app.post('/api/telegram/generar-codigo', (req, res) => {
  const { pacienteId } = req.body;

  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return res.status(400).json({
      mensaje: 'El ID del paciente no es válido.'
    });
  }

  const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();

  codigosVinculacion.set(codigo, {
    pacienteId,
    creado: Date.now(),
    chatId: null
  });

  const enlace =
    `https://t.me/${BOT_USERNAME}?start=${codigo}`;

  res.json({
    codigo,
    enlace,
    expiraEnSegundos: 600
  });
});

// Procesar /start y /start CODIGO.
bot.onText(/^\/start(?:\s+([A-Za-z0-9]+))?$/, async (msg, match) => {
  try {
    const codigo = match?.[1]?.toUpperCase();
    const chatId = String(msg.chat.id);

    if (!codigo) {
      await bot.sendMessage(
        msg.chat.id,
        '¡Bienvenido a MyConsult MD! 🩺\n\n' +
        'Para vincular tu cuenta, solicita un enlace de vinculación ' +
        'desde tu consultorio.'
      );
      return;
    }

    const vinculacion = codigosVinculacion.get(codigo);

    if (
      !vinculacion ||
      Date.now() - vinculacion.creado > 10 * 60 * 1000
    ) {
      codigosVinculacion.delete(codigo);

      await bot.sendMessage(
        msg.chat.id,
        'Este código no existe o ya expiró. ' +
        'Solicita uno nuevo en MyConsult MD.'
      );
      return;
    }

    vinculacion.chatId = chatId;

    await bot.sendMessage(
      msg.chat.id,
      'Solicitud de vinculación recibida. 🩺\n\n' +
      'Regresa a MyConsult MD y pulsa "Verificar vinculación".'
    );

    console.log('Solicitud de vinculación recibida:', {
      pacienteId: vinculacion.pacienteId,
      chatId
    });
  } catch (error) {
    console.error('Error al procesar /start:', error.message);
  }
});

// Consultar el estado de una vinculación.
app.get('/api/telegram/vinculacion/:codigo', (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const vinculacion = codigosVinculacion.get(codigo);

  if (
    !vinculacion ||
    Date.now() - vinculacion.creado > 10 * 60 * 1000
  ) {
    codigosVinculacion.delete(codigo);

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

  res.json({
    vinculada: true,
    pacienteId: vinculacion.pacienteId,
    chatId: vinculacion.chatId
  });
});

// Consumir el código después de guardar la vinculación en SQLite.
app.delete('/api/telegram/vinculacion/:codigo', (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const vinculacion = codigosVinculacion.get(codigo);

  if (!vinculacion || !vinculacion.chatId) {
    return res.status(404).json({
      mensaje: 'No hay una vinculación pendiente.'
    });
  }

  codigosVinculacion.delete(codigo);

  res.json({ eliminada: true });
});

// Registrar errores de polling.
bot.on('polling_error', (error) => {
  console.error('Error de conexión con Telegram:', error.message);
});

// Registrar mensajes recibidos.
bot.on('message', (msg) => {
  console.log('Mensaje recibido de Telegram:', {
    chatId: msg.chat?.id,
    nombre: msg.from?.first_name,
    texto: msg.text
  });
});

app.listen(PORT, () => {
  console.log(`MyConsult MD activo en http://localhost:${PORT}`);
});
