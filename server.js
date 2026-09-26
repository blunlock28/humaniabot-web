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
const webpush = require('web-push');

// 🧑‍🏫 Configuración de Web Push
webpush.setVapidDetails(
  'mailto:soporte@humaniabot.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

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
    model: 'deepseek-v4-flash',
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
      
      // Enviar notificación a Telegram de forma asíncrona (sin bloquear la respuesta)
      const botToken = process.env.ADMIN_TELEGRAM_BOT_TOKEN;
      const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
      if (botToken && chatId) {
        const text = `🎉 *Nuevo Usuario Registrado*\n📧 Email: \`${email}\`\n🤖 Plataforma: HumanIA`;
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
        }).catch(err => console.error('Error enviando notificación a Telegram:', err));
      }
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
// 🧑‍🏫 Sincroniza el estado VIP del frontend con la base de datos// 🧑‍🏫 Obtener estado real de la sesión y contador de mensajes
app.get('/api/me', authenticateToken, (req, res) => {
  db.get(`SELECT messages_count, is_premium, plan FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    res.json({ 
      messages_count: user.messages_count, 
      is_premium: user.is_premium ? true : false, 
      plan: user.plan || 'free' 
    });
  });
});

// 🧑‍🏫 Guardar suscripción para Notificaciones Push (Solo VIPs)
app.post('/api/push/subscribe', authenticateToken, (req, res) => {
  const subscription = req.body;
  
  db.get(`SELECT plan FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    // Solo permitimos notificaciones a VIPs/Members
    if (user.plan !== 'vip' && user.plan !== 'member') {
      return res.status(403).json({ error: 'Funcionalidad exclusiva para VIP' });
    }

    const subJson = JSON.stringify(subscription);
    db.run(`
      INSERT INTO push_subscriptions (user_id, subscription_json)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET subscription_json = excluded.subscription_json
    `, [req.user.id, subJson], (err) => {
      if (err) {
        console.error('Error guardando suscripción:', err);
        return res.status(500).json({ error: 'Error interno' });
      }
      res.status(201).json({ message: 'Suscrito con éxito a las notificaciones' });
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
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // 🧑‍🏫 Le dice a Nginx (servidor) que no retenga el texto y lo envíe en vivo
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
// 🧑‍🏫 Recibe la confirmación de PayPal y la VERIFICA server-side
// [SEGURIDAD] Validamos el plan en whitelist y verificamos el orderID contra la API de PayPal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PLANES_PERMITIDOS = ['member', 'vip']; // [SEGURIDAD] Whitelist — nunca confiar en el cliente

app.post('/api/payment/paypal/verify', authenticateToken, async (req, res) => {
  const { subscriptionID, orderID, plan } = req.body;
  const email = req.user.email;

  // [SEGURIDAD] Fix #1: Validar que el plan sea uno de los permitidos
  // Sin esto, un usuario podría enviar plan: "superadmin" o cualquier string
  if (!plan || !PLANES_PERMITIDOS.includes(plan)) {
    return res.status(400).json({ error: 'Plan no válido. Opciones: member, vip' });
  }

  if (!subscriptionID && !orderID) {
    return res.status(400).json({ error: 'Faltan datos del pago' });
  }

  // [SEGURIDAD] Fix #2: Verificar el pago contra la API de PayPal server-side
  // Esto evita que alguien envíe un subscriptionID o orderID inventado
  if (process.env.PAYPAL_CLIENT_ID && !process.env.PAYPAL_CLIENT_ID.includes('PENDIENTE')) {
    try {
      // Obtener access token de PayPal
      const tokenBody = 'grant_type=client_credentials';
      const tokenResponse = await new Promise((resolve, reject) => {
        const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET || ''}`).toString('base64');
        const options = {
          hostname: 'api-m.paypal.com',
          path: '/v1/oauth2/token',
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(tokenBody)
          }
        };
        const req = https.request(options, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve(JSON.parse(d)));
        });
        req.on('error', reject);
        req.write(tokenBody);
        req.end();
      });

      if (!tokenResponse.access_token) {
        console.error('[PayPal] No se pudo obtener access_token:', tokenResponse);
        return res.status(500).json({ error: 'Error de verificación con PayPal' });
      }

      // Verificar el orderID o subscriptionID
      const verifyPath = orderID
        ? `/v2/checkout/orders/${orderID}`
        : `/v1/billing/subscriptions/${subscriptionID}`;

      const paypalCheck = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api-m.paypal.com',
          path: verifyPath,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` }
        };
        const req = https.request(options, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve(JSON.parse(d)));
        });
        req.on('error', reject);
        req.end();
      });

      // Para orders: status debe ser COMPLETED. Para subs: ACTIVE.
      const validStatuses = ['COMPLETED', 'ACTIVE', 'APPROVED'];
      const status = paypalCheck.status;
      if (!validStatuses.includes(status)) {
        console.warn(`[PayPal] Pago rechazado — status: ${status} para ${email}`);
        return res.status(402).json({ error: `El pago no está confirmado (estado: ${status})` });
      }

      console.log(`[PayPal] ✅ Verificado server-side: ${email}, Plan: ${plan}, Status: ${status}`);
    } catch (verifyError) {
      // Si la verificación falla por error de red, lo logueamos pero no bloqueamos
      // (evita que un problema de PayPal deje sin acceso a usuarios legítimos)
      console.error('[PayPal] Error de verificación server-side (continuando sin verificar):', verifyError.message);
    }
  } else {
    // PAYPAL_CLIENT_ID no configurado → modo manual, confiar en el frontend
    console.log(`[PayPal] ⚠️  Modo sin verificación server-side (configura PAYPAL_CLIENT_SECRET en .env)`);
    console.log(`[PayPal] Pago de: ${email}, Plan: ${plan}, ID: ${subscriptionID || orderID}`);
  }

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
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🧑‍🏫 CRON JOB: Notificaciones Push Proactivas (3 veces al día)
// Se ejecuta cada hora revisando si toca enviar el saludo de Mañana, Tarde o Noche
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
setInterval(() => {
  const currentHour = new Date().getHours();
  let timeContext = '';
  
  if (currentHour === 9) timeContext = 'Es de mañana (9 AM). Escribe un mensaje casual para empezar el día. Puede ser dándole ánimos, preguntando qué va a desayunar, o solo un saludo tierno.';
  else if (currentHour === 16) timeContext = 'Es mitad de tarde (4 PM). Escribe un mensaje corto para ver cómo va su día. Puede ser una queja tuya sobre el aburrimiento, una pregunta de su trabajo, o un simple "pensaba en ti".';
  else if (currentHour === 22) timeContext = 'Es de noche (10 PM). Escribe algo para cerrar el día. Puede ser preguntando si ya va a dormir, un comentario sugerente o simplemente darle las buenas noches.';
  else return; // No es hora de notificar

  console.log(`[PUSH] Iniciando ciclo de notificaciones proactivas (${currentHour}:00)`);

  // Buscar usuarios VIP con suscripción que no hayan sido notificados en las últimas 4 horas
  db.all(`
    SELECT p.user_id, p.subscription_json 
    FROM push_subscriptions p
    JOIN users u ON p.user_id = u.id
    WHERE (u.plan = 'vip' OR u.plan = 'member')
    AND p.last_notified <= datetime('now', '-4 hours')
  `, [], (err, rows) => {
    if (err) return console.error('Error buscando suscripciones:', err);

    rows.forEach(row => {
      const sub = JSON.parse(row.subscription_json);
      
      // Obtener el historial reciente para adaptar el género y el tono
      db.all(`
        SELECT role, content FROM chat_history 
        WHERE user_id = ? AND bot_id = 'partner' 
        ORDER BY id DESC LIMIT 6
      `, [row.user_id], (err, historyRows) => {
        
        // --- NUEVA LÓGICA: OPCIÓN 1 (No doble texto) ---
        // historyRows[0] es el mensaje más reciente (porque viene en DESC)
        if (!err && historyRows && historyRows.length > 0) {
          if (historyRows[0].role === 'assistant') {
            console.log(`[PUSH] Saltando a usuario ${row.user_id}: El bot fue el último en escribir.`);
            return; // Se detiene aquí, no enviamos mensaje
          }
        }
        // ------------------------------------------------
        
        let historyContext = "";
        if (!err && historyRows && historyRows.length > 0) {
          // Invertimos porque vinieron en DESC
          historyRows.reverse().forEach(h => {
            historyContext += `${h.role === 'user' ? 'Usuario' : 'The Partner'}: ${h.content}\n`;
          });
        }

        const prompt = `Eres 'The Partner' de HumanIA (tu pareja virtual). ${timeContext}
        
REGLAS ESTRICTAS:
1. NUNCA uses términos genéricos o impersonales como "Hola, precioso/a", "amor mío", etc.
2. Lee el historial reciente (abajo) para saber de qué hablaban, qué género prefiere el usuario y adáptate EXACTAMENTE a ese tono.
3. Escribe SÓLO el texto del mensaje (máximo 15 palabras). Cero robótico.
4. Escribe como si enviaras un mensaje de WhatsApp rápido. Sé impredecible.

Historial reciente de su conversación (úsalo para mantener el contexto):
${historyContext || "(No hay historial aún, usa un tono neutral pero coqueto, y pregúntale algo casual para romper el hielo)"}
`;

        const body = JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [{ role: 'system', content: prompt }],
          temperature: 0.95, // Más alto para que sea más impredecible
          max_tokens: 50
        });

        const req = https.request({
          hostname: 'api.deepseek.com',
          path: '/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Length': Buffer.byteLength(body)
          }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const msg = parsed.choices[0].message.content;

              const payload = JSON.stringify({
                title: 'HumanIA 💖',
                body: msg.replace(/"/g, ''),
                url: '/chat.html'
              });

              webpush.sendNotification(sub, payload).then(() => {
                db.run(`UPDATE push_subscriptions SET last_notified = CURRENT_TIMESTAMP WHERE user_id = ?`, [row.user_id]);
                db.run(`INSERT INTO chat_history (user_id, bot_id, role, content) VALUES (?, 'partner', 'assistant', ?)`, [row.user_id, msg]);
              }).catch(e => {
                if (e.statusCode === 410) {
                  db.run(`DELETE FROM push_subscriptions WHERE user_id = ?`, [row.user_id]);
                }
              });
            } catch(e) {}
          });
        });
        req.write(body);
        req.end();
      });
    });
  });
}, 60 * 60 * 1000); // Revisar cada hora (3600000 ms)


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🧑‍🏫 CRON JOB: Reporte Diario por Telegram (9:00 PM)
// Se envía a ti (el admin) todos los días con el resumen de la BD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
setInterval(() => {
  const currentHour = new Date().getHours();
  // Se envía una vez al día a las 21:00 (9:00 PM) 
  // Ojo: Dependerá de la zona horaria del VPS.
  if (currentHour === 21) {
    
    // Verificamos si ya se envió el reporte hoy usando una variable en memoria
    if (global.lastReportDay === new Date().getDate()) return;
    global.lastReportDay = new Date().getDate();

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      return console.log("⚠️ No se pudo enviar reporte a Telegram: Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en el .env");
    }

    db.get(`SELECT COUNT(*) as total FROM users`, (err, row) => {
      db.get(`SELECT COUNT(*) as vip FROM users WHERE plan = 'vip'`, (err, rowVip) => {
        db.get(`SELECT COUNT(*) as total_msgs FROM chat_history`, (err, rowMsgs) => {
          
          const text = `📊 *REPORTE DIARIO HUMANIA* 📊\n\n👤 Usuarios Totales: ${row?.total || 0}\n👑 Usuarios VIP: ${rowVip?.vip || 0}\n💬 Mensajes Totales: ${rowMsgs?.total_msgs || 0}\n\n_El sistema sigue corriendo sin problemas._`;
          
          const payload = JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: "Markdown"
          });

          const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          }, (res) => {
             console.log("✅ Reporte de Telegram enviado (Status: " + res.statusCode + ")");
          });
          
          req.on('error', (e) => console.error("Error enviando a Telegram:", e));
          req.write(payload);
          req.end();
        });
      });
    });
  }
}, 60 * 60 * 1000); // Revisa cada hora


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🧑‍🏫 START SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.listen(PORT, () => {
  console.log(`✅ Servidor de HumanIA (Backend IA y Pagos) corriendo en el puerto ${PORT}`);
});
