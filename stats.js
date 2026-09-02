const db = require('./database');

console.log("\n=========================================");
console.log("📊 RESUMEN DE ACTIVIDAD DE HUMANIA 📊");
console.log("=========================================\n");

// Consultar total de usuarios
db.get(`SELECT COUNT(*) as total FROM users`, (err, row) => {
  if (err) return console.error(err);
  console.log(`👤 Total de Usuarios Registrados: ${row.total}`);
  
  // Consultar usuarios VIP
  db.get(`SELECT COUNT(*) as vip FROM users WHERE plan = 'vip'`, (err, rowVip) => {
    console.log(`👑 Usuarios VIP: ${rowVip.vip}\n`);
    
    // Consultar total de mensajes
    db.get(`SELECT COUNT(*) as total_msgs FROM chat_history`, (err, rowMsgs) => {
      console.log(`💬 Total de Mensajes Intercambiados: ${rowMsgs.total_msgs}\n`);
      
      console.log("📝 ÚLTIMOS 5 USUARIOS REGISTRADOS:");
      console.log("-----------------------------------------");
      db.all(`SELECT email, plan, messages_count, created_at FROM users ORDER BY created_at DESC LIMIT 5`, (err, rows) => {
        rows.forEach(r => {
          console.log(`- ${r.email} | Plan: ${r.plan} | Mensajes: ${r.messages_count}`);
        });
        
        console.log("\n=========================================\n");
      });
    });
  });
});
