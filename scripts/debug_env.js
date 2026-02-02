require('dotenv').config({ path: '.env.local' });
const { createOpenAI } = require('@ai-sdk/openai');

const key = process.env.DEEPSEEK_API_KEY || "NOT_SET";
console.log('Loaded Key:', key.substring(0, 5) + '...' + key.substring(key.length - 4));
console.log('Key length:', key.length);

const deepseek = createOpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: key,
});

const model = deepseek("deepseek-chat");
console.log('Model provider:', model.provider);
console.log('ModelId:', model.modelId);
// Inspect internal config if possible
try {
    console.log('Model config:', JSON.stringify(model));
} catch (e) { }
