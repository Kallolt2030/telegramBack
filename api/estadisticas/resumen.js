const { getFirestore } = require('firebase-admin/firestore');
const { obtenerFirebaseAdmin } = require('../../services/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ mensaje: 'Método no permitido.' });

  const secreto = (process.env.NOTIFICACIONES_API_SECRET || '').trim();
  if ((req.headers.authorization || '').trim() !== `Bearer ${secreto}`) {
    return res.status(401).json({ mensaje: 'No autorizado.' });
  }

  try {
    obtenerFirebaseAdmin();
    const db = getFirestore();

    // Fecha de HOY en zona CDMX (YYYY-MM-DD)
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

    // 1. Citas de hoy
    const citasHoySnap = await db.collection('citas').where('fecha', '==', hoy).get();
    const totalCitas = citasHoySnap.size;
    const citasPendientes = citasHoySnap.docs.filter(d => (d.data().estado || 'pendiente') === 'pendiente').length;

    // 2. Próximas citas (desde hoy, ordenadas)
    const futurasSnap = await db.collection('citas').where('fecha', '>=', hoy).get();
    const proximasCitas = futurasSnap.docs
      .map(d => d.data())
      .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`))
      .slice(0, 5)
      .map(c => ({
        hora: c.hora,
        paciente: c.paciente,
        tipo: c.tipo || 'Consulta',
        estado: (c.estado || 'pendiente').toLowerCase() === 'pendiente' ? 'Pendiente'
              : (c.estado || '').toLowerCase() === 'realizada' ? 'Realizada' : c.estado
      }));

    // 3. Total de pacientes
    const pacientesSnap = await db.collection('pacientes').count().get();
    const totalPacientes = pacientesSnap.data().count;

    return res.json({
      totalCitas,
      citasPendientes,
      totalPacientes,
      proximasCitas,
      actualizadoEn: new Date().toISOString()
    });
  } catch (e) {
    console.error('[stats] Error:', e);
    return res.status(500).json({ error: e.message });
  }
};