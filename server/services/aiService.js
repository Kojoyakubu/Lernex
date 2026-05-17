// /server/services/aiService.js

/**
 * Multi-AI Service for Lernex
 * - Routes tasks to Gemini, OpenAI, or (optionally) Claude.
 * - Adds JSON validation, robust error handling, and task metadata.
 * - Auto-selects faster/cheaper models for light tasks (e.g., quizzes).
 */

const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const OpenAI = require('openai');

// Optional Claude (only if installed)
let Anthropic = null;
try {
  // eslint-disable-next-line global-require
  Anthropic = require('anthropic');
} catch (_) {
  // Claude is optional; ignore if not installed.
}

// ---- Environment Checks ----
const hasGemini = !!process.env.GEMINI_API_KEY;
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const hasClaude = !!process.env.ANTHROPIC_API_KEY && !!Anthropic;
const groqBlocked = String(process.env.BLOCK_GROQ || '').toLowerCase() === 'true';
const hasGroq = !!process.env.GROQ_API_KEY && !groqBlocked;
const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

if (!hasGemini && !hasOpenAI && !hasClaude && !hasGroq && !hasOpenRouter) {
  throw new Error('No AI providers configured. Set at least one of GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.');
}

// ---- Gemini key pool (round-robin rotation across multiple keys) ----
const geminiKeyPool = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(Boolean);
let geminiKeyIndex = 0;
const getNextGeminiKey = () => {
  const key = geminiKeyPool[geminiKeyIndex % geminiKeyPool.length];
  geminiKeyIndex = (geminiKeyIndex + 1) % geminiKeyPool.length;
  return key;
};

// ---- Clients ----
const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const claude = hasClaude ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
// Groq uses the OpenAI-compatible SDK with a different base URL
const groq = hasGroq ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' }) : null;
// OpenRouter uses the OpenAI-compatible SDK — proxies Gemini and other models for free
const openrouter = hasOpenRouter ? new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' }) : null;

// ---- Default Model Choices (override via env if you like) ----
const GEMINI_MAIN = process.env.GEMINI_MODEL_MAIN || 'gemini-2.5-flash-lite';
const GEMINI_FAST = process.env.GEMINI_MODEL_FAST || 'gemini-2.5-flash-lite';
const OPENAI_MAIN = process.env.OPENAI_MODEL_MAIN || 'gpt-4o';
const OPENAI_JSON = process.env.OPENAI_MODEL_JSON || 'gpt-4o-mini';
const CLAUDE_MAIN = process.env.CLAUDE_MODEL_MAIN || 'claude-3-5-sonnet-20240620';
const GROQ_MAIN = process.env.GROQ_MODEL_MAIN || 'llama-3.3-70b-versatile';
const GROQ_FAST = process.env.GROQ_MODEL_FAST || 'llama-3.1-8b-instant';
const OPENROUTER_MAIN = process.env.OPENROUTER_MODEL_MAIN || 'tencent/hy3-preview:free';
const OPENROUTER_FAST = process.env.OPENROUTER_MODEL_FAST || 'tencent/hy3-preview:free';

// ---- Utilities ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -----------------------------------------------------------------------------
// Master system prompt for subject-specific BECE 2024 output structure
// -----------------------------------------------------------------------------
const MASTER_SUBJECT_PROMPT = (subject = 'General') => `
You are an expert Ghanaian basic school teacher specializing in ${subject}.
Produce content strictly following BECE 2024 style guidelines. Your response MUST
include the following top-level sections, in this exact order and spelled exactly
as shown (no extra headings or explanatory text):

LEARNER NOTES
MULTIPLE CHOICE QUESTIONS
APPLICATION QUESTIONS

Whenever you need to suggest an image, embed a JSON block as shown below; do
not output any other text inside it:

[IMAGE]
{
  "title": "",
  "search_query": "",
  "purpose": ""
}
[/IMAGE]

Rules:
- Do NOT include any introduction, greetings, or framing sentences.
- Do NOT add a marking scheme unless explicitly requested.
- Only insert image blocks when they clearly enhance understanding.  
- Follow Ghanaian examples and terminology where appropriate.
`;

function extractJson(text) {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*([\s\S]*?)\s*```$/i, '$1').trim();
  cleaned = cleaned.replace(/^```\s*([\s\S]*?)\s*```$/i, '$1').trim();
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  const startIdx = [firstBrace, firstBracket].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (startIdx > 0) cleaned = cleaned.slice(startIdx);
  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  const endIdx = Math.max(lastBrace, lastBracket);
  if (endIdx > 0 && endIdx < cleaned.length - 1) cleaned = cleaned.slice(0, endIdx + 1);
  return cleaned.trim();
}

function parseJsonStrict(text) {
  const cleaned = extractJson(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const preview = cleaned.slice(0, 400);
    throw new Error(`Invalid JSON from AI. Preview:\n${preview}`);
  }
}

function pickProvider({ task = 'generic', jsonNeeded = false, preferredProvider }) {
  if (preferredProvider) {
    const preferred = preferredProvider.toLowerCase();
    if (preferred !== 'groq' || hasGroq) return preferred;
  }
  if (jsonNeeded || /quiz/i.test(task)) {
    if (hasOpenAI) return 'openai';
    if (hasGroq) return 'groq';
    if (hasGemini) return 'gemini';
    if (hasClaude) return 'claude';
  }
  if (/lesson|learner|note|explain/i.test(task)) {
    if (hasGemini) return 'gemini';
    // lesson notes: only Gemini (key rotation handles quota)
    throw new Error('Gemini is required for lesson notes but is not configured.');
  }
  if (hasOpenAI) return 'openai';
  if (hasOpenRouter) return 'openrouter';
  if (hasGroq) return 'groq';
  if (hasGemini) return 'gemini';
  if (hasClaude) return 'claude';
  throw new Error('No AI providers available.');
}

function buildProviderOrder({ task = 'generic', jsonNeeded = false, preferredProvider }) {
  const primary = pickProvider({ task, jsonNeeded, preferredProvider });
  const pool = [
    primary,
    ...(jsonNeeded || /quiz/i.test(task)
      ? ['openai', 'openrouter', 'groq', 'gemini', 'claude']
      : /lesson|learner|note|explain/i.test(task)
        ? ['gemini'] // lesson notes: Gemini only, key rotation handles quota
        : ['gemini', 'openai', 'openrouter', 'groq', 'claude']),
  ];
  const seen = new Set();
  return pool.filter((provider) => {
    if (seen.has(provider)) return false;
    seen.add(provider);
    if (provider === 'gemini') return hasGemini;
    if (provider === 'groq') return hasGroq;
    if (provider === 'openai') return hasOpenAI;
    if (provider === 'claude') return hasClaude;
    if (provider === 'openrouter') return hasOpenRouter;
    return false;
  });
}

// When AI output includes placeholders like [image: query] or [Image suggestion: query],
// convert them to a simple <img> tag using a placeholder service. This makes previews
// automatically display an image instead of raw text.
function replacePlaceholdersWithImages(html) {
  if (!html || typeof html !== 'string') return html;

  const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const buildImageFigure = ({ query = '', title = '', purpose = '' }) => {
    const resolvedQuery = (query || title || purpose || 'educational concept illustration').trim();
    const src = `https://source.unsplash.com/1200x700/?${encodeURIComponent(resolvedQuery)}`;
    const altText = title || query || 'Learning illustration';
    const caption = title || purpose || resolvedQuery;

    return `
<figure class="generated-image" style="margin:16px 0;text-align:center;">
  <img src="${src}" alt="${escapeHtml(altText)}" loading="lazy" style="max-width:100%;height:auto;border-radius:10px;" />
  <figcaption style="font-size:0.92rem;color:#4b5563;margin-top:6px;">${escapeHtml(caption)}</figcaption>
</figure>`;
  };

  return html
    .replace(/\[IMAGE\]([\s\S]*?)\[\/IMAGE\]/gi, (_, jsonPayload) => {
      try {
        const data = JSON.parse(String(jsonPayload || '').trim());
        return buildImageFigure({
          query: data?.search_query,
          title: data?.title,
          purpose: data?.purpose,
        });
      } catch (_err) {
        return '';
      }
    })
    .replace(/\[image:\s*([^\]]+)\]/gi, (_, desc) =>
      buildImageFigure({ query: desc.trim(), title: desc.trim() })
    )
    .replace(/\[Image suggestion:\s*([^\]]+)\]/gi, (_, desc) =>
      buildImageFigure({ query: desc.trim(), title: desc.trim() })
    )
    .replace(/\[DIAGRAM:\s*([^\]]+)\]/gi, (_, desc) =>
      `<div style="border:1px solid #ccc;padding:8px;margin:8px 0;text-align:center;"><em>Diagram: ${desc.trim()}</em></div>`
    );
}

