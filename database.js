const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 🧑‍🏫 Crea o conecta a la base de datos
// Esto creará un archivo llamado "humania.db" en tu carpeta.
// Es una base de datos real pero guardada en un archivo local.
const dbPath = path.join(__dirname, 'humania.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error al conectar con la base de datos:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos SQLite (humania.db)');
  }
});

// 🧑‍🏫 Inicializar las tablas si no existen
// Aquí le decimos qué columnas va a tener nuestra tabla de usuarios
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      messages_count INTEGER DEFAULT 0,
      is_premium BOOLEAN DEFAULT 0,
      plan TEXT DEFAULT 'free',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Intentamos añadir la columna por si la base de datos ya existía
  db.run(`ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'`, (err) => {
    // Si da error es porque probablemente ya existe la columna, lo ignoramos.
    if (!err) console.log('✅ Columna "plan" añadida a la tabla users.');
  });
  console.log('✅ Tabla "users" inicializada.');
});

module.exports = db;
