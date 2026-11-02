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

  const { citas } = req.body || {};
  if (!Array.isArray(citas)) {
    return res.status(400).json({ mensaje: 'Falta array citas.' });
  }

  obtenerFirebaseAdmin();
  const db = getFirestore();
  const batch = db.batch();

  // Borra solo las citas futuras (no toca historial pasado) y reescribe
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const futurasSnap = await db.collection('citas').where('fecha', '>=', hoy).get();
  futurasSnap.forEach(doc => batch.delete(doc.ref));

  citas.forEach(c => {
    if (!c.fecha || !c.hora || !c.paciente_id) return;
    const ref = db.collection('citas').doc(`${c.fecha}_${c.hora}_${c.paciente_id}`);
    batch.set(ref, {
      fecha: c.fecha,
      hora: c.hora,
      paciente: c.paciente || '',
      paciente_id: c.paciente_id,
      tipo: c.tipo || '',
      procedimiento: c.procedimiento || '',
      estado: c.estado || 'pendiente'
    });
  });

  await batch.commit();
  return res.json({ ok: true, sincronizadas: citas.length });
};