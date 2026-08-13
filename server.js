// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// server.js — Cerebro de Humania Web App
// 🧑‍🏫 Este archivo es el servidor que:
//    1. Sirve los archivos HTML al navegador
//    2. Recibe los mensajes del chat
//    3. Los envía a DeepSeek
//    4. Devuelve la respuesta al chat
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 🧑‍🏫 path.join() construye rutas de archivo
//    que funcionan en Windows Y en Linux (el VPS)
const path = require('path');

// 🧑‍🏫 "require" es la forma de importar herramientas en Node.js
//    Es como decir "necesito esta librería para funcionar"
require('dotenv').config(); // Carga las variables del archivo .env
const express = require('express'); // Framework para crear el servidor
const cors    = require('cors');    // Permite que el chat llame al servidor
const https   = require('https');   // Para hacer llamadas a DeepSeek API
const bcrypt  = require('bcryptjs'); // 🧑‍🏫 Para encriptar contraseñas
const jwt     = require('jsonwebtoken'); // 🧑‍🏫 Para los pases VIP (tokens)
const db      = require('./database'); // 🧑‍🏫 Nuestra base de datos SQLite

const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto_humania_123';

const app  = express();
const PORT = process.env.PORT || 3000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MIDDLEWARES
// 🧑‍🏫 "Middleware" = funciones que procesan las peticiones antes
//    de que lleguen a tu código. Como filtros o preparadores.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.use(cors());                    // Permite peticiones del navegador
app.use(express.json());            // Entiende JSON que viene del chat
app.use(express.static('.'));       // Sirve index.html y chat.html

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCIÓN: Llamar a DeepSeek API
// 🧑‍🏫 Esta función hace la llamada real a DeepSeek.
//    Usamos https.request (incluido en Node.js, sin instalar nada extra)
//    para no depender de librerías externas para esta parte.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function callDeepSeek(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    
    // 🧑‍🏫 El "body" es lo que le mandamos a DeepSeek.
    //    - model: qué modelo usar (deepseek-chat es el más económico)
    //    - messages: el historial completo de conversación
    //    - temperature: qué tan "creativo" responde (0.8 = bastante natural)
    //    - max_tokens: máximo de palabras en la respuesta
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt }, // La personalidad del personaje
        ...messages                                  // El historial de conversación
      ],
      temperature: 0.8,
      max_tokens: 500
    });

    // 🧑‍🏫 Configuración de la petición HTTP a DeepSeek
    const options = {
      hostname: 'api.deepseek.com',
      path:     '/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      // 🧑‍🏫 Los datos llegan en "chunks" (pedazos).
      //    Los vamos juntando hasta que llegue todo.
      res.on('data', chunk => data += chunk);
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          
          // 🧑‍🏫 DeepSeek devuelve la respuesta en:
          //    parsed.choices[0].message.content
          if (parsed.choices && parsed.choices[0]) {
            resolve(parsed.choices[0].message.content);
          } else {
            // Si hay error de API (saldo, key inválida, etc.)
            console.error('DeepSeek error:', parsed);
            reject(new Error(parsed.error?.message || 'DeepSeek API error'));
          }
        } catch (e) {
          reject(new Error('Failed to parse DeepSeek response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTENTICACIÓN: Middleware para verificar el Token
// 🧑‍🏫 Esto es como el "cadenero" (bouncer) de la discoteca.
// Revisa si la petición trae un token válido antes de dejarla pasar al chat.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // El formato es "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ error: 'Debes iniciar sesión para chatear.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Tu sesión ha expirado. Inicia sesión de nuevo.' });
    }
    req.user = user; // Guardamos los datos del usuario en la petición
    next(); // Pasa al siguiente paso (el endpoint)
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/register
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    // Encriptar la contraseña (nadie, ni tú, podrá verla)
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    db.run(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, [email, hash], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Este email ya está registrado' });
        }
        return res.status(500).json({ error: 'Error al registrar usuario' });
      }
      
      // Usuario creado exitosamente, le damos su primer token
      const token = jwt.sign({ id: this.lastID, email, is_premium: 0 }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ message: 'Registro exitoso', token });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/login
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    if (!user) return res.status(400).json({ error: 'Email o contraseña incorrectos' });

    // Comparar la contraseña ingresada con el hash guardado
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Email o contraseña incorrectos' });

    // Token válido por 7 días
    const token = jwt.sign({ id: user.id, email: user.email, is_premium: user.is_premium }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login exitoso', token, messages_count: user.messages_count, is_premium: user.is_premium });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/chat
// 🧑‍🏫 Ahora usamos "authenticateToken" para que solo usuarios logueados pasen
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { characterPrompt, messages } = req.body;
    const userId = req.user.id;

    if (!characterPrompt || !messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Faltan datos del mensaje' });
    }

    // Verificar que la API key de DeepSeek exista
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.includes('aqui_va')) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // 1. Revisar cuántos mensajes lleva el usuario
    db.get(`SELECT messages_count, is_premium FROM users WHERE id = ?`, [userId], async (err, user) => {
      if (err) return res.status(500).json({ error: 'Error de base de datos' });
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

      // 2. Bloquear si ya consumió sus 10 mensajes y no es premium
      if (user.messages_count >= 10 && !user.is_premium) {
        return res.status(403).json({ 
          error: 'Límite alcanzado', 
          requires_upgrade: true 
        });
      }

      // 3. Llamar a DeepSeek (Si llegó aquí, es que tiene permiso)
      try {
        const reply = await callDeepSeek(characterPrompt, messages);
        
        // 4. Sumar 1 al contador de mensajes
        db.run(`UPDATE users SET messages_count = messages_count + 1 WHERE id = ?`, [userId]);

        res.json({ reply, messages_count: user.messages_count + 1 });
      } catch (aiError) {
        console.error('DeepSeek call error:', aiError);
        res.status(500).json({ error: 'Error al contactar a la IA' });
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RUTA RAÍZ
// 🧑‍🏫 Cuando alguien visita http://localhost:3000
//    le servimos el index.html directamente
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/chat', (req, res) => {
  res.redirect('/chat.html');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ARRANCAR EL SERVIDOR
// 🧑‍🏫 app.listen() pone el servidor a escuchar en el puerto 3000.
//    Puerto = la "puerta" por donde entran las peticiones.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.listen(PORT, () => {
  console.log(`
  ✅ Humania servidor corriendo en http://localhost:${PORT}
  
  📄 Landing page: http://localhost:${PORT}
  💬 Chat:         http://localhost:${PORT}/chat
  
  🔑 API Key: ${process.env.DEEPSEEK_API_KEY ? '✅ Configurada' : '❌ Falta en .env'}
  `);
});
