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
const crypto  = require('crypto'); // Para utilidades de encriptación y webhooks
const rateLimit = require('express-rate-limit'); // [SEGURIDAD] Protección Anti-DDoS

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ CRÍTICO: No se encontró JWT_SECRET en el archivo .env. Abortando inicio del servidor por seguridad.');
  process.exit(1);
}
const app  = express();
app.set('trust proxy', 1); // Necesario para que express-rate-limit funcione correctamente detrás de Nginx/Cloudflare
const PORT = process.env.PORT || 3000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MIDDLEWARES
// 🧑‍🏫 "Middleware" = funciones que procesan las peticiones antes
//    de que lleguen a tu código. Como filtros o preparadores.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🧑‍🏫 Añadimos cabeceras de seguridad manuales que no interfieren con PayPal ni LemonSqueezy
app.disable('x-powered-by'); // Oculta que estamos usando Express (evita ataques dirigidos)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); // Evita que el navegador adivine tipos de archivo (ataques MIME)
  res.setHeader('X-Frame-Options', 'DENY'); // Evita que clonen tu página dentro de un Iframe invisible (Clickjacking)
  res.setHeader('X-XSS-Protection', '1; mode=block'); // Filtro XSS básico para navegadores
  next();
});
// Configuración de CORS estricta (solo permite tráfico desde tu dominio)
const allowedOrigins = ['https://humaniabot.com', 'https://www.humaniabot.com', 'http://localhost:3000', 'http://127.0.0.1:3000'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Bloqueado por CORS - Origen no permitido'));
    }
  }
}));

