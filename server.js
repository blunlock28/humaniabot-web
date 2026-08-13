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
const https   = require('https');  // Para hacer llamadas a DeepSeek API

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
// ENDPOINT: POST /api/chat
// 🧑‍🏫 Un "endpoint" es una URL a la que el chat puede enviar datos.
//    Cuando el usuario escribe un mensaje en chat.html,
//    JavaScript hace un fetch('/api/chat') que llega aquí.
//
//    req = lo que llega del navegador (request)
//    res = lo que devolvemos al navegador (response)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/chat', async (req, res) => {
  try {
    // 🧑‍🏫 Extraemos lo que mandó el chat:
    //    - characterPrompt: la personalidad del personaje elegido
    //    - messages: el historial completo de la conversación
    const { characterPrompt, messages } = req.body;

    // Validación básica
    if (!characterPrompt || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing characterPrompt or messages' });
    }

    if (messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is empty' });
    }

    // Verificar que la API key existe
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.includes('aqui_va')) {
      return res.status(500).json({ 
        error: 'API key not configured. Edit .env file with your DeepSeek key.' 
      });
    }

    // Llamar a DeepSeek y esperar la respuesta
    const reply = await callDeepSeek(characterPrompt, messages);

    // 🧑‍🏫 res.json() envía la respuesta de vuelta al navegador como JSON
    res.json({ reply });

  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ 
      error: 'Failed to get response from AI',
      details: error.message 
    });
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
