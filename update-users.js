const sqlite3 = require('sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'humania.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Asegurarnos de que la columna existe en el VPS del usuario
  db.run("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'", (err) => {
    // Ignoramos el error si ya existe
    
    // Actualizamos al VIP
    db.run("UPDATE users SET is_premium = 1, plan = 'vip' WHERE email = 'humaniabot.support@gmail.com'", function(err) {
      if (err) console.error("Error VIP:", err.message);
      else console.log(`humaniabot.support@gmail.com -> VIP (Filas afectadas: ${this.changes})`);
    });

    // Actualizamos al Member
    db.run("UPDATE users SET is_premium = 1, plan = 'member' WHERE email = 'coldair.bqto@gmail.com'", function(err) {
      if (err) console.error("Error MEMBER:", err.message);
      else console.log(`coldair.bqto@gmail.com -> MEMBER (Filas afectadas: ${this.changes})`);
    });
  });
});
