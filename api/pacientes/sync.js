const { getFirestore } = require('firebase-admin/firestore');
const { obtenerFirebaseAdmin } = require('../../services/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ mensaje: 'Método no permitido.' });

  const secreto = (process.env.NOTIFICACIONES_API_SECRET || '').trim();
  if ((req.headers.authorization || '').trim() !== `Bearer ${secreto}`) {
    return res.status(401).json({ mensaje: 'No autorizado.' });
  }

  const { pacientes } = req.body || {};
  if (!Array.isArray(pacientes)) {
    return res.status(400).json({ mensaje: 'Falta array pacientes.' });
  }

  obtenerFirebaseAdmin();
  const db = getFirestore();

  // Borra todos y reescribe (simple y confiable para consultorios pequeños)
  const existentes = await db.collection('pacientes').get();
  const batch = db.batch();
  existentes.forEach(d => batch.delete(d.ref));

  pacientes.forEach(p => {
    if (!p.id) return;
    batch.set(db.collection('pacientes').doc(String(p.id)), {
      nombre: p.nombre || '',
      telefono: p.telefono || '',
      telegram_vinculado: p.telegram_vinculado ? 1 : 0,
      fecha_registro: p.fecha_registro || new Date().toISOString()
    });
  });

  await batch.commit();
  return res.json({ ok: true, sincronizados: pacientes.length });
};