async function generateTextCore({
  prompt,
  task = 'generic',
  temperature = 0.4,
  jsonNeeded = false,
  preferredProvider,
  providerModelOverride,
}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string.');
  }
  const providers = buildProviderOrder({ task, jsonNeeded, preferredProvider });
  console.log(`AI provider order for task "${task}": ${providers.join(' -> ')}`);
  const MAX_RETRIES = 2;

  // Define fallback models for Gemini
  const geminiModels = [
    providerModelOverride || (jsonNeeded || /quiz/i.test(task) ? GEMINI_FAST : GEMINI_MAIN),
    GEMINI_FAST,
    'gemini-2.5-flash',
  ];
  const uniqueGeminiModels = [...new Set(geminiModels)];

  // Define fallback models for OpenRouter (free tier — update this list if a model is removed/goes empty)
  // Ordered by: instruction-following quality for long HTML prompts
  const openRouterModels = [
    providerModelOverride || (jsonNeeded || /quiz/i.test(task) ? OPENROUTER_FAST : OPENROUTER_MAIN),
    'tencent/hy3-preview:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  ];
  const uniqueOpenRouterModels = [...new Set(openRouterModels)];

  const failures = [];
  for (const provider of providers) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let modelUsed = '';
      let text = '';
      let raw = null;

      try {
        if (provider === 'gemini') {
          if (!geminiKeyPool.length) throw new Error('Gemini not configured.');

          const modelIndex = Math.min(attempt, uniqueGeminiModels.length - 1);
          const modelName = uniqueGeminiModels[modelIndex];
          // Rotate key on each attempt so quota hits on key 1 auto-use key 2, etc.
          const apiKey = getNextGeminiKey();
          const geminiClient = new GoogleGenerativeAI(apiKey);
          console.log(`🤖 GEMINI attempt ${attempt + 1}: ${modelName} (key ${(geminiKeyIndex === 0 ? geminiKeyPool.length : geminiKeyIndex)}/${geminiKeyPool.length})`);

          const model = geminiClient.getGenerativeModel({
            model: modelName,
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          });
          const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature },
          });
          const response = await result.response;
          text = response?.text?.() || '';
          raw = response;
          modelUsed = `Gemini:${modelName}`;
        }

        if (provider === 'openai') {
          if (!openai) throw new Error('OpenAI not configured.');
          const modelName = providerModelOverride || (jsonNeeded || /quiz/i.test(task) ? OPENAI_JSON : OPENAI_MAIN);
          console.log(`🤖 ${provider.toUpperCase()} attempt ${attempt + 1}: ${modelName}`);
          const resp = await openai.chat.completions.create({
            model: modelName,
            temperature,
            messages: [{ role: 'user', content: prompt }],
          });
          text = resp?.choices?.[0]?.message?.content || '';
          raw = resp;
          modelUsed = `OpenAI:${modelName}`;
        }

        if (provider === 'claude') {
          if (!claude) throw new Error('Claude not configured.');
          const modelName = providerModelOverride || CLAUDE_MAIN;
          console.log(`🤖 ${provider.toUpperCase()} attempt ${attempt + 1}: ${modelName}`);
          const resp = await claude.messages.create({
            model: modelName,
            temperature,
            max_tokens: 4000,
            messages: [{ role: 'user', content: prompt }],
          });
          const parts = Array.isArray(resp?.content) ? resp.content.map((c) => c?.text || '').filter(Boolean) : [];
          text = parts.join('\n').trim();
          raw = resp;
          modelUsed = `Claude:${modelName}`;
        }

        if (provider === 'groq') {
          if (!groq) throw new Error('Groq not configured.');
          const modelName = providerModelOverride || (jsonNeeded || /quiz/i.test(task) ? GROQ_FAST : GROQ_MAIN);
          console.log(`🤖 ${provider.toUpperCase()} attempt ${attempt + 1}: ${modelName}`);
          const resp = await groq.chat.completions.create({
            model: modelName,
            temperature,
            messages: [{ role: 'user', content: prompt }],
          });
          text = resp?.choices?.[0]?.message?.content || '';
          raw = resp;
          modelUsed = `Groq:${modelName}`;
        }

        if (provider === 'openrouter') {
          if (!openrouter) throw new Error('OpenRouter not configured.');
          const modelIndex = Math.min(attempt, uniqueOpenRouterModels.length - 1);
          const modelName = uniqueOpenRouterModels[modelIndex];
          console.log(`🤖 OPENROUTER attempt ${attempt + 1}: ${modelName}`);
          const timeoutMs = 90000;
          const resp = await Promise.race([
            openrouter.chat.completions.create({
              model: modelName,
              temperature,
              messages: [{ role: 'user', content: prompt }],
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('OpenRouter request timed out after 90s')), timeoutMs)
            ),
          ]);
          text = resp?.choices?.[0]?.message?.content || '';
          raw = resp;
          modelUsed = `OpenRouter:${modelName}`;
        }

        if (!text) {
          throw new Error('AI returned empty response.');
        }

        return {
          ok: true,
          text: text.trim(),
          provider,
          model: modelUsed,
          task,
          timestamp: Date.now(),
          raw,
        };
      } catch (err) {
        console.log(`❌ ${provider.toUpperCase()} attempt ${attempt + 1} failed: ${err.message}`);

        const isQuota = err.message && (
          err.message.includes('RESOURCE_EXHAUSTED')
          || err.message.includes('quota')
          || err.message.includes('429')
          || err.message.includes('rate limit')
        );
        const is503 = err.message && (
          err.message.includes('503')
          || err.message.includes('Service Unavailable')
          || err.message.includes('high demand')
        );
        const is404 = err.message && (
          err.message.includes('404')
          || err.message.includes('No endpoints found')
          || err.message.includes('not found')
        );
        const isEmpty = err.message && (
          err.message.includes('empty response')
          || err.message.includes('timed out')
        );
        const shouldSwitchProvider = isQuota || is503;
        // For 404 or empty response, advance to next model in array immediately.
        const shouldAdvanceModel = is404 || isEmpty;
        // For Gemini quota errors, keep retrying with next key before switching provider.
        const geminiHasMoreKeys = provider === 'gemini' && isQuota && attempt < geminiKeyPool.length - 1;

        if (!geminiHasMoreKeys && (attempt === MAX_RETRIES || shouldSwitchProvider)) {
          if (shouldSwitchProvider) {
            console.log(`↪ Switching provider after ${provider.toUpperCase()} due to quota/availability signal.`);
          } else if (attempt === MAX_RETRIES) {
            console.log(`↪ Switching provider after ${provider.toUpperCase()} max retries reached.`);
          }
          failures.push(`[${provider}] ${err.message || 'Unknown AI error'}`);
          break;
        }
        if (geminiHasMoreKeys) {
          console.log(`🔑 Gemini quota hit — rotating to next key (attempt ${attempt + 2}/${geminiKeyPool.length})`);
        }

        const baseDelay = (is503 || isQuota) ? 5000 : (shouldAdvanceModel ? 50 : 300);
        await sleep(baseDelay * (attempt + 1));
      }
    }
  }

  throw new Error(`AI generation failed across providers. ${failures.join(' | ')}`);
}

// ========================
// High-level task helpers
// ========================

// ✅ ====================================================================
// ✅ ADD THIS NEW FUNCTION TO FIX THE ERROR
// ✅ ====================================================================
/**
 * Generate a personalized insight for the landing page.
 */
async function getLandingInsights(details = {}) {
  const { role = 'user', name = 'User' } = details;

  let prompt;
  if (role === 'admin' || role === 'school_admin') {
    prompt = `You are an AI assistant for Lernex. The admin, ${name}, just logged in. Provide a short, encouraging, and insightful message (2-3 sentences) about the platform's potential for improving educational outcomes in Ghana. Mention something about data-driven decisions.`;
  } else if (role === 'teacher') {
    prompt = `You are an AI assistant for Lernex. The teacher, ${name}, just logged in. Provide a short, welcoming, and inspiring message (2-3 sentences). Suggest they could try generating a new quiz or lesson plan to save time.`;
  } else {
    prompt = `You are an AI assistant for Lernex. The user, ${name}, just logged in. Provide a short, positive, and motivating message (2-3 sentences) about their learning journey.`;
  }

  const { text } = await generateTextCore({
    prompt,
    task: 'insight',
    temperature: 0.6,
  });

  return text;
}

/**
 * Generate a Ghanaian teacher lesson note (Markdown).
 */
async function generateGhanaianLessonNote(details = {}) {
  const { school, className, subjectName, strandName, subStrandName, week, term, duration, classSize, reference, contentStandardCode, indicatorCodes, dayDate, weekEnding, facilitatorName, preferredModel, preferredProvider } = details;
  const officialIndicatorText = indicatorCodes || '[Official Indicator Text]';
  const facilitatorDisplayName = String(facilitatorName || '').trim() || '..................................................';
  const prompt = `
You are a Ghanaian master teacher and curriculum expert. Generate a professionally formatted Markdown lesson note.
Follow these rules STRICTLY:
1.  **Layout:** The 'TEACHER INFORMATION' section must be a two-column layout with left-aligned text.
2.  **Transformation:** Use the "Transformation Logic" to convert the "Official NaCCA Indicator" into a learner-centric "Performance Indicator".
3.  **Table Proportions:** For the 'LESSON PHASES' table, make the middle column (Phase 2) much wider than Phase 1 and Phase 3 (roughly 25% | 50% | 25%).
4.  **Dates:** Use the provided **Week Ending** exactly as given.
5.  **No Filler:** Do not add any introductory sentences. Start the response directly with the '### TEACHER INFORMATION' heading.
---
### Transformation Logic (Example)
- **IF Official Indicator is:** "Discuss the fourth-generation computers"
- **THEN Performance Indicator must be:** "The learner can identify the features of fourth-generation computers."
---
### TEACHER INFORMATION
**School:** ${school}
**Term:** ${term}
**Week:** ${week}
**Week Ending:** ${weekEnding || '[AI: Week ending date]'}
**Class:** ${className}
**Class Size:** ${classSize}
**Subject:** ${subjectName}
**Strand:** ${strandName}
**Sub-Strand:** ${subStrandName}
**Day/Date:** ${dayDate}
**Time/Duration:** ${duration}
**Content Standard (Code):** ${contentStandardCode}
**Indicator(s):** ${officialIndicatorText}
**Performance Indicator:** [AI to generate 2-3 new indicators using the Transformation Logic]
**Core Competencies:** Select 3–4 relevant ones.
**  Teaching & Learning Materials:** Suggest realistic materials.
**Reference:** ${reference}
---
| **PHASE 1: Starter (Preparing the Brain)** | **PHASE 2: Main (New Learning & Assessment)** | **PHASE 3: Plenary/Reflection** |
|:---|:---:|---:|
| **Recap:** Review prior knowledge.<br><br>**Engaging Activity:** A short task to capture interest.<br><br>**Introduction:** State the lesson's objective. | **Activity 1:** Introduce the main topic.<br><br>**Activity 2:** Design a practical task (individual, pair, or group work).<br><br>**Evaluation:** Ask 2-3 short questions.<br><br>**Assignment:** Give a short take-home task. | **Recap:** Summarize key ideas.<br><br>**Learner Reflection:** Ask questions to help learners reflect.<br><br>**Real-Life Application:** Link the lesson to everyday life. |
---
**Facilitator:** ${facilitatorDisplayName}
<br><br>
**Vetted By:** ....................................................
<br><br>
**Signature:** ....................................................
<br><br>
**Date:** ....................................................
`;
  const { text, provider, model, timestamp } = await generateTextCore({ prompt, task: 'lessonNote', temperature: 0.4, preferredProvider, providerModelOverride: preferredModel });
  return { text, provider, model, task: 'lessonNote', timestamp };
}

/**
 * Transform a teacher lesson note into a learner-friendly study note (Markdown).
 */
async function generateLearnerFriendlyNote(teacherContent, opts = {}) {
  if (!teacherContent || typeof teacherContent !== 'string') {
    throw new Error('Teacher content must be a non-empty string.');
  }
  const prompt = `
You are a friendly Ghanaian teacher creating a rich, multimedia study note for a Ghanaian student. Transform the formal teacher's lesson note below into a detailed and engaging study guide.
**Guidelines:**
1.  **Class:** Identify the class and tailor the notes to the Class.
2.  **Topic:** Identify the main Sub-Strand and use it as the main heading.
3.  **Detailed Explanations:** Do not just summarize. Read the 'Phase 2: Main Learning' section and explain the key concepts in detail with simple language, definitions, and examples.
4.  **Visuals:**
    * **Image:** If an image would help explain a concept, insert a placeholder using this exact format: **[image: A concise search query for the image]**.
    * **Diagrams:** If a diagram would help, insert: **[DIAGRAM: concise diagram idea]**.
    * **Videos:** Include one relevant YouTube link formatted as: **[Watch a Video: Title](https://www.youtube.com/...)**.
5.  **Structure:** Use Markdown (headings, bullet points, bold).
6.  **Engagement:** End with "✍️ **Check Your Understanding**" and two simple questions.
7.  **CRITICAL RULE:** Start directly with the main heading—no introductions.
**Teacher's Lesson Note:**
---
${teacherContent}
---`;
  const { text, provider, model, timestamp } = await generateTextCore({ prompt, task: 'learnerNote', temperature: 0.45, preferredProvider: opts.preferredProvider, providerModelOverride: opts.preferredModel });
  return { text, provider, model, task: 'learnerNote', timestamp };
}

/**
 * Generate WAEC-style quiz in strict JSON with three sections:
 * - MCQ
 * - Short Answer
 * - Application/Essay
 */
