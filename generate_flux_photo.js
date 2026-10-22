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

const DEFAULT_PROMPTS = {
  luna: "A raw, authentic 9:16 smartphone portrait of an attractive 23-year-old Asian woman named Luna with natural wavy dark hair and luminous skin. She is relaxing gracefully on white linen pillows in a dimly lit luxury bedroom at night with soft ambient lamplight, wearing an elegant silk camisole. Seductive playful gaze, direct eye contact with the camera, shallow depth of field, warm cinematic aesthetic, high detail.",
  valeria: "A raw, authentic 9:16 smartphone portrait of Valeria, a stunning 30-year-old Latina corporate businesswoman in her private executive office suite after hours at night. Dark tailored blazer loosely draped over an unbuttoned silk blouse, holding a crystal rocks glass with city skyline lights bokeh in the background. Intense confident sensual gaze directly at the camera, photorealistic 8k.",
  elena: "A raw, authentic 9:16 smartphone portrait of Elena, a captivating 27-year-old European woman with wavy auburn hair and amber eyes, curled up on an emerald velvet couch in her cozy private study late at night. Wearing a soft off-shoulder cream knit sweater, warm library lamp glow, gentle intimate smile.",
  camila: "A raw, authentic 9:16 smartphone portrait of Camila, a gorgeous 22-year-old woman with sun-kissed skin and hair in a messy cute bun, standing in a cozy apartment kitchen at midnight in soft loungewear tank and shorts, affectionate flirty smile at the camera, warm lighting.",
  dante: "A raw, authentic 9:16 smartphone portrait of Dante, a handsome 28-year-old man with sharp jawline and dark messy hair, standing on a penthouse balcony at night with an open-collar dark silk shirt and cocktail, city lights bokeh, intense charismatic smirk.",
  marcus: "A raw, authentic 9:16 smartphone portrait of Marcus, a distinguished 38-year-old billionaire mentor with short neat beard, seated in a dark leather armchair by a fireplace with sleeves rolled up, unbuttoned collar, whiskey glass, magnetic commanding presence."
};

const prompt = customPrompt || DEFAULT_PROMPTS[charId] || DEFAULT_PROMPTS.luna;
const filename = `${charId}_private_${slot}.jpg`;
const destPath = path.join(__dirname, 'assets', 'characters', filename);

async function generate() {
  console.log(`🚀 Generando foto íntima para [${charId.toUpperCase()}] usando FLUX 1.1 Pro...`);
  console.log(`📝 Prompt: "${prompt}"`);

  try {
    const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          aspect_ratio: '9:16',
          output_format: 'jpg',
          output_quality: 95,
          safety_tolerance: 5
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('❌ Error de Replicate:', res.status, errText);
      return;
    }

    let prediction = await res.json();
    console.log('⏳ Estado:', prediction.status);

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
      console.log('✅ ¡Imagen lista en FLUX 1.1 Pro!');

      const imgRes = await fetch(imageUrl);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      fs.writeFileSync(destPath, buffer);
      console.log(`💾 Guardada exitosamente en assets/characters/${filename} (${buffer.length} bytes)`);
    } else {
      console.error('❌ La generación falló:', prediction.error);
    }

  } catch (err) {
    console.error('❌ Error en ejecución:', err.message);
  }
}

generate();
