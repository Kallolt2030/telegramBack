const { initializeApp, getApps, cert } = require('firebase-admin/app');

function obtenerFirebaseAdmin() {
  // 1. getApps() devuelve un array con las apps inicializadas.
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Faltan las variables de configuración de Firebase.'
    );
  }

  // 2. La inicialización ahora es una función importada.
  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n')
    })
  });
}

module.exports = {
  obtenerFirebaseAdmin
};