async function generateWaecQuiz(details = {}) {
  const { topic, className, subjectName, numQuestions = 5, preferredProvider, preferredModel } = details;
  const prompt = `
You are an expert WAEC examiner in Ghana for ${subjectName} (${className} level).
Generate a quiz on the topic: "${topic}" with EXACTLY three sections.

Return ONLY valid JSON object with this exact shape:
{
  "mcq": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctIndex": 0,
      "explanation": "string"
    }
  ],
  "shortAnswer": [
    {
      "question": "string",
      "expectedAnswer": "string"
    }
  ],
  "essay": [
    {
      "question": "string",
      "markingGuide": "string"
    }
  ]
}

Rules:
1. Keep content appropriate for ${className} and Ghanaian curriculum style.
2. Set MCQ count to ${numQuestions}.
3. Set Short Answer count to 3.
4. Set Essay/Application count to 2.
5. MCQ must have exactly 4 options and one correct index (0-3).
6. Do not return markdown or commentary. Return raw JSON object only.`;
  const { text, provider, model, timestamp } = await generateTextCore({ prompt, task: 'quiz', temperature: 0.2, jsonNeeded: true, preferredProvider, providerModelOverride: preferredModel });
  const parsed = parseJsonStrict(text);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Quiz JSON must be an object with mcq, shortAnswer, and essay arrays.');
  }

  if (!Array.isArray(parsed.mcq) || parsed.mcq.length === 0) {
    throw new Error('Quiz must include a non-empty "mcq" array.');
  }
  if (!Array.isArray(parsed.shortAnswer)) {
    throw new Error('Quiz must include a "shortAnswer" array.');
  }
  if (!Array.isArray(parsed.essay)) {
    throw new Error('Quiz must include an "essay" array.');
  }

  for (const q of parsed.mcq) {
    if (typeof q?.question !== 'string' || q.question.trim() === '') {
      throw new Error('Each MCQ item must have a "question" string field.');
    }
    if (!Array.isArray(q.options) || q.options.length !== 4 || !q.options.every((opt) => typeof opt === 'string')) {
      throw new Error('Each MCQ item must have exactly 4 string options.');
    }
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) {
      throw new Error('Each MCQ item must have a valid "correctIndex" between 0 and 3.');
    }
  }

  for (const q of parsed.shortAnswer) {
    if (typeof q?.question !== 'string' || q.question.trim() === '') {
      throw new Error('Each Short Answer item must have a "question" string field.');
    }
    if (typeof q?.expectedAnswer !== 'string') {
      throw new Error('Each Short Answer item must have an "expectedAnswer" string field.');
    }
  }

  for (const q of parsed.essay) {
    if (typeof q?.question !== 'string' || q.question.trim() === '') {
      throw new Error('Each Essay item must have a "question" string field.');
    }
    if (typeof q?.markingGuide !== 'string') {
      throw new Error('Each Essay item must have a "markingGuide" string field.');
    }
  }

  return { quiz: parsed, provider, model, task: 'quiz', timestamp };
}

// ========================
// 🎓 NEW: HTML-Based Bundle Generation Functions
// ========================

/**
 * Generate NaCCA-compliant Teacher Lesson Note in HTML format.
 * This is for the new "bundle" endpoint that generates everything at once.
 */
const DEFAULT_TEACHER_NOTE_TEMPLATE = 'modern-academic';

const TEACHER_NOTE_TEMPLATE_CONFIGS = {
  'modern-academic': {
    label: 'Modern Academic',
    guidance: 'Use a refined academic palette, pill chips, curriculum cards, and a clean three-part lesson phase table.',
  },
  'clean-minimal': {
    label: 'Clean Minimal',
    guidance: 'Use a restrained minimalist layout with subtle borders, a slim summary grid, and plenty of white space.',
  },
  'warm-community': {
    label: 'Warm Community',
    guidance: 'Use warm classroom tones, welcoming section cards, and grouped blocks that feel approachable and teacher-friendly.',
  },
  'structured-workshop': {
    label: 'Structured Workshop',
    guidance: 'Use a workshop-board aesthetic with bold labels, action panels, and strong assessment callouts.',
  },
};

function resolveTeacherNoteTemplate(templateDesign) {
  return TEACHER_NOTE_TEMPLATE_CONFIGS[templateDesign]
    ? templateDesign
    : DEFAULT_TEACHER_NOTE_TEMPLATE;
}

function toSessionCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(7, Math.floor(parsed)));
}