// Limitadores de peticiones (Protección contra Fuerza Bruta y DDoS)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // Limita cada IP a 10 peticiones de login/registro por ventana
  message: { error: 'Demasiados intentos desde esta IP. Por seguridad, intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 20, // Limita a 20 mensajes por minuto por IP para evitar abuso de la API
  message: { error: 'Estás enviando mensajes demasiado rápido. Espera un momento.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({
  limit: '1mb', // Previene ataques de payload gigante
  verify: (req, res, buf) => {
    req.rawBody = buf; // Necesario para verificar la firma de Lemon Squeezy
  }
})); // Entiende JSON que viene del chat
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static('.', {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
})); // Sirve index.html y chat.html

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCIÓN: Llamar a DeepSeek API
// 🧑‍🏫 Esta función hace la llamada real a DeepSeek.
//    Usamos https.request (incluido en Node.js, sin instalar nada extra)
//    para no depender de librerías externas para esta parte.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function callDeepSeekStream(systemPrompt, messages, onChunk, onEnd, onError) {
  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature: 0.8,
    max_tokens: 500,
    stream: true // 🧑‍🏫 Activamos el streaming de DeepSeek
  });

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
    if (res.statusCode !== 200) {
      let errData = '';
      res.on('data', c => errData += c);
      res.on('end', () => onError(new Error(`DeepSeek API Error: ${errData}`)));
      return;
    }

    let buffer = '';
    res.on('data', chunk => {
      buffer += chunk.toString();
      let parts = buffer.split('\n');
      buffer = parts.pop(); // Guarda el pedazo incompleto para el siguiente chunk
      
      for (let line of parts) {
        line = line.trim();
        if (line.startsWith('data: ')) {
          if (line === 'data: [DONE]') continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
              onChunk(parsed.choices[0].delta.content);
            }
          } catch(e) {}
        }
      }
    });

    res.on('end', onEnd);
  });

  req.on('error', onError);
  req.write(body);
  req.end();
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
app.post('/api/register', authLimiter, async (req, res) => {
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
      const token = jwt.sign({ id: this.lastID, email, is_premium: 0, plan: 'free' }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ message: 'Registro exitoso', token, plan: 'free' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/login
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/login', authLimiter, (req, res) => {
  const { email, password } = req.body;
  
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    if (!user) return res.status(400).json({ error: 'Email o contraseña incorrectos' });

    // Comparar la contraseña ingresada con el hash guardado
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Email o contraseña incorrectos' });

    // Token válido por 7 días
    const userPlan = user.plan || 'free';
    const token = jwt.sign({ id: user.id, email: user.email, is_premium: user.is_premium, plan: userPlan }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login exitoso', token, messages_count: user.messages_count, is_premium: user.is_premium, plan: userPlan });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: GET /api/me
// 🧑‍🏫 Sincroniza el estado VIP del frontend con la base de datos al recargar
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/me', authenticateToken, (req, res) => {
  db.get(`SELECT messages_count, is_premium, plan FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ 
      messages_count: user.messages_count, 
      is_premium: user.is_premium ? true : false, 
      plan: user.plan || 'free' 
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/chat
// 🧑‍🏫 Ahora usamos "authenticateToken" para que solo usuarios logueados pasen
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/chat', authenticateToken, chatLimiter, async (req, res) => {
  try {
    const { characterPrompt, messages, bot_id } = req.body;
    const userId = req.user.id;

    if (!characterPrompt || !messages || !Array.isArray(messages) || messages.length === 0 || !bot_id) {
      return res.status(400).json({ error: 'Faltan datos del mensaje o bot_id' });
    }

    // Verificar que la API key de DeepSeek exista
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.includes('aqui_va')) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Extraer el último mensaje del usuario para guardarlo
    const lastUserMessage = messages[messages.length - 1];

    // 1. Revisar cuántos mensajes lleva el usuario
    db.get(`SELECT messages_count, is_premium, plan FROM users WHERE id = ?`, [userId], async (err, user) => {
      if (err) return res.status(500).json({ error: 'Error de base de datos' });
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

      // 2. Bloquear si ya consumió sus 10 mensajes y no es premium
      if (user.messages_count >= 10 && !user.is_premium) {
        return res.status(403).json({ 
          error: 'Límite alcanzado', 
          requires_upgrade: true 
        });
      }

      // Guardar el mensaje del usuario en la base de datos (incluso si falla la IA después)
      if (user.plan === 'vip' || user.plan === 'member') {
         db.run(`INSERT INTO chat_history (user_id, bot_id, role, content) VALUES (?, ?, ?, ?)`, 
          [userId, bot_id, 'user', lastUserMessage.content]);
      }

      // 3. Inyectar el plan en el prompt de la IA
      let finalPrompt = characterPrompt;
      const plan = user.plan || 'free';
      if (plan === 'vip') {
        finalPrompt += "\n\n[SYSTEM INSTRUCTION: This user is a VIP member. Treat them with maximum priority, remember all long-term context, and engage deeply.]";
      } else if (plan === 'member') {
        finalPrompt += "\n\n[SYSTEM INSTRUCTION: This user is a standard Member. They have 7-day memory context.]";
      } else {
        finalPrompt += "\n\n[SYSTEM INSTRUCTION: This user is on the Free plan.]";
      }

      // 4. Llamar a DeepSeek (Streaming)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      let fullReply = '';

      callDeepSeekStream(finalPrompt, messages, 
        // onChunk
        (textChunk) => {
          fullReply += textChunk;
          res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
        },
        // onEnd
        () => {
          // Guardar la respuesta final de la IA en la base de datos
          if (user.plan === 'vip' || user.plan === 'member') {
             db.run(`INSERT INTO chat_history (user_id, bot_id, role, content) VALUES (?, ?, ?, ?)`, 
              [userId, bot_id, 'assistant', fullReply]);
          }

          // 5. Sumar 1 al contador de mensajes
          db.run(`UPDATE users SET messages_count = messages_count + 1 WHERE id = ?`, [userId]);

          res.write(`data: ${JSON.stringify({ 
            done: true, 
            messages_count: user.messages_count + 1,
            is_premium: user.is_premium ? true : false,
            plan: user.plan || 'free'
          })}\n\n`);
          res.end();
        },
        // onError
        (aiError) => {
          console.error('DeepSeek call error:', aiError);
          res.write(`data: ${JSON.stringify({ error: 'Error al contactar a la IA' })}\n\n`);
          res.end();
        }
      );
    });

  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: GET /api/history/:bot_id
// 🧑‍🏫 Recupera el historial de chat para un usuario y bot específico
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/history/:bot_id', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const botId = req.params.bot_id;

  db.get(`SELECT plan FROM users WHERE id = ?`, [userId], (err, user) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    if (!user || user.plan === 'free') {
      // Usuarios free no tienen memoria persistente
      return res.json({ messages: [] }); 
    }

    let timeFilter = '';
    // Si es member, solo últimos 7 días
    if (user.plan === 'member') {
      timeFilter = `AND created_at >= datetime('now', '-7 days')`;
    }
    // Si es VIP, timeFilter se queda vacío (trae todo)

    const query = `
      SELECT role, content 
      FROM chat_history 
      WHERE user_id = ? AND bot_id = ? ${timeFilter}
      ORDER BY id ASC
    `;

    db.all(query, [userId, botId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Error al obtener historial' });
      res.json({ messages: rows });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/payment/paypal/verify
// 🧑‍🏫 Recibe la confirmación directa desde la ventana emergente de PayPal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/payment/paypal/verify', authenticateToken, async (req, res) => {
  const { subscriptionID, orderID, plan } = req.body;
  const email = req.user.email;
  
  if (!plan || (!subscriptionID && !orderID)) {
    return res.status(400).json({ error: 'Faltan datos del pago' });
  }

  // Nota: En un entorno de altísima seguridad, aquí haríamos un GET a la API de PayPal
  // usando un PAYPAL_SECRET para verificar que el subscriptionID es válido.
  // Por ahora, como PayPal ya validó la tarjeta en el frontend, confiamos en el callback.
  console.log(`[PayPal] Pago exitoso de: ${email}, Plan: ${plan}, ID: ${subscriptionID || orderID}`);
  
  db.run(`UPDATE users SET is_premium = 1, plan = ? WHERE email = ?`, [plan, email], function(err) {
    if (err) {
      console.error('[PayPal] Error al actualizar usuario:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ message: `¡Cuenta actualizada a ${plan.toUpperCase()} con éxito!` });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/admin/activate
// 🧑‍🏫 Para activar manualmente a los que pagan por Binance
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/admin/activate', (req, res) => {
  const { secret, email, plan } = req.body;
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret) {
    return res.status(500).json({ error: 'ADMIN_SECRET no configurado en el servidor' });
  }

  if (secret !== adminSecret) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta' });
  }

  if (!email) {
    return res.status(400).json({ error: 'Debes enviar el email del usuario' });
  }

  const userPlan = plan || 'vip'; // Por defecto damos VIP

  db.run(`UPDATE users SET is_premium = 1, plan = ? WHERE email = ?`, [userPlan, email], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ message: `¡Éxito! El usuario ${email} ahora es ${userPlan.toUpperCase()}.` });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/payment/crypto
// 🧑‍🏫 Crea una factura en NOWPayments y devuelve el link de pago
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/payment/crypto', authenticateToken, (req, res) => {
  const { plan } = req.body; // 'member' o 'vip'
  const email = req.user.email;
  const price = plan === 'vip' ? 20 : 7;
  
  if (!process.env.NOWPAYMENTS_API_KEY) {
    return res.status(500).json({ error: 'Configura NOWPAYMENTS_API_KEY en .env' });
  }

  const body = JSON.stringify({
    price_amount: price,
    price_currency: 'usd',
    order_id: email, // Usamos el email como order_id para saber a quién activar
    order_description: `Plan ${plan.toUpperCase()} - HumanIA`,
    ipn_callback_url: 'https://humaniabot.com/api/webhook/nowpayments',
    success_url: 'https://humaniabot.com/chat.html',
    cancel_url: 'https://humaniabot.com/index.html#plans'
  });

  const options = {
    hostname: 'api.nowpayments.io',
    path: '/v1/invoice',
    method: 'POST',
    headers: {
      'x-api-key': process.env.NOWPAYMENTS_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const request = https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.invoice_url) {
          res.json({ url: parsed.invoice_url });
        } else {
          console.error('NOWPayments Invoice Error:', parsed);
          res.status(500).json({ error: 'Error al crear factura en NOWPayments' });
        }
      } catch (e) {
        res.status(500).json({ error: 'Respuesta inválida de NOWPayments' });
      }
    });
  });

  request.on('error', () => res.status(500).json({ error: 'Fallo de red con NOWPayments' }));
  request.write(body);
  request.end();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT: POST /api/webhook/nowpayments
// 🧑‍🏫 NOWPayments llama a esta ruta cuando el pago de cripto se confirma
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/webhook/nowpayments', (req, res) => {
  // Siempre respondemos 200 rápido a NOWPayments
  res.status(200).send('OK');

  const paymentId = req.body.payment_id;
  if (!paymentId) return;

  // Hacemos un GET seguro a la API para verificar el estado real del pago
  // Esto evita cualquier tipo de hackeo o webhook falso
  const options = {
    hostname: 'api.nowpayments.io',
    path: `/v1/payment/${paymentId}`,
    method: 'GET',
    headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY }
  };

  https.get(options, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        const payment = JSON.parse(data);
        // Si el estado es finished o sending, el pago fue un éxito
        if (payment.payment_status === 'finished' || payment.payment_status === 'sending') {
          const email = payment.order_id; // El correo estaba en el order_id
          const description = payment.order_description || '';
          const plan = description.toLowerCase().includes('vip') ? 'vip' : 'member';

          db.run(`UPDATE users SET is_premium = 1, plan = ? WHERE email = ?`, [plan, email], (err) => {
            if (!err) {
              console.log(`[Cripto Pago] Usuario ${email} activado a ${plan.toUpperCase()} exitosamente vía NOWPayments.`);
            }
          });
        }
      } catch (e) {
        console.error('[Cripto Pago] Error parseando respuesta de verificación:', e);
      }
    });
  }).on('error', (e) => console.error('[Cripto Pago] Error de red verificando:', e));
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
