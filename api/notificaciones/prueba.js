
const { admin, obtenerFirebaseAdmin } = require('../../services/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      mensaje: 'Método no permitido.'
    });
  }

  // Proteger el endpoint con un secreto configurado en Vercel.
    const secreto = (process.env.NOTIFICACIONES_API_SECRET || '').trim();
    const autorizacion = (req.headers.authorization || '').trim();

    if (!secreto || autorizacion !== `Bearer ${secreto}`) {
    console.error('[FCM] Error de autenticación:', {
        secretoConfigurado: Boolean(secreto),
        autorizacionRecibida: Boolean(autorizacion),
        coincide: autorizacion === `Bearer ${secreto}`
    });

    return res.status(401).json({
        mensaje: 'No autorizado.'
    });
    }

  try {
    const { token, titulo, mensaje } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        mensaje: 'Debes proporcionar un token FCM válido.'
      });
    }

    obtenerFirebaseAdmin();

    const respuesta = await admin.messaging().send({
      token,
      notification: {
        title: titulo || 'MyConsult MD',
        body: mensaje || 'Notificación de prueba de Firebase.'
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'default'
        }
      }
    });

    return res.status(200).json({
      enviada: true,
      mensaje: 'Notificación enviada correctamente.',
      messageId: respuesta
    });

  } catch (error) {
    console.error('[FCM] Error al enviar:', error);

    return res.status(500).json({
      enviada: false,
      mensaje: 'No se pudo enviar la notificación.',
      detalle: error.code || error.message
    });
  }
};