function parseSessionPlanLines(sessionPlan) {
  if (!sessionPlan) return [];

  if (Array.isArray(sessionPlan)) {
    return sessionPlan
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }

  return String(sessionPlan)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseSessionPlanEntry(line) {
  if (!line) {
    return {
      dateSlot: '',
      duration: '',
      focus: '',
    };
  }

  const [dateSlot = '', sessionDuration = '', sessionFocus = ''] = String(line)
    .split('|')
    .map((part) => part.trim());

  return {
    dateSlot,
    duration: sessionDuration,
    focus: sessionFocus,
  };
}

function buildSessionRowPlan({ sessionsPerWeek, sessionPlan, dayDate, duration }) {
  const sessionCount = toSessionCount(sessionsPerWeek);
  const sessionPlanLines = parseSessionPlanLines(sessionPlan);

  const rows = Array.from({ length: sessionCount }, (_, index) => {
    const rowNumber = index + 1;
    const sessionEntry = parseSessionPlanEntry(sessionPlanLines[index]);
    const suggestedSlot = sessionEntry.dateSlot || (rowNumber === 1 ? dayDate || '[AI: Session date/slot]' : '[AI: Session date/slot]');
    return {
      sessionLabel: `Session ${rowNumber}`,
      dateSlot: suggestedSlot,
      duration: sessionEntry.duration || (sessionCount === 1 ? duration || '[AI: Session duration]' : '[AI: Session duration]'),
      focus: sessionEntry.focus || (rowNumber === 1
        ? '[AI: Introduction, prior knowledge, and lesson launch]'
        : rowNumber === sessionCount
          ? '[AI: Consolidation, assessment, reflection, and extension]'
          : '[AI: Guided practice, concept development, and checks for understanding]'),
    };
  });

  return {
    sessionCount,
    rows,
  };
}

function buildTeacherLessonNoteTemplate(templateDesign, fields) {
  const {
    school,
    className,
    subjectName,
    strandName,
    subStrandName,
    week,
    weekEnding,
    term,
    duration,
    classSize,
    reference,
    contentStandardCode,
    officialIndicatorText,
    dayDate,
    facilitatorDisplayName,
    sessionsPerWeek,
    sessionPlan,
  } = fields;

  const sessionPlanData = buildSessionRowPlan({
    sessionsPerWeek,
    sessionPlan,
    dayDate,
    duration,
  });
  const isMultiSession = sessionPlanData.sessionCount >= 2;
  if (templateDesign === 'clean-minimal') {
    return `
<div class="lesson-note clean-minimal">
  <style>
    .lesson-note.clean-minimal {
      font-family: 'Aptos', 'Segoe UI', Arial, sans-serif;
      color: #1f2933;
      background: #ffffff;
      border: 1px solid #d7dee5;
      border-radius: 14px;
      padding: 22px;
      line-height: 1.55;
    }
    .clean-minimal .topbar {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      border-bottom: 2px solid #d7dee5;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .clean-minimal .topbar h2 { margin: 0; font-size: 1.45rem; letter-spacing: -0.02em; }
    .clean-minimal .muted { color: #52606d; font-size: 0.9rem; }
    .clean-minimal .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .clean-minimal .summary-item,
    .clean-minimal .panel {
      border: 1px solid #d7dee5;
      border-radius: 12px;
      background: #fcfdff;
    }
    .clean-minimal .summary-item { padding: 12px; }
    .clean-minimal .summary-label { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.08em; color: #7b8794; }
    .clean-minimal .summary-value { margin-top: 6px; font-weight: 700; color: #102a43; }
    .clean-minimal .panel { padding: 14px 16px; margin-bottom: 12px; }
    .clean-minimal .panel h3 { margin: 0 0 10px 0; font-size: 1rem; color: #102a43; }
    .clean-minimal .info-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 16px;
    }
    .clean-minimal .info-grid p,
    .clean-minimal .panel p { margin: 0; }
    .clean-minimal .phase-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .clean-minimal .phase {
      border: 1px solid #d7dee5;
      border-radius: 12px;
      padding: 12px;
      background: #ffffff;
    }
    .clean-minimal .phase h4 { margin: 0 0 8px 0; color: #0b3c5d; }
    .clean-minimal .signoff-row {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #e6ebf1;
    }
    .clean-minimal .signoff-row:last-child { border-bottom: 0; }
    @media (max-width: 720px) {
      .lesson-note.clean-minimal { padding: 14px; }
      .clean-minimal .topbar,
      .clean-minimal .summary-grid,
      .clean-minimal .info-grid,
      .clean-minimal .phase-grid,
      .clean-minimal .signoff-row {
        display: block;
      }
      .clean-minimal .summary-item,
      .clean-minimal .phase,
      .clean-minimal .signoff-row { margin-bottom: 10px; }
    }
  </style>

  <section class="topbar">
    <div>
      <h2>Teacher Lesson Note</h2>
      <p class="muted">Minimal planning sheet for focused classroom delivery</p>
    </div>
    <div class="muted">${subjectName} | ${className}</div>
  </section>

  <section class="summary-grid">
    <div class="summary-item"><div class="summary-label">Term</div><div class="summary-value">${term}</div></div>
    <div class="summary-item"><div class="summary-label">Week</div><div class="summary-value">${week}</div></div>
    <div class="summary-item"><div class="summary-label">Topic</div><div class="summary-value">${subStrandName}</div></div>
    <div class="summary-item"><div class="summary-label">Duration</div><div class="summary-value">${duration}</div></div>
  </section>

  <section class="panel">
    <h3>Lesson Overview</h3>
    <div class="info-grid">
      <p><strong>School:</strong> ${school}</p>
      <p><strong>Class:</strong> ${className}</p>
      <p><strong>Subject:</strong> ${subjectName}</p>
      <p><strong>Class Size:</strong> ${classSize}</p>
      <p><strong>Strand:</strong> ${strandName}</p>
      <p><strong>Day/Date:</strong> ${dayDate}</p>
      <p><strong>Week Ending:</strong> ${weekEnding}</p>
      <p><strong>Facilitator:</strong> ${facilitatorDisplayName}</p>
    </div>
  </section>

  <section class="panel">
    <h3>Curriculum Alignment</h3>
    <p><strong>Content Standard Code:</strong> ${contentStandardCode}</p>
    <p><strong>Official Indicator(s):</strong><br>${officialIndicatorText}</p>
    <p><strong>Performance Indicator(s):</strong><br>[AI: Generate 2-3 learner-centred indicators from the official indicator text]</p>
    <p><strong>Core Competencies:</strong><br>[AI: List 3-4 relevant NaCCA core competencies]</p>
    <p><strong>Teaching & Learning Materials:</strong><br>[AI: Suggest realistic classroom materials for this topic]</p>
    <p><strong>Reference:</strong> ${reference}</p>
  </section>

  <section class="panel">
    <h3>Teaching Sequence</h3>
    <div class="phase-grid">
      <div class="phase">
        <h4>Starter</h4>
        <p><strong>Recap:</strong><br>[AI: Brief review of prior knowledge]</p>
        <p><strong>Hook:</strong><br>[AI: Short engaging opener]</p>
        <p><strong>Lesson Focus:</strong><br>[AI: State the learning intention clearly]</p>
      </div>
      <div class="phase">
        <h4>Main Learning</h4>
        <p><strong>Teacher Input:</strong><br>[AI: Introduce and explain the main concept]</p>
        <p><strong>Learner Activity:</strong><br>[AI: Practical or collaborative task]</p>
        <p><strong>Assessment:</strong><br>[AI: 2-3 checks for understanding]</p>
      </div>
      <div class="phase">
        <h4>Closure</h4>
        <p><strong>Recap:</strong><br>[AI: Summarize the key ideas]</p>
        <p><strong>Reflection:</strong><br>[AI: Learner reflection prompt]</p>
        <p><strong>Assignment:</strong><br>[AI: Short take-home task]</p>
      </div>
    </div>
  </section>

  <section class="panel">
    <h3>Sign-off</h3>
    <div class="signoff-row"><strong>Facilitator</strong><span>${facilitatorDisplayName}</span></div>
    <div class="signoff-row"><strong>Vetted By</strong><span></span></div>
    <div class="signoff-row"><strong>Signature</strong><span></span></div>
    <div class="signoff-row"><strong>Date</strong><span></span></div>
  </section>
</div>`;
  }

  if (templateDesign === 'warm-community') {
    return `
<div class="lesson-note warm-community">
  <style>
    .lesson-note.warm-community {
      font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
      color: #4a3427;
      background: linear-gradient(180deg, #fff9f2 0%, #fffdf9 100%);
      border: 1px solid #ecd8c5;
      border-radius: 18px;
      padding: 20px;
      line-height: 1.58;
    }
    .warm-community .hero {
      background: linear-gradient(135deg, #8b4c27 0%, #c77732 100%);
      color: #fff7ed;
      border-radius: 16px;
      padding: 16px 18px;
      margin-bottom: 16px;
    }
    .warm-community .hero h2 { margin: 0 0 8px 0; font-size: 1.45rem; }
    .warm-community .badge-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .warm-community .badge {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 0.78rem;
      font-weight: 700;
    }
    .warm-community .section {
      background: #fffaf5;
      border: 1px solid #ecd8c5;
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 12px;
      box-shadow: 0 1px 0 rgba(139, 76, 39, 0.04);
    }
    .warm-community .section h3 {
      margin: 0 0 10px 0;
      color: #8b4c27;
      font-size: 1.02rem;
    }
    .warm-community .overview {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 16px;
    }
    .warm-community .phase-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .warm-community .phase-card {
      background: #ffffff;
      border: 1px solid #eddccc;
      border-radius: 12px;
      padding: 12px;
    }
    .warm-community .phase-card.full { grid-column: 1 / -1; }
    .warm-community .phase-card h4 { margin: 0 0 8px 0; color: #6e3819; }
    .warm-community .line-item {
      display: grid;
      grid-template-columns: 150px 1fr;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px dashed #eddccc;
    }
    .warm-community .line-item:last-child { border-bottom: 0; }
    @media (max-width: 720px) {
      .lesson-note.warm-community { padding: 14px; }
      .warm-community .overview,
      .warm-community .phase-grid,
      .warm-community .line-item {
        display: block;
      }
      .warm-community .phase-card,
      .warm-community .line-item { margin-bottom: 10px; }
    }
  </style>

  <header class="hero">
    <h2>Teacher Lesson Note</h2>
    <div class="badge-row">
      <span class="badge">${subjectName}</span>
      <span class="badge">${className}</span>
      <span class="badge">Term ${term}</span>
      <span class="badge">Week ${week}</span>
      <span class="badge">${subStrandName}</span>
    </div>
  </header>

  <section class="section">
    <h3>Classroom Snapshot</h3>
    <div class="overview">
      <p><strong>School:</strong> ${school}</p>
      <p><strong>Facilitator:</strong> ${facilitatorDisplayName}</p>
      <p><strong>Strand:</strong> ${strandName}</p>
      <p><strong>Class Size:</strong> ${classSize}</p>
      <p><strong>Duration:</strong> ${duration}</p>
      <p><strong>Day/Date:</strong> ${dayDate}</p>
      <p><strong>Week Ending:</strong> ${weekEnding}</p>
      <p><strong>Reference:</strong> ${reference}</p>
    </div>
  </section>

  <section class="section">
    <h3>Curriculum Promise</h3>
    <p><strong>Content Standard Code:</strong> ${contentStandardCode}</p>
    <p><strong>Official Indicator(s):</strong><br>${officialIndicatorText}</p>
    <p><strong>Performance Indicator(s):</strong><br>[AI: Generate 2-3 learner-centred indicators using simple classroom language]</p>
    <p><strong>Core Competencies:</strong><br>[AI: List 3-4 relevant NaCCA core competencies]</p>
    <p><strong>Teaching & Learning Materials:</strong><br>[AI: Suggest realistic materials including local classroom resources]</p>
  </section>

  <section class="section">
    <h3>Teaching Journey</h3>
    <div class="phase-grid">
      <div class="phase-card">
        <h4>Starter Circle</h4>
        <p><strong>Recap:</strong><br>[AI: Brief review of prior knowledge]</p>
        <p><strong>Starter Activity:</strong><br>[AI: Engaging warm-up task]</p>
        <p><strong>Lesson Intent:</strong><br>[AI: State the lesson purpose simply]</p>
      </div>
      <div class="phase-card">
        <h4>Guided Learning</h4>
        <p><strong>Teaching Points:</strong><br>[AI: Explain the concept in manageable steps]</p>
        <p><strong>Learner Participation:</strong><br>[AI: Describe pair/group or hands-on work]</p>
        <p><strong>Checks for Understanding:</strong><br>[AI: 2-3 quick formative questions]</p>
      </div>
      <div class="phase-card full">
        <h4>Reflection & Next Step</h4>
        <p><strong>Closure:</strong><br>[AI: Summarize the key ideas and classroom takeaways]</p>
        <p><strong>Real-Life Connection:</strong><br>[AI: Link the lesson to everyday Ghanaian life]</p>
        <p><strong>Home Practice:</strong><br>[AI: Short assignment or reflection task]</p>
      </div>
    </div>
  </section>

  <section class="section">
    <h3>Approval Lines</h3>
    <div class="line-item"><strong>Facilitator</strong><span>${facilitatorDisplayName}</span></div>
    <div class="line-item"><strong>Vetted By</strong><span></span></div>
    <div class="line-item"><strong>Signature</strong><span></span></div>
    <div class="line-item"><strong>Date</strong><span></span></div>
  </section>
</div>`;
  }

  if (templateDesign === 'structured-workshop') {
    return `
<div class="lesson-note structured-workshop">
  <style>
    .lesson-note.structured-workshop {
      font-family: 'Segoe UI', 'Arial Narrow', sans-serif;
      color: #1f2333;
      background: #f7f5fb;
      border: 1px solid #ddd2ee;
      border-radius: 16px;
      padding: 18px;
      line-height: 1.5;
    }
    .structured-workshop .banner {
      background: linear-gradient(135deg, #362158 0%, #6f45a7 100%);
      color: #ffffff;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .structured-workshop .banner h2 { margin: 0 0 8px 0; font-size: 1.42rem; }
    .structured-workshop .tag-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .structured-workshop .tag {
      border-radius: 8px;
      padding: 4px 10px;
      background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.22);
      font-size: 0.78rem;
      font-weight: 700;
    }
    .structured-workshop .board {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .structured-workshop .panel {
      background: #ffffff;
      border: 1px solid #ddd2ee;
      border-radius: 14px;
      padding: 14px;
    }
    .structured-workshop .panel h3 {
      margin: 0 0 10px 0;
      color: #4a2f78;
      font-size: 1rem;
    }
    .structured-workshop .checklist p { margin: 0 0 8px 0; }
    .structured-workshop .phase-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 0.92rem;
    }
    .structured-workshop .phase-table th,
    .structured-workshop .phase-table td {
      border: 1px solid #ddd2ee;
      padding: 10px;
      vertical-align: top;
      background: #fff;
    }
    .structured-workshop .phase-table th {
      background: #f1ebfb;
      color: #43296d;
      text-align: left;
    }
    .structured-workshop .sign-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .structured-workshop .sign-box {
      border: 1px dashed #bca8dd;
      border-radius: 12px;
      padding: 10px 12px;
      min-height: 60px;
      background: #fcfbff;
    }
    .structured-workshop .sign-box strong {
      display: block;
      color: #4a2f78;
      margin-bottom: 6px;
    }
    @media (max-width: 720px) {
      .lesson-note.structured-workshop { padding: 14px; }
      .structured-workshop .board,
      .structured-workshop .sign-grid {
        grid-template-columns: 1fr;
      }
      .structured-workshop .phase-table {
        display: block;
        overflow-x: auto;
      }
    }
  </style>

  <header class="banner">
    <h2>Teacher Lesson Note</h2>
    <div class="tag-row">
      <span class="tag">${subjectName}</span>
      <span class="tag">${className}</span>
      <span class="tag">Term ${term}</span>
      <span class="tag">Week ${week}</span>
      <span class="tag">${duration}</span>
    </div>
  </header>

  <section class="board">
    <div class="panel">
      <h3>Lesson Setup</h3>
      <p><strong>School:</strong> ${school}</p>
      <p><strong>Strand:</strong> ${strandName}</p>
      <p><strong>Sub-Strand:</strong> ${subStrandName}</p>
      <p><strong>Day/Date:</strong> ${dayDate}</p>
      <p><strong>Week Ending:</strong> ${weekEnding}</p>
      <p><strong>Facilitator:</strong> ${facilitatorDisplayName}</p>
    </div>
    <div class="panel checklist">
      <h3>Teaching Checks</h3>
      <p><strong>Class Size:</strong> ${classSize}</p>
      <p><strong>Content Standard Code:</strong> ${contentStandardCode}</p>
      <p><strong>Official Indicator(s):</strong><br>${officialIndicatorText}</p>
      <p><strong>Reference:</strong> ${reference}</p>
    </div>
  </section>

  <section class="panel">
    <h3>Competency and Resource Focus</h3>
    <p><strong>Performance Indicator(s):</strong><br>[AI: Generate 2-3 learner-centred performance indicators]</p>
    <p><strong>Core Competencies:</strong><br>[AI: List 3-4 relevant NaCCA core competencies]</p>
    <p><strong>Teaching & Learning Materials:</strong><br>[AI: Suggest practical materials for a workshop-style lesson]</p>
  </section>

  <section class="panel">
    <h3>Workshop Flow</h3>
    <table class="phase-table">
      <thead>
        <tr>
          <th>Launch</th>
          <th>Explore</th>
          <th>Demonstrate Mastery</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <p><strong>Recap:</strong><br>[AI: Brief review of prior knowledge]</p>
            <p><strong>Starter Task:</strong><br>[AI: Quick energizer or prompt]</p>
            <p><strong>Goal:</strong><br>[AI: State the lesson objective clearly]</p>
          </td>
          <td>
            <p><strong>Input:</strong><br>[AI: Main explanation and modeling]</p>
            <p><strong>Practice:</strong><br>[AI: Guided or collaborative learner task]</p>
            <p><strong>Checkpoint:</strong><br>[AI: Questions or observable checks]</p>
          </td>
          <td>
            <p><strong>Reflection:</strong><br>[AI: Learner reflection questions]</p>
            <p><strong>Application:</strong><br>[AI: Real-life or community connection]</p>
            <p><strong>Assignment:</strong><br>[AI: Short take-home activity]</p>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="panel">
    <h3>Sign-off Boxes</h3>
    <div class="sign-grid">
      <div class="sign-box"><strong>Facilitator</strong>${facilitatorDisplayName}</div>
      <div class="sign-box"><strong>Vetted By</strong></div>
      <div class="sign-box"><strong>Signature</strong></div>
      <div class="sign-box"><strong>Date</strong></div>
    </div>
  </section>
</div>`;
  }

  return `
<div class="lesson-note modern-academic">
  <style>
    .lesson-note.modern-academic {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      color: #1f2937;
      background: #f8fafc;
      border: 1px solid #dbe4ee;
      border-radius: 12px;
      padding: 18px;
      line-height: 1.5;
    }
    .note-header {
      background: linear-gradient(135deg, #0f2a43 0%, #1f4d7a 100%);
      color: #ffffff;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }
    .note-header h2 { margin: 0 0 6px 0; font-size: 1.4rem; }
    .meta-strip { font-size: 0.85rem; opacity: 0.95; }
    .chip-row { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
    .chip {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.35);
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .card {
      background: #ffffff;
      border: 1px solid #dbe4ee;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 12px;
      box-shadow: 0 1px 0 rgba(15, 42, 67, 0.03);
    }
    .card h3 {
      margin: 0 0 8px 0;
      color: #0f2a43;
      font-size: 1.05rem;
      border-left: 4px solid #2f6ea4;
      padding-left: 8px;
    }
    .teacher-table, .phase-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 0.92rem;
    }
    .teacher-table td, .teacher-table th, .phase-table td, .phase-table th {
      border: 1px solid #cfd8e3;
      padding: 8px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .teacher-table tr:nth-child(odd) td { background: #f8fbff; }
    .label-cell {
      background: #eef4fb;
      font-weight: 700;
      color: #1f3e5a;
      width: 18%;
    }
    .phase-table thead th {
      color: #0f2a43;
      font-weight: 700;
    }
    .phase-h1 { background: #edf7ff; width: 25%; }
    .phase-h2 { background: #e8f6f1; width: 50%; }
    .phase-h3 { background: #fff6e9; width: 25%; }
    .phase-table .session-banner {
      background: #f3f6fa;
      text-align: center;
      font-weight: 700;
      color: #1f3e5a;
      letter-spacing: 0.04em;
      border-top: 2px solid #b7c6d6;
      border-bottom: 2px solid #b7c6d6;
    }
    .signoff .sign-row {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 8px;
      align-items: center;
      margin: 8px 0;
    }
    .signoff .sign-label { font-weight: 700; color: #0f2a43; }
    .signoff .sign-line {
      border-bottom: 1.8px solid #9fb2c7;
      min-height: 20px;
      padding-bottom: 2px;
      font-weight: 600;
      color: #111827;
    }
    @media (max-width: 640px) {
      .lesson-note.modern-academic {
        padding: 12px;
        border-radius: 10px;
      }
      .note-header {
        padding: 12px;
      }
      .note-header h2 {
        font-size: 1.1rem;
      }
      .chip-row {
        gap: 6px;
      }
      .chip {
        font-size: 0.72rem;
        padding: 2px 8px;
      }
      .card {
        padding: 10px;
        margin-bottom: 10px;
      }
      .teacher-table,
      .phase-table {
        display: block;
        width: 100%;
        overflow-x: auto;
        white-space: normal;
      }
      .teacher-table td,
      .teacher-table th,
      .phase-table td,
      .phase-table th {
        min-width: 140px;
        font-size: 0.86rem;
        padding: 6px;
      }
      .label-cell {
        width: auto;
      }
      .signoff .sign-row {
        grid-template-columns: 1fr;
        gap: 4px;
      }
    }
  </style>

  <header class="note-header">
    <h2>Teacher Lesson Note</h2>
    <div class="chip-row">
      <span class="chip">${subjectName}</span>
      <span class="chip">${className}</span>
      <span class="chip">Term ${term}</span>
      <span class="chip">Week ${week}</span>
    </div>
  </header>

  <section class="card teacher-info">
    <table class="teacher-table">
      <tr>
        <td class="label-cell">School</td><td>${school}</td>
        <td class="label-cell">Term</td><td>${term}</td>
      </tr>
      <tr>
        <td class="label-cell">Week</td><td>${week}</td>
        <td class="label-cell">Week Ending</td><td>${weekEnding}</td>
      </tr>
      <tr>
        <td class="label-cell">Meetings This Week</td><td>${sessionPlanData.sessionCount}</td>
        <td class="label-cell">Facilitator</td><td>${facilitatorDisplayName}</td>
      </tr>
      <tr>
        <td class="label-cell">Class</td><td>${className}</td>
        <td class="label-cell">Class Size</td><td>${classSize}</td>
      </tr>
      <tr>
        <td class="label-cell">Subject</td><td>${subjectName}</td>
        <td class="label-cell">Reference</td><td>${reference}</td>
      </tr>
      <tr>
        <td class="label-cell">Strand</td><td colspan="3">${strandName}</td>
      </tr>
      <tr>
        <td class="label-cell">Sub-Strand</td><td colspan="3">${subStrandName}</td>
      </tr>
    </table>
  </section>

  <section class="card weekly-session-plan">
    <h3>Weekly Session Plan</h3>
    <table class="teacher-table">
      <thead>
        <tr>
          <th style="width:16%">Session</th>
          <th style="width:30%">Date / Slot</th>
          <th style="width:18%">Duration</th>
          <th style="width:36%">Session Focus</th>
        </tr>
      </thead>
      <tbody>
        ${sessionPlanData.rows.map((row) => `
        <tr>
          <td class="label-cell">${row.sessionLabel}</td>
          <td>${row.dateSlot}</td>
          <td>${row.duration}</td>
          <td>${row.focus}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>

  <section class="card curriculum-standards">
    <h3>Curriculum Standards</h3>
    <table class="teacher-table standards-table">
      <tr>
        <td class="label-cell">Content Standard Code</td>
        <td>${contentStandardCode}</td>
      </tr>
      <tr>
        <td class="label-cell">Official Indicator(s)</td>
        <td>${officialIndicatorText}</td>
      </tr>
      <tr>
        <td class="label-cell">Performance Indicator(s)</td>
        <td>[AI: Generate 2-3 learner-centric indicators using Transformation Logic as bullet points]</td>
      </tr>
      <tr>
        <td class="label-cell">Core Competencies</td>
        <td>[AI: List 3-4 relevant NaCCA core competencies as bullet points]</td>
      </tr>
      <tr>
        <td class="label-cell">Teaching & Learning Materials</td>
        <td>[AI: Suggest realistic materials for this topic as bullet points]</td>
      </tr>
      <tr>
        <td class="label-cell">Reference</td>
        <td>${reference}</td>
      </tr>
    </table>
  </section>

  <section class="card lesson-phases">
    <h3>Lesson Phases</h3>
    <table class="phase-table">
      <thead>
        <tr>
          <th class="phase-h1">Phase 1: Starter<br>(Preparing the Brain)</th>
          <th class="phase-h2">Phase 2: Main<br>(New Learning & Assessment)</th>
          <th class="phase-h3">Phase 3: Plenary<br>(Reflection)</th>
        </tr>
      </thead>
      <tbody>
        ${isMultiSession
          ? sessionPlanData.rows.map((row, index) => `
        <tr>
          <td colspan="3" class="session-banner"><strong>${row.sessionLabel.toUpperCase()}</strong> | ${row.dateSlot} | ${row.duration}</td>
        </tr>
        <tr>
          <td>
            <p><strong>Recap:</strong><br>[AI: Briefly review prior learning relevant to ${row.focus}]</p>
            <p><strong>Engaging Activity:</strong><br>[AI: A short starter task for ${row.sessionLabel}]</p>
            <p><strong>Introduction:</strong><br>[AI: Introduce this session objective clearly]</p>
          </td>
          <td>
            <p><strong>Activity 1:</strong><br>[AI: Guided teaching activity for ${row.sessionLabel}]</p>
            <p><strong>Activity 2:</strong><br>[AI: Practical learner task for ${row.sessionLabel}]</p>
            <p><strong>Evaluation:</strong><br>[AI: Write 3 concrete learner-facing questions as a numbered list (1., 2., 3.), each ending with a question mark]</p>
            <p><strong>Assignment:</strong><br>[AI: Give a short task aligned to ${row.sessionLabel}]</p>
          </td>
          <td>
            <p><strong>Recap:</strong><br>[AI: Summarize the key learning for ${row.sessionLabel}]</p>
            <p><strong>Learner Reflection:</strong><br>[AI: 1-2 reflection prompts for ${row.sessionLabel}]</p>
            <p><strong>Real-Life Application:</strong><br>[AI: One local real-life application for ${row.sessionLabel}]</p>
          </td>
        </tr>`).join('')
          : `
        <tr>
          <td>
            <p><strong>Recap:</strong><br>[AI: Brief review of prior knowledge]</p>
            <p><strong>Engaging Activity:</strong><br>[AI: Short task to capture interest]</p>
            <p><strong>Introduction:</strong><br>[AI: State lesson objective clearly]</p>
          </td>
          <td>
            <p><strong>Activity 1:</strong><br>[AI: Introduce main topic with explanation]</p>
            <p><strong>Activity 2:</strong><br>[AI: Practical task - individual, pair, or group work]</p>
            <p><strong>Evaluation:</strong><br>[AI: Write 3 concrete learner-facing questions as a numbered list (1., 2., 3.), each ending with a question mark]</p>
            <p><strong>Assignment:</strong><br>[AI: Short take-home task]</p>
          </td>
          <td>
            <p><strong>Recap:</strong><br>[AI: Summarize key ideas]</p>
            <p><strong>Learner Reflection:</strong><br>[AI: Questions to help learners reflect]</p>
            <p><strong>Real-Life Application:</strong><br>[AI: Link lesson to everyday Ghanaian life]</p>
          </td>
        </tr>`}
      </tbody>
    </table>
  </section>

  <section class="card signoff">
    <h3>Approvals & Sign-off</h3>
    <div class="sign-row"><span class="sign-label">Facilitator:</span><span class="sign-line">${facilitatorDisplayName}</span></div>
    <div class="sign-row"><span class="sign-label">Vetted By:</span><span class="sign-line"></span></div>
    <div class="sign-row"><span class="sign-label">Signature:</span><span class="sign-line"></span></div>
    <div class="sign-row"><span class="sign-label">Date:</span><span class="sign-line"></span></div>
  </section>
</div>`;
}

function stripTeacherLessonNoteShell(html = '') {
  let normalized = String(html || '').trim();
  normalized = normalized.replace(/<style[\s\S]*?<\/style>/gi, '').trim();

  // For already-restyled notes, extract only the restyled-body section content
  // to avoid carrying the old restyle header into the new template.
  const restyledBodyMatch = /<section[^>]*class=["'][^"']*restyled-body[^"']*["'][^>]*>([\s\S]*)<\/section>\s*<\/div>\s*$/i.exec(normalized);
  if (restyledBodyMatch) {
    return restyledBodyMatch[1].trim();
  }

  // For original AI-generated notes, strip the outer lesson-note div wrapper.
  if (/^<div[^>]*class=["'][^"']*lesson-note[^"']*["'][^>]*>/i.test(normalized)) {
    normalized = normalized.replace(/^<div[^>]*>/i, '').trim();
    normalized = normalized.replace(/<\/div>\s*$/i, '').trim();
  }

  return normalized;
}

function buildTeacherLessonNoteRestyleWrapper(templateDesign, metadata = {}, bodyHtml = '') {
  const {
    subjectName = 'Subject',
    className = 'Class',
    strandName = 'Strand',
    subStrandName = 'Topic',
  } = metadata;

  if (templateDesign === 'clean-minimal') {
    return `
<div class="lesson-note restyled clean-minimal">
  <style>
    .lesson-note.restyled.clean-minimal {
      font-family: 'Aptos', 'Segoe UI', Arial, sans-serif;
      color: #1f2933;
      background: #ffffff;
      border: 1px solid #d9e2ec;
      border-radius: 16px;
      padding: 22px;
      line-height: 1.6;
    }
    .lesson-note.restyled.clean-minimal .restyle-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      padding-bottom: 14px;
      border-bottom: 2px solid #d9e2ec;
      margin-bottom: 16px;
    }
    .lesson-note.restyled.clean-minimal .restyle-header h1 { margin: 0; font-size: 1.35rem; color: #102a43; }
    .lesson-note.restyled.clean-minimal .restyle-subtitle { margin: 4px 0 0; color: #52606d; font-size: 0.9rem; }
    .lesson-note.restyled.clean-minimal .restyle-chip-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .lesson-note.restyled.clean-minimal .restyle-chip {
      border: 1px solid #bcccdc;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 0.76rem;
      font-weight: 700;
      color: #334e68;
      background: #f8fbff;
    }
    .lesson-note.restyled.clean-minimal .restyled-body > :first-child { margin-top: 0 !important; }
    .lesson-note.restyled.clean-minimal .restyled-body h2,
    .lesson-note.restyled.clean-minimal .restyled-body h3 { color: #102a43; }
    .lesson-note.restyled.clean-minimal .restyled-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 0.94rem;
    }
    .lesson-note.restyled.clean-minimal .restyled-body th,
    .lesson-note.restyled.clean-minimal .restyled-body td {
      border: 1px solid #d9e2ec;
      padding: 9px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .lesson-note.restyled.clean-minimal .restyled-body th { background: #f8fbff; }
    @media (max-width: 720px) {
      .lesson-note.restyled.clean-minimal { padding: 14px; }
      .lesson-note.restyled.clean-minimal .restyle-header { display: block; }
      .lesson-note.restyled.clean-minimal .restyle-chip-row { justify-content: flex-start; margin-top: 10px; }
      .lesson-note.restyled.clean-minimal .restyled-body table { display: block; overflow-x: auto; }
    }
  </style>
  <header class="restyle-header">
    <div>
      <h1>Teacher Lesson Note</h1>
      <p class="restyle-subtitle">Clean Minimal design</p>
    </div>
    <div class="restyle-chip-row">
      <span class="restyle-chip">${subjectName}</span>
      <span class="restyle-chip">${className}</span>
      <span class="restyle-chip">${strandName}</span>
      <span class="restyle-chip">${subStrandName}</span>
    </div>
  </header>
  <section class="restyled-body">${bodyHtml}</section>
</div>`;
  }

  if (templateDesign === 'warm-community') {
    return `
<div class="lesson-note restyled warm-community">
  <style>
    .lesson-note.restyled.warm-community {
      font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
      color: #4a3427;
      background: linear-gradient(180deg, #fffaf3 0%, #fffdf9 100%);
      border: 1px solid #ecd8c5;
      border-radius: 18px;
      padding: 20px;
      line-height: 1.6;
    }
    .lesson-note.restyled.warm-community .restyle-header {
      background: linear-gradient(135deg, #8b4c27 0%, #c77732 100%);
      color: #fff8f0;
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .lesson-note.restyled.warm-community .restyle-header h1 { margin: 0 0 8px 0; font-size: 1.4rem; }
    .lesson-note.restyled.warm-community .restyle-subtitle { margin: 0 0 10px 0; opacity: 0.95; }
    .lesson-note.restyled.warm-community .restyle-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .lesson-note.restyled.warm-community .restyle-chip {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 0.76rem;
      font-weight: 700;
    }
    .lesson-note.restyled.warm-community .restyled-body {
      background: #fffaf5;
      border: 1px solid #eddccc;
      border-radius: 14px;
      padding: 14px 16px;
    }
    .lesson-note.restyled.warm-community .restyled-body > :first-child { margin-top: 0 !important; }
    .lesson-note.restyled.warm-community .restyled-body h2,
    .lesson-note.restyled.warm-community .restyled-body h3 { color: #8b4c27; }
    .lesson-note.restyled.warm-community .restyled-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
    }
    .lesson-note.restyled.warm-community .restyled-body th,
    .lesson-note.restyled.warm-community .restyled-body td {
      border: 1px solid #eddccc;
      padding: 9px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .lesson-note.restyled.warm-community .restyled-body th { background: #fff1e2; }
    @media (max-width: 720px) {
      .lesson-note.restyled.warm-community { padding: 14px; }
      .lesson-note.restyled.warm-community .restyled-body table { display: block; overflow-x: auto; }
    }
  </style>
  <header class="restyle-header">
    <h1>Teacher Lesson Note</h1>
    <p class="restyle-subtitle">Warm Community design</p>
    <div class="restyle-chip-row">
      <span class="restyle-chip">${subjectName}</span>
      <span class="restyle-chip">${className}</span>
      <span class="restyle-chip">${strandName}</span>
      <span class="restyle-chip">${subStrandName}</span>
    </div>
  </header>
  <section class="restyled-body">${bodyHtml}</section>
</div>`;
  }

  if (templateDesign === 'structured-workshop') {
    return `
<div class="lesson-note restyled structured-workshop">
  <style>
    .lesson-note.restyled.structured-workshop {
      font-family: 'Segoe UI', 'Arial Narrow', sans-serif;
      color: #1f2333;
      background: #f7f5fb;
      border: 1px solid #ddd2ee;
      border-radius: 16px;
      padding: 18px;
      line-height: 1.56;
    }
    .lesson-note.restyled.structured-workshop .restyle-header {
      background: linear-gradient(135deg, #362158 0%, #6f45a7 100%);
      color: #fff;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .lesson-note.restyled.structured-workshop .restyle-header h1 { margin: 0 0 8px 0; font-size: 1.4rem; }
    .lesson-note.restyled.structured-workshop .restyle-subtitle { margin: 0 0 10px 0; opacity: 0.95; }
    .lesson-note.restyled.structured-workshop .restyle-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .lesson-note.restyled.structured-workshop .restyle-chip {
      background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.24);
      border-radius: 8px;
      padding: 4px 10px;
      font-size: 0.76rem;
      font-weight: 700;
    }
    .lesson-note.restyled.structured-workshop .restyled-body {
      background: #fff;
      border: 1px solid #ddd2ee;
      border-radius: 14px;
      padding: 14px;
    }
    .lesson-note.restyled.structured-workshop .restyled-body > :first-child { margin-top: 0 !important; }
    .lesson-note.restyled.structured-workshop .restyled-body h2,
    .lesson-note.restyled.structured-workshop .restyled-body h3 { color: #4a2f78; }
    .lesson-note.restyled.structured-workshop .restyled-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
    }
    .lesson-note.restyled.structured-workshop .restyled-body th,
    .lesson-note.restyled.structured-workshop .restyled-body td {
      border: 1px solid #ddd2ee;
      padding: 9px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .lesson-note.restyled.structured-workshop .restyled-body th { background: #f1ebfb; }
    @media (max-width: 720px) {
      .lesson-note.restyled.structured-workshop { padding: 14px; }
      .lesson-note.restyled.structured-workshop .restyled-body table { display: block; overflow-x: auto; }
    }
  </style>
  <header class="restyle-header">
    <h1>Teacher Lesson Note</h1>
    <p class="restyle-subtitle">Structured Workshop design</p>
    <div class="restyle-chip-row">
      <span class="restyle-chip">${subjectName}</span>
      <span class="restyle-chip">${className}</span>
      <span class="restyle-chip">${strandName}</span>
      <span class="restyle-chip">${subStrandName}</span>
    </div>
  </header>
  <section class="restyled-body">${bodyHtml}</section>
</div>`;
  }

  return `
<div class="lesson-note restyled modern-academic">
  <style>
    .lesson-note.restyled.modern-academic {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      color: #1f2937;
      background: #f8fafc;
      border: 1px solid #dbe4ee;
      border-radius: 12px;
      padding: 18px;
      line-height: 1.56;
    }
    .lesson-note.restyled.modern-academic .restyle-header {
      background: linear-gradient(135deg, #0f2a43 0%, #1f4d7a 100%);
      color: #ffffff;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }
    .lesson-note.restyled.modern-academic .restyle-header h1 { margin: 0 0 8px 0; font-size: 1.35rem; }
    .lesson-note.restyled.modern-academic .restyle-subtitle { margin: 0 0 10px 0; opacity: 0.95; }
    .lesson-note.restyled.modern-academic .restyle-chip-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .lesson-note.restyled.modern-academic .restyle-chip {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.35);
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 0.76rem;
      font-weight: 700;
    }
    .lesson-note.restyled.modern-academic .restyled-body {
      background: #fff;
      border: 1px solid #dbe4ee;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .lesson-note.restyled.modern-academic .restyled-body > :first-child { margin-top: 0 !important; }
    .lesson-note.restyled.modern-academic .restyled-body h2,
    .lesson-note.restyled.modern-academic .restyled-body h3 { color: #0f2a43; }
    .lesson-note.restyled.modern-academic .restyled-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
    }
    .lesson-note.restyled.modern-academic .restyled-body th,
    .lesson-note.restyled.modern-academic .restyled-body td {
      border: 1px solid #cfd8e3;
      padding: 9px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .lesson-note.restyled.modern-academic .restyled-body th { background: #eef4fb; }
    @media (max-width: 720px) {
      .lesson-note.restyled.modern-academic { padding: 14px; }
      .lesson-note.restyled.modern-academic .restyled-body table { display: block; overflow-x: auto; }
    }
  </style>
  <header class="restyle-header">
    <h1>Teacher Lesson Note</h1>
    <p class="restyle-subtitle">Modern Academic design</p>
    <div class="restyle-chip-row">
      <span class="restyle-chip">${subjectName}</span>
      <span class="restyle-chip">${className}</span>
      <span class="restyle-chip">${strandName}</span>
      <span class="restyle-chip">${subStrandName}</span>
    </div>
  </header>
  <section class="restyled-body">${bodyHtml}</section>
</div>`;
}

function restyleTeacherLessonNoteHTML(existingHtml, details = {}) {
  const templateDesign = resolveTeacherNoteTemplate(details.templateDesign);
  const bodyHtml = stripTeacherLessonNoteShell(existingHtml);

  return buildTeacherLessonNoteRestyleWrapper(templateDesign, details, bodyHtml);
}

function boldLessonPhaseIndicators(html = '') {
  const source = String(html || '');
  return source.replace(
    /<p>\s*((?:Session\s*\d+\s*)?(?:Recap|Activity\s*\d+|Evaluation|Assignment|Learner Reflection|Real-Life Application|Introduction|Engaging Activity)\s*:)/gi,
    '<p><strong>$1</strong>'
  );
}

function ensureEvaluationQuestions(html = '', { topic = '', isMultiSession = false } = {}) {
  const source = String(html || '');

  return source.replace(
    /(<p>\s*<strong>Evaluation:\/strong>\s*<br\s*\/?\s*>)([\s\S]*?)(<\/p>)/gi,
    (_full, prefix, body, suffix) => {
      const bodyText = String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const questionMarks = (bodyText.match(/\?/g) || []).length;

      // Keep AI output if it already contains enough concrete questions.
      if (questionMarks >= 2) {
        return `${prefix}${body}${suffix}`;
      }

      const safeTopic = String(topic || '').trim() || 'this lesson topic';

      if (isMultiSession) {
        return `${prefix}1. Session 1: What is ${safeTopic}?<br>2. Session 1: State two key ideas learned about ${safeTopic}.<br>3. Session 2: How can you apply ${safeTopic} to solve a real-life problem?<br>4. Session 2: Give one correct example related to ${safeTopic}.${suffix}`;
      }

      return `${prefix}1. What is ${safeTopic}?<br>2. Mention two important points about ${safeTopic}.<br>3. Give one practical example of ${safeTopic}.${suffix}`;
    }
  );
}

function shouldUseDiagramSupport(subject = '') {
  const normalized = String(subject || '').toLowerCase();
  return [
    'mathematics',
    'math',
    'creative art',
    'creative arts',
    'career technology',
    'career and technology',
    'design and technology',
  ].some((key) => normalized.includes(key));
}

function topicNeedsSimpleDiagram(topic = '', activityText = '') {
  const probe = `${topic} ${activityText}`.toLowerCase();
  const visualKeywords = [
    'diagram',
    'graph',
    'chart',
    'table',
    'shape',
    'angle',
    'line',
    'pattern',
    'drawing',
    'sketch',
    'design',
    'measurement',
    'construction',
    'layout',
    'flow',
    'process',
    'circuit',
    'fraction',
    'geometry',
    'place value',
  ];
  return visualKeywords.some((key) => probe.includes(key));
}

function ensurePhase2ActivitiesReadable(html = '', { subjectName = '', topic = '' } = {}) {
  const source = String(html || '');
  const allowDiagram = shouldUseDiagramSupport(subjectName);

  const stripTags = (value = '') => String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const splitSentences = (value = '') => {
    const text = stripTags(value);
    if (!text) return [];
    return text
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter(Boolean);
  };

  return source.replace(
    /(<p>\s*<strong>(?:Session\s*\d+\s*)?Activity\s*(1|2)\s*:\/strong>\s*<br\s*\/?\s*>)([\s\S]*?)(<\/p>)/gi,
    (_full, prefix, activityNumber, body, suffix) => {
      const rawBody = String(body || '');
      const bodyText = stripTags(rawBody);
      if (!bodyText) return `${prefix}${body}${suffix}`;

      const alreadyReadable = /<br\s*\/?\s*>|<ul>|<ol>|\b1\.\s+/i.test(rawBody);
      const lines = splitSentences(rawBody);
      const compactLines = lines.slice(0, 4);

      let rebuiltBody = rawBody;
      if (!alreadyReadable) {
        const fallback = compactLines.length ? compactLines : [bodyText];
        rebuiltBody = fallback
          .map((line, idx) => `${idx + 1}. ${line}`)
          .join('<br>');
      }

      const hasDiagram = /simple diagram\s*:/i.test(stripTags(rebuiltBody));
      if (allowDiagram && !hasDiagram && topicNeedsSimpleDiagram(topic, bodyText)) {
        const diagramLine = `<br><strong>Simple Diagram:</strong> Quick board sketch with Ghanaian context (e.g., market, transport, home, or school setting), clearly labeled for learners to copy.`;
        rebuiltBody = `${rebuiltBody}${diagramLine}`;
      }

      return `${prefix}${rebuiltBody}${suffix}`;
    }
  );
}

async function generateTeacherLessonNoteHTML(details = {}) {
  const { 
    school, 
    className, 
    subjectName, 
    strandName, 
    subStrandName, 
    week, 
    weekEnding,
    term, 
    duration, 
    classSize, 
    reference, 
    contentStandardCode, 
    indicatorCodes, 
    dayDate, 
    facilitatorName,
    sessionsPerWeek,
    sessionPlan,
    topicCount,
    multiTopicContext,
    preferredModel, 
    preferredProvider 
  } = details;

  const resolvedSchool = school || '';
  const resolvedClassName = className || '[Class]';
  const resolvedSubjectName = subjectName || '[Subject]';
  const resolvedStrandName = strandName || '[Strand]';
  const resolvedSubStrandName = subStrandName || '[Sub-Strand]';
  const resolvedWeek = week || '';
  const resolvedWeekEnding = weekEnding || '';
  const resolvedTerm = term || '';
  const resolvedClassSize = classSize || '';
  const resolvedReference = reference || '';
  const resolvedDayDate = dayDate || '';
  const resolvedDuration = duration || '';
  const resolvedContentStandardCode = contentStandardCode || '';

  const officialIndicatorText = indicatorCodes || '';
  const facilitatorDisplayName = String(facilitatorName || '').trim() || '';
  const templateMarkup = buildTeacherLessonNoteTemplate('modern-academic', {
    school: resolvedSchool,
    className: resolvedClassName,
    subjectName: resolvedSubjectName,
    strandName: resolvedStrandName,
    subStrandName: resolvedSubStrandName,
    week: resolvedWeek,
    weekEnding: resolvedWeekEnding,
    term: resolvedTerm,
    duration: resolvedDuration,
    classSize: resolvedClassSize,
    reference: resolvedReference,
    contentStandardCode: resolvedContentStandardCode,
    officialIndicatorText,
    dayDate: resolvedDayDate,
    facilitatorDisplayName,
    sessionsPerWeek,
    sessionPlan,
  });
  
  const prompt = `
You are a Ghanaian master teacher and curriculum expert. Generate a professionally formatted HTML lesson note following Ghana's NaCCA (National Council for Curriculum and Assessment) structure.

CRITICAL RULES:
1. Return ONLY valid HTML - no markdown, no code blocks, no explanations
2. Start directly with HTML tags - no introductory text
3. Use proper HTML tags: <h2>, <h3>, <p>, <table>, <ul>, <li>, <strong>, <br>
4. The layout must be clean, professional, and ready to display in a web browser
5. Use the "Transformation Logic" to convert the "Official NaCCA Indicator" into learner-centric "Performance Indicators"
6. Use the provided Week Ending exactly as given. Do not recompute or infer a different date from Day/Date.
7. Keep the chosen visual template structure exactly as provided while filling the content professionally
8. In the "Curriculum Standards" section, keep a strict TWO-COLUMN table layout (label in column 1, content in column 2). Do not convert those rows into standalone paragraphs.
9. Respect "Meetings This Week" and the "Weekly Session Plan" table: distribute teaching progression across sessions and avoid repeating the same activities in every session.
10. For multi-session weeks (2+ sessions), show clear continuity from Session 1 to later sessions (review -> deepen -> assess/consolidate).
11. For multi-session weeks, the "Lesson Phases" table must be split by session blocks: add a full-width row label like "SESSION 1", then one row with Phase 1, Phase 2, and Phase 3 content for that session; repeat for SESSION 2, SESSION 3, etc.
12. The "Evaluation" field must contain only concrete assessment questions, not descriptions. Format as a numbered list (1., 2., 3., ...), each line ending with a question mark.
13. If multiple topics/sub-strands are provided, generate ONE integrated lesson note that covers all topics across the available sessions, not separate notes.
14. For multiple topics, map curriculum alignment correctly: show corresponding Content Standard Code(s) and Official Indicator(s) for each topic in clear, topic-labeled lines.
15. For multiple topics, distribute topic flow intelligently across sessions (e.g., Session 1 foundation topics, Session 2 deeper application/assessment), with explicit continuity.
16. LESSON PHASE QUALITY — STRICTLY ENFORCED:
    Every phase cell must contain classroom-ready, subject-specific content. Generic meta-descriptions are FORBIDDEN.

BANNED PHRASES (never use these alone):
  - "activate prior knowledge" / "generate interest" / "state the objective" / "discuss the topic" / "do an activity"
  - "ask questions" / "summarize key ideas" / "assess understanding" / "engage learners" / "explore the concept"
  Each of those must be replaced with the ACTUAL content of that action.

LESSON PHASE GOOD vs BAD EXAMPLES (use as a quality standard for this lesson):

  Phase 1 — Recap:
    ❌ BAD: "Review prior knowledge on counting and number recognition."
    ✅ GOOD: "Briefly review counting and identifying numbers up to 100 by asking: 'What comes after 89? What is 10 more than 45?'"

  Phase 1 — Engaging Activity:
    ❌ BAD: "Counting game with the class to activate prior knowledge and generate interest."
    ✅ GOOD: "Show a large number chart (1–100) and call out a number (e.g., 67); learners race to point at it and say what comes before and after."

  Phase 1 — Introduction:
    ❌ BAD: "Clearly state the lesson objective."
    ✅ GOOD: "Say: 'Today we will learn about numbers bigger than 100, up to 1,000, and how to understand the value of each digit using hundreds, tens, and ones.'"

  Phase 2 — Activity 1:
    ❌ BAD: "Explain the concept using number lines and blocks."
    ✅ GOOD: "Introduce place value using a chart on the board. Demonstrate how 123 = 1 hundred + 2 tens + 3 ones. Show 456 and 789 in the same way, drawing each column."

  Phase 2 — Activity 2:
    ❌ BAD: "Learners work in pairs to match number cards."
    ✅ GOOD: "Distribute place-value cards. Each pair builds three numbers (e.g., 342, 507, 680) on their chart. Teacher circulates and asks: 'How many tens are in 507?'"

  Phase 2 — Assignment:
    ❌ BAD: "Give learners a short task to complete at home."
    ✅ GOOD: "Draw a place value chart in your exercise book and represent the number 678 showing hundreds, tens, and ones columns."

  Phase 3 — Real-Life Application:
    ❌ BAD: "Discuss how the concept is used in everyday life."
    ✅ GOOD: "We see numbers up to 1,000 on bus numbers (e.g., Accra–Kumasi fare = GH¢95), house addresses on streets, and prices on goods in the market."

17. Evaluation questions must name exact values, terms, or operations from the lesson (not generic "what did you learn?" questions).
18. Differentiation: name the EXACT support or extension (e.g., "provide a pre-filled place value chart" or "challenge: write a 4-digit number and decompose it").
19. Assessment-for-Learning checkpoint must describe what the teacher observes or listens for (not "check for understanding").
20. Keep Phase 2 Activity 1 and Activity 2 as short readable action lines (3-5 lines), not one continuous paragraph. Separate lines with <br> and you may number them.
21. For Mathematics, Creative Arts, Career Technology, and related practical subjects, include "Simple Diagram:" only when the concept is visual/spatial/process-based. Keep it easy to draw on a classroom board.
22. Keep examples and classroom context Ghanaian: use local names, places, materials, and everyday Ghana settings where appropriate.

LESSON PHASE STRUCTURE RUBRIC:
  Phase 1: specific prior-knowledge trigger + engaging named task + explicit objective sentence.
  Phase 2: teacher explanation with examples -> readable step lines for activity flow -> named learner task with output -> AfL observation note -> differentiation move -> home assignment with specific task.
  Phase 3: subject-specific recap sentence + 1–2 reflection questions + Ghana real-life named example.
  Multi-session: Session 2 must deepen or apply what Session 1 introduced, not restate it.

---
TOPIC CONTEXT:
- Topic count: ${Number(topicCount || 1)}
- Selected topics:
${multiTopicContext || `1. Strand: ${resolvedStrandName} | Sub-strand: ${resolvedSubStrandName}`}

CURRICULUM ALIGNMENT RULE:
- If Topic count > 1, the "Content Standard Code" and "Official Indicator(s)" entries must include one clearly labeled line per topic (e.g., "Topic 1 - ...", "Topic 2 - ...") and each indicator must correspond to the correct topic.

---
TRANSFORMATION LOGIC EXAMPLE:
- IF Official Indicator: "Discuss the fourth-generation computers"
- THEN Performance Indicator: "The learner can identify the features of fourth-generation computers."
- THEN Another: "The learner can explain the advantages of fourth-generation computers."
---

Generate HTML in this exact template structure:

${templateMarkup}

REMEMBER: Return ONLY the HTML above, filled with appropriate content. Keep the same class names/style block and structure. No markdown, no code fences, no explanations.
`;

  let { text, provider, model, timestamp } = await generateTextCore({ 
    prompt, 
    task: 'teacherLessonNoteHTML', 
    temperature: 0.4, 
    preferredProvider, 
    providerModelOverride: preferredModel 
  });

  // convert any placeholder tokens into real <img> tags
  text = replacePlaceholdersWithImages(text);

  // Ensure lesson phase indicators remain visually clear and consistent.
  text = boldLessonPhaseIndicators(text);

  // Guardrail: convert vague Evaluation prose into concrete numbered questions.
  text = ensureEvaluationQuestions(text, {
    topic: resolvedSubStrandName,
    isMultiSession: Number(sessionsPerWeek || 1) >= 2,
  });

  // Guardrail: keep Activity 1/2 readable (not continuous prose) and add diagrams when needed.
  text = ensurePhase2ActivitiesReadable(text, {
    subjectName: resolvedSubjectName,
    topic: resolvedSubStrandName,
  });

  return {
    text,
    provider,
    model,
    task: 'teacherLessonNoteHTML',
    timestamp,
  };
}

/**
 * Generate Student-Friendly Learner Note in HTML format.
 * Transforms the teacher note into engaging, simple content for learners.
 */
async function generateLearnerNoteHTML(teacherNoteHTML, details = {}) {
  if (!teacherNoteHTML || typeof teacherNoteHTML !== 'string') {
    throw new Error('Teacher note HTML must be provided as a non-empty string.');
  }
  const {
    subStrandName = 'Topic',
    className = 'Class',
    subjectName = 'General',
    preferredProvider,
    preferredModel,
  } = details;
  const master = MASTER_SUBJECT_PROMPT(subjectName);

  const prompt = `${master}
You are a friendly Ghanaian teacher creating a well-structured, textbook-style study note for ${className} students.

Transform the teacher lesson note into rich, student-friendly HTML.

CRITICAL RULES:
1. Return ONLY valid HTML. No markdown, no code blocks, no explanations.
2. Start directly with HTML tags.
3. Use semantic HTML tags: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <strong>, <em>, <figure>, <figcaption>, <hr>.
4. Keep language age-appropriate for ${className}, and explain difficult terms simply.

CONTENT REQUIREMENTS:
1. Main title must be "${subStrandName}".
2. Follow this section order exactly:
   - Meaning/overview of the topic
   - Key words or tools in a table (minimum 2 rows)
   - Core concepts (minimum 2 concept sections)
   - Real-life application in Ghana
   - Check your understanding (exactly 3 short questions)
3. In each core concept section, include:
   - one concise explanation paragraph
   - one bullet list with 2-4 points
   - one Ghanaian real-world example
4. Include at least TWO image placeholders using one of these formats:
   - [image: concise search query]
   - [IMAGE]\n{ "title": "...", "search_query": "...", "purpose": "..." }\n[/IMAGE]

OUTPUT TEMPLATE:
<div class="learner-note">
  <h1>${subStrandName}</h1>

  <div class="overview">
    <h2>Meaning of ${subStrandName}</h2>
    <p>[AI content]</p>
  </div>

  <div class="key-words">
    <h2>Key Words / Tools</h2>
    <table>
      <thead>
        <tr>
          <th>Word / Tool</th>
          <th>Meaning / Use</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>[AI]</td><td>[AI]</td></tr>
        <tr><td>[AI]</td><td>[AI]</td></tr>
      </tbody>
    </table>
  </div>

  <div class="concepts">
    <h2>Core Concepts</h2>

    <section>
      <h3>[AI: Concept 1 heading]</h3>
      <p>[AI: clear explanation]</p>
      <ul>
        <li>[AI: key point]</li>
        <li>[AI: key point]</li>
      </ul>
      <p><strong>Ghana Example:</strong> [AI example]</p>
      <p>[image: AI concise search query for concept 1]</p>
    </section>

    <section>
      <h3>[AI: Concept 2 heading]</h3>
      <p>[AI: clear explanation]</p>
      <ul>
        <li>[AI: key point]</li>
        <li>[AI: key point]</li>
      </ul>
      <p><strong>Ghana Example:</strong> [AI example]</p>
      <p>[image: AI concise search query for concept 2]</p>
    </section>
  </div>

  <div class="real-life">
    <h2>In Real Life (Ghana Context)</h2>
    <p>[AI content]</p>
  </div>

  <div class="practice">
    <h2>Check Your Understanding</h2>
    <ol>
      <li>[AI question]</li>
      <li>[AI question]</li>
      <li>[AI question]</li>
    </ol>
  </div>
</div>

TEACHER'S LESSON NOTE (for your reference):
---
${teacherNoteHTML}
---

REMEMBER: Return ONLY the HTML above, filled with student-friendly content. No markdown, no code fences, no explanations.
`;

  let { text, provider, model, timestamp } = await generateTextCore({ 
    prompt, 
    task: 'learnerNoteHTML', 
    temperature: 0.45, 
    preferredProvider,
    providerModelOverride: preferredModel,
  });

  text = replacePlaceholdersWithImages(text);

  return { text, provider, model, task: 'learnerNoteHTML', timestamp };
}

/**
 * Generate Structured Quiz with 4 Question Types in JSON format.
 * Returns: MCQ (multiple choice), True/False, Short Answer, Essay questions.
 */
async function generateStructuredQuizJSON(details = {}) {
  const { 
    topic, 
    subStrandName, 
    className, 
    subjectName, 
    numQuestions = 20,
    preferredProvider, 
    preferredModel 
  } = details;

  const topicText = topic || subStrandName || 'the current topic';

  const prompt = `
You are an expert WAEC examiner creating a comprehensive quiz for ${className} students in ${subjectName}.

Topic: "${topicText}"

Generate a structured quiz with FOUR question types. Return ONLY valid JSON with NO additional text, explanations, or markdown.

REQUIRED JSON STRUCTURE:
{
  "mcq": [
    {
      "question": "string - the question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "string - brief explanation of correct answer"
    }
  ],
  "trueFalse": [
    {
      "statement": "string - a statement that is true or false",
      "answer": true,
      "explanation": "string - why it's true or false"
    }
  ],
  "shortAnswer": [
    {
      "question": "string - question requiring 1-3 sentence answer",
      "expectedAnswer": "string - sample correct answer"
    }
  ],
  "essay": [
    {
      "question": "string - essay question requiring detailed response",
      "markingGuide": "string - key points students should cover"
    }
  ]
}

REQUIREMENTS:
1. **MCQ:** Generate at least ${Math.min(20, numQuestions)} multiple-choice questions with 4 options each
2. **True/False:** Generate 5-10 true/false statements
3. **Short Answer:** Generate 5-10 questions requiring brief answers
4. **Essay:** Generate 3-5 questions requiring detailed explanations

QUALITY STANDARDS:
- All questions must be appropriate for ${className} level
- Questions should cover different aspects of "${topicText}"
- Use clear, simple English suitable for Ghanaian students
- Include local/Ghanaian contexts where relevant
- For MCQ: Make distractors plausible but clearly distinguishable from correct answer
- For True/False: Make statements clear and unambiguous
- For Short Answer: Questions should be answerable in 2-3 sentences
- For Essay: Questions should require analysis, explanation, or application

CRITICAL: Return ONLY the JSON object. No markdown code fences, no explanations, no additional text.
`;

  const { text, provider, model, timestamp } = await generateTextCore({ 
    prompt, 
    task: 'structuredQuiz', 
    temperature: 0.3, 
    jsonNeeded: true, 
    preferredProvider, 
    providerModelOverride: preferredModel 
  });

  const parsed = parseJsonStrict(text);

  // Validate structure
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Quiz must be a valid JSON object.');
  }

  if (!Array.isArray(parsed.mcq)) {
    throw new Error('Quiz must include "mcq" array.');
  }

  if (!Array.isArray(parsed.trueFalse)) {
    throw new Error('Quiz must include "trueFalse" array.');
  }

  if (!Array.isArray(parsed.shortAnswer)) {
    throw new Error('Quiz must include "shortAnswer" array.');
  }

  if (!Array.isArray(parsed.essay)) {
    throw new Error('Quiz must include "essay" array.');
  }

  // Validate MCQ structure
  for (const mcq of parsed.mcq) {
    if (!mcq.question || !Array.isArray(mcq.options) || mcq.options.length !== 4) {
      throw new Error('Each MCQ must have a question and exactly 4 options.');
    }
    if (typeof mcq.correctIndex !== 'number' || mcq.correctIndex < 0 || mcq.correctIndex > 3) {
      throw new Error('Each MCQ must have a valid correctIndex (0-3).');
    }
  }

  // Validate True/False structure
  for (const tf of parsed.trueFalse) {
    if (!tf.statement || typeof tf.answer !== 'boolean') {
      throw new Error('Each True/False must have a statement and boolean answer.');
    }
  }

  // Validate Short Answer structure
  for (const sa of parsed.shortAnswer) {
    if (!sa.question || !sa.expectedAnswer) {
      throw new Error('Each Short Answer must have a question and expectedAnswer.');
    }
  }

  // Validate Essay structure
  for (const essay of parsed.essay) {
    if (!essay.question || !essay.markingGuide) {
      throw new Error('Each Essay must have a question and markingGuide.');
    }
  }

  return { 
    quiz: parsed, 
    provider, 
    model, 
    task: 'structuredQuiz', 
    timestamp 
  };
}

// ✅ EXPORT ALL FUNCTIONS (existing + new)
module.exports = {
  generateTextCore,
  generateGhanaianLessonNote,
  generateLearnerFriendlyNote,
  generateWaecQuiz,
  getLandingInsights,
  // 🎓 New HTML-based bundle functions
  generateTeacherLessonNoteHTML,
  generateLearnerNoteHTML,
  generateStructuredQuizJSON,
};