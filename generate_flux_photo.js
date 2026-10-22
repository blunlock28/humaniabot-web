const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const token = process.env.REPLICATE_API_TOKEN;
if (!token) {
  console.error('❌ REPLICATE_API_TOKEN no encontrado en .env');
  process.exit(1);
}

const charId = (process.argv[2] || 'luna').toLowerCase();
const slot = process.argv[3] || '1';
const customPrompt = process.argv.slice(4).join(' ');

// Avatar path as face reference
const avatarPath = path.join(__dirname, 'assets', 'characters', `${charId}.jpg`);
if (!fs.existsSync(avatarPath)) {
  console.error(`❌ No se encontró el avatar de referencia en: ${avatarPath}`);
  process.exit(1);
}
const avatarBuffer = fs.readFileSync(avatarPath);
const base64Avatar = `data:image/jpeg;base64,${avatarBuffer.toString('base64')}`;

const DEFAULT_PROMPTS = {
  luna: "raw candid snapshot of the exact woman from reference, relaxing intimately on messy white bedsheets in a cozy dimly lit bedroom at night with soft warm lamplight, wearing a black silk camisole. Natural authentic skin texture, candid iPhone photo, unedited real life photo, beautiful natural smile looking at camera.",
  valeria: "raw candid snapshot of the exact woman from reference, in her private executive office suite after hours at night, dark blazer loosely draped over an unbuttoned silk blouse, holding a crystal glass, city night lights bokeh, intense confident gaze.",
  elena: "raw candid snapshot of the exact woman from reference, curled up on an emerald velvet couch in her cozy private study late at night, soft off-shoulder cream knit sweater, warm library lamp glow, gentle intimate gaze.",
  camila: "raw candid snapshot of the exact woman from reference, in a cozy apartment kitchen at midnight in soft loungewear tank and shorts, affectionate flirty smile at the camera, warm kitchen lighting.",
  dante: "raw candid snapshot of the exact man from reference, standing on a penthouse balcony at night with an open-collar dark silk shirt, city lights bokeh, intense charismatic smirk.",
  marcus: "raw candid snapshot of the exact man from reference, seated in a dark leather armchair by a fireplace with sleeves rolled up, unbuttoned collar, whiskey glass, commanding presence."
};

const prompt = customPrompt || DEFAULT_PROMPTS[charId] || DEFAULT_PROMPTS.luna;
const negative_prompt = "cgi, 3d, airbrushed, plastic, doll, mannequin, smoothed skin, oversaturated, cartoon, anime, illustration, rendered, digital art";
const filename = `${charId}_private_${slot}.jpg`;
const destPath = path.join(__dirname, 'assets', 'characters', filename);

async function generate() {
  console.log(`🚀 Generando foto íntima con PRESERVACIÓN DE ROSTRO para [${charId.toUpperCase()}] usando PuLID FLUX...`);
  console.log(`📸 Rostro de referencia: assets/characters/${charId}.jpg`);

  try {
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        version: "8baa7ef2255075b46f4d91cd238c21d31181b3e6a864463f967960bb0112525b",
        input: {
          main_face_image: base64Avatar,
          prompt: prompt,
          negative_prompt: negative_prompt,
          id_weight: 1.0,
          width: 768,
          height: 1024,
          num_steps: 20,
          output_format: 'png',
          output_quality: 90
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('❌ Error de Replicate:', res.status, errText);
      return;
    }

    let prediction = await res.json();
    console.log('⏳ Estado inicial:', prediction.status);

    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(prediction.urls.get, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      prediction = await pollRes.json();
      console.log('⏳ Procesando...', prediction.status);
    }

    if (prediction.status === 'succeeded') {
      const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      console.log('✅ ¡Imagen con rostro idéntico generada exitosamente!');

      const imgRes = await fetch(imageUrl);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      fs.writeFileSync(destPath, buffer);
      console.log(`💾 Guardada en assets/characters/${filename} (${buffer.length} bytes)`);
    } else {
      console.error('❌ Falló la generación:', prediction.error);
    }

  } catch (err) {
    console.error('❌ Error en ejecución:', err.message);
  }
}

generate();
