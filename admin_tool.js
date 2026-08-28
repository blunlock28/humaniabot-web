#!/usr/bin/env node
/**
 * admin_tool.js — Herramienta de administración CLI para HumanIA
 *
 * Uso:
 *   node admin_tool.js activate <email> <plan>   → activa usuario (free | member | vip)
 *   node admin_tool.js list                      → lista todos los usuarios
 *   node admin_tool.js stats                     → estadísticas globales
 */

require('dotenv').config();
const { Database } = require('sqlite3');
const path = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'humania.db');
const PLANES_VALIDOS = ['free', 'member', 'vip'];
const EMOJIS_PLAN = { free: '🆓', member: '⭐', vip: '👑' };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function openDB() {
  return new Database(DB_PATH, (err) => {
    if (err) {
      console.error('❌  No se pudo abrir humania.db:', err.message);
      process.exit(1);
    }
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { timeZone: 'America/Bogota' });
}

// ─── Comandos ─────────────────────────────────────────────────────────────────

/** Activa un usuario en el plan indicado */
function cmdActivate(email, plan) {
  if (!email) {
    console.error('❌  Debes indicar un email. Ej: node admin_tool.js activate user@mail.com vip');
    process.exit(1);
  }
  if (!PLANES_VALIDOS.includes(plan)) {
    console.error(`❌  Plan inválido "${plan}". Opciones: ${PLANES_VALIDOS.join(', ')}`);
    process.exit(1);
  }

  const db = openDB();
  const isPremium = plan !== 'free' ? 1 : 0;

  db.run(
    `UPDATE users SET is_premium = ?, plan = ? WHERE email = ?`,
    [isPremium, plan, email],
    function (err) {
      if (err) {
        console.error('❌  Error al actualizar usuario:', err.message);
        db.close();
        process.exit(1);
      }
      if (this.changes === 0) {
        console.warn(`⚠️  No se encontró ningún usuario con email: ${email}`);
        db.close();
        process.exit(0);
      }
      const emoji = EMOJIS_PLAN[plan];
      console.log(`\n✅  Usuario actualizado exitosamente`);
      console.log(`   📧 Email : ${email}`);
      console.log(`   ${emoji} Plan  : ${plan.toUpperCase()}`);
      console.log(`   🕐 Fecha : ${formatDate(new Date().toISOString())}\n`);
      db.close();
    }
  );
}

/** Lista todos los usuarios con su plan */
function cmdList() {
  const db = openDB();
  db.all(
    `SELECT id, email, plan, messages_count, is_premium, created_at FROM users ORDER BY is_premium DESC, plan DESC, email ASC`,
    [],
    (err, rows) => {
      if (err) { console.error('❌  Error al consultar usuarios:', err.message); db.close(); process.exit(1); }
      if (rows.length === 0) { console.log('\n📭  No hay usuarios registrados aún.\n'); db.close(); return; }

      console.log('\n╔══════════════════════════════════════════════════════════════════╗');
      console.log('║              👥  USUARIOS DE HUMANIA                            ║');
      console.log('╠══════════════════════════════════════════════════════════════════╣');
      console.log(`║ ${'ID'.padEnd(5)} ${'EMAIL'.padEnd(32)} ${'PLAN'.padEnd(10)} ${'MSGS'.padEnd(6)} ║`);
      console.log('╠══════════════════════════════════════════════════════════════════╣');

      rows.forEach((u) => {
        const emoji = EMOJIS_PLAN[u.plan] || '❓';
        const id    = String(u.id).padEnd(5);
        const email = (u.email || '').substring(0, 32).padEnd(32);
        const plan  = (`${emoji} ${u.plan}`).padEnd(10);
        const msgs  = String(u.messages_count ?? 0).padEnd(6);
        console.log(`║ ${id} ${email} ${plan} ${msgs} ║`);
      });

      console.log('╚══════════════════════════════════════════════════════════════════╝');
      console.log(`   Total: ${rows.length} usuario(s)\n`);
      db.close();
    }
  );
}

/** Estadísticas globales */
function cmdStats() {
  const db = openDB();
  db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN plan='free'   THEN 1 ELSE 0 END) AS free_count,
       SUM(CASE WHEN plan='member' THEN 1 ELSE 0 END) AS member_count,
       SUM(CASE WHEN plan='vip'    THEN 1 ELSE 0 END) AS vip_count,
       SUM(COALESCE(messages_count,0)) AS total_msgs
     FROM users`,
    [],
    (err, row) => {
      if (err) { console.error('❌  Error al obtener estadísticas:', err.message); db.close(); process.exit(1); }
      const ingresos = (row.member_count || 0) * 7 + (row.vip_count || 0) * 20;
      console.log('\n╔══════════════════════════════════════╗');
      console.log('║      📊  ESTADÍSTICAS HUMANIA        ║');
      console.log('╠══════════════════════════════════════╣');
      console.log(`║  👥 Usuarios totales  : ${String(row.total        || 0).padStart(9)} ║`);
      console.log(`║  🆓 Usuarios free     : ${String(row.free_count   || 0).padStart(9)} ║`);
      console.log(`║  ⭐ Usuarios member   : ${String(row.member_count || 0).padStart(9)} ║`);
      console.log(`║  👑 Usuarios VIP      : ${String(row.vip_count    || 0).padStart(9)} ║`);
      console.log('╠══════════════════════════════════════╣');
      console.log(`║  💬 Mensajes totales  : ${String(row.total_msgs || 0).padStart(9)} ║`);
      console.log(`║  💰 Ingresos estimados: $${String(ingresos).padStart(7)} USD ║`);
      console.log('╚══════════════════════════════════════╝\n');
      db.close();
    }
  );
}

/** Ayuda */
function cmdHelp() {
  console.log(`
🤖  HumanIA Admin Tool

Uso:
  node admin_tool.js activate <email> <plan>   Activa un usuario
  node admin_tool.js list                      Lista todos los usuarios
  node admin_tool.js stats                     Muestra estadísticas globales

Planes:  🆓 free ($0) | ⭐ member ($7/mes) | 👑 vip ($20/mes)

Ejemplos:
  node admin_tool.js activate juan@mail.com vip
  node admin_tool.js activate ana@mail.com member
  node admin_tool.js list
  node admin_tool.js stats
`);
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────
const [,, cmd, arg1, arg2] = process.argv;
switch (cmd) {
  case 'activate': cmdActivate(arg1, arg2 || 'free'); break;
  case 'list':     cmdList();  break;
  case 'stats':    cmdStats(); break;
  default:         cmdHelp();  break;
}
