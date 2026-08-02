/**
 * RAAHAT Firebase Cloud Functions
 *
 * Powered by Google Gemini AI (gemini-2.0-flash)
 * Bug fixes applied:
 *  - triageRequest now declares GEMINI_API_KEY secret (was silently skipped before)
 *  - triageRequest skips safe_report marker documents (avoid wasted AI calls)
 *  - All functions use a shared callGemini() helper
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { findBestResourceMatch } = require('./resourceMatching');

admin.initializeApp();

// ─── Shared Gemini Helper ────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-2.0-flash';

async function callGemini(apiKey, systemPrompt, userContent, maxTokens = 400) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.1  // Low temperature for consistent structured output
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');

  // Strip markdown code fences if Gemini wraps the JSON
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

// ─── 1. AI Auto-Triage ───────────────────────────────────────────────────────
// Triggered when a new SOS request document is created in Firestore.
// Classifies priority and extracts flags using Gemini AI.

const TRIAGE_SYSTEM_PROMPT = `You are a triage assistant for a flood disaster response system.
You will be given a citizen's self-reported situation, headcount, and free-text notes.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "priority": "critical" | "high" | "normal",
  "flags": string[],
  "summary": string
}

Rules:
- "critical": life-threatening right now (medical emergency, rising water with no escape, trapped, structural collapse risk).
- "high": urgent but not immediately life-threatening (vulnerable people present, running out of essential supplies, injury that isn't acute).
- "normal": needs help but stable for now.
- "flags": only include ones actually indicated by the text — choose from: medical_emergency, elderly, children, pregnant, disabled, no_supplies, structural_danger. Empty array if none apply. Never invent flags not supported by the text.
- "summary": one plain-language sentence, under 20 words, for a responder scanning a list fast.
- Base this only on what's stated. Do not guess at details not mentioned.`;

// BUG FIX 1: Added { secrets: ['GEMINI_API_KEY'] } — without this the secret
//            was never injected and AI triage was silently skipped on every SOS.
// BUG FIX 2: Skip safe_report marker documents created by the "I'm Safe" button.
// Renamed from triageRequest → autoTriageSOS to avoid type-conflict with old deployment.
exports.autoTriageSOS = onDocumentCreated(
  { document: 'requests/{requestId}', secrets: ['GEMINI_API_KEY'] },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const data = snapshot.data();

    // BUG FIX 2: Skip non-SOS marker documents (e.g. safe_report created by citizen app)
    if (data.type === 'safe_report') {
      console.log(`Skipping safe_report document: ${event.params.requestId}`);
      return;
    }

    // Also skip if already triaged (e.g. dashboard fallback already ran)
    if (data.ai_priority) {
      console.log(`Request ${event.params.requestId} already triaged. Skipping.`);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('No GEMINI_API_KEY set. Skipping AI triage.');
      return;
    }

    const userContent = [
      `Situation category: ${data.situation}`,
      `People affected: ${data.people_count || 1}`,
      `Notes: ${data.notes || '(none provided)'}`
    ].join('\n');

    try {
      const raw = await callGemini(apiKey, TRIAGE_SYSTEM_PROMPT, userContent, 300);
      const parsed = JSON.parse(raw);

      const aiPriority = parsed.priority || 'normal';
      const aiFlags = parsed.flags || [];
      const aiSummary = parsed.summary || '';
      const nowStr = new Date().toISOString();

      const updatePayload = {
        ai_priority: aiPriority,
        ai_flags: aiFlags,
        ai_summary: aiSummary,
        ai_processed_at: nowStr,
        ai_engine: 'gemini-2.0-flash'
      };

      // Query available resources from Firestore to perform automatic assignment
      const db = admin.firestore();
      const resSnap = await db.collection('resources').get();
      const availableResources = [];
      resSnap.forEach((d) => availableResources.push({ id: d.id, ...d.data() }));

      const { resource: bestRes } = findBestResourceMatch(
        { ...data, ai_priority: aiPriority, ai_flags: aiFlags },
        availableResources
      );

      if (bestRes) {
        updatePayload.assigned_resource_id = bestRes.id || bestRes.name;
        updatePayload.assigned_resource_name = bestRes.name;
        updatePayload.assigned_at = nowStr;
        updatePayload.status = 'team_assigned';

        // Update matched resource status to busy
        try {
          if (bestRes.id) {
            await db.collection('resources').doc(bestRes.id).update({
              availability: 'busy',
              status: `Dispatched to rescue ${data.name || 'citizen'}`
            });
          }
        } catch (resErr) {
          console.warn('Resource status update failed during auto-assignment:', resErr.message);
        }
      }

      await snapshot.ref.update(updatePayload);
      console.log(`Triaged ${event.params.requestId} → ${aiPriority} (Assigned: ${bestRes ? bestRes.name : 'None'})`);
    } catch (err) {
      console.error('AI triage error:', err.message);
    }
  }
);

// ─── 2. Decision Support Engine ──────────────────────────────────────────────
// Called by dashboard to generate command-center AI recommendations.

exports.generateDecisionSupport = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'GEMINI_API_KEY not set.');

    const { metrics } = request.data;

    const systemPrompt = `You are the RAAHAT AI Disaster Command Decision Engine.
Analyze the provided disaster command metrics and output ONLY a JSON object (no markdown, no extra text) in this exact format:
{
  "overallSeverity": "STABLE" | "HIGH" | "CRITICAL",
  "priorityArea": "Name of the area needing most urgent attention",
  "summary": "2-3 sentence overview of active incidents and current capacity status",
  "recommendedActions": [
    "Specific action recommendation 1",
    "Specific action recommendation 2",
    "Specific action recommendation 3"
  ],
  "confidence": 91
}`;

    try {
      const raw = await callGemini(apiKey, systemPrompt, JSON.stringify(metrics), 500);
      return JSON.parse(raw);
    } catch (err) {
      console.error('generateDecisionSupport error:', err.message);
      throw new HttpsError('internal', err.message || 'AI decision support failed.');
    }
  }
);

// ─── 3. Recommendation Explainer ─────────────────────────────────────────────
// Explains why a specific hospital, shelter, and resource were recommended for an SOS.

exports.explainRecommendations = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'GEMINI_API_KEY not set.');

    const { sosRequest, hospital, shelter, resource } = request.data;

    const systemPrompt = `You are the RAAHAT AI Disaster Coordinator.
Explain why the recommended Hospital, Shelter, and Rescue Resource are the best match for the given citizen SOS request.
Return ONLY a JSON object (no markdown, no extra text) in this exact format:
{
  "hospitalExplanation": "1-2 sentence explanation of why this hospital was selected.",
  "shelterExplanation": "1-2 sentence explanation of why this shelter was selected.",
  "resourceExplanation": "1-2 sentence explanation of why this rescue resource was matched."
}`;

    try {
      const raw = await callGemini(
        apiKey, systemPrompt,
        JSON.stringify({ sosRequest, hospital, shelter, resource }),
        500
      );
      return JSON.parse(raw);
    } catch (err) {
      console.error('explainRecommendations error:', err.message);
      throw new HttpsError('internal', err.message || 'AI explanation failed.');
    }
  }
);

// ─── 4. Situation Report (SITREP) Generator ──────────────────────────────────
// Generates a full professional command-center situation report in Markdown.

exports.generateSituationReport = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'GEMINI_API_KEY not set.');

    const { metrics, activeIncidents } = request.data;

    const systemPrompt = `You are a Senior Crisis Responder writing a formal, professional Command Center Situation Report (SITREP) in Markdown.
Write a clear, structured report based on the provided metrics and active incidents.
Include these sections:
1. Executive Summary (Overall Severity, key metrics)
2. Active Incidents and Triage Status
3. Critical Needs & Affected Population
4. Hospital Capacity & Shelter Logistical Status
5. Recommended Command Actions & Resource Relocation

Use professional command-center terminology. Write in Markdown. Output ONLY the Markdown report, no other text.`;

    try {
      const text = await callGemini(
        apiKey, systemPrompt,
        JSON.stringify({ metrics, activeIncidents }),
        1200
      );
      return { report: text };
    } catch (err) {
      console.error('generateSituationReport error:', err.message);
      throw new HttpsError('internal', err.message || 'AI situation report failed.');
    }
  }
);

// ─── 5. Predictive Flood Early-Warning Backend Job ──────────────────────────
// Configurable threshold defaults (adjustable)
const PRECIP_ELEVATED = 15;   // 15mm 2-day forecast
const PRECIP_SEVERE = 40;     // 40mm 2-day forecast
const DISCHARGE_ELEVATED = 50; // 50 m³/s river discharge
const DISCHARGE_SEVERE = 120;  // 120 m³/s river discharge

/**
 * Pure deterministic risk classifier based on Open-Meteo forecast data.
 */
function classifyFloodRisk(precipMax, dischargeMax, dischargeTrendingUp) {
  if (precipMax >= PRECIP_SEVERE || dischargeMax >= DISCHARGE_SEVERE) {
    return 'severe';
  }
  if (precipMax >= PRECIP_ELEVATED || dischargeMax >= DISCHARGE_ELEVATED || (dischargeMax > 30 && dischargeTrendingUp)) {
    return 'elevated';
  }
  return 'normal';
}

exports.checkFloodRisk = onSchedule(
  { schedule: 'every 3 hours', secrets: ['GEMINI_API_KEY'] },
  async (event) => {
    console.log('Running checkFloodRisk scheduled backend job...');
    const db = admin.firestore();

    // 1. Gather monitored zones from existing Firestore collections (hospitals, shelters, resources)
    const monitoredZones = [];
    try {
      const [hospSnap, sheltSnap, resSnap] = await Promise.all([
        db.collection('hospitals').get(),
        db.collection('shelters').get(),
        db.collection('resources').get()
      ]);

      const seenCoords = new Set();
      const addZone = (id, name, lat, lng, type) => {
        if (!lat || !lng) return;
        const coordKey = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
        if (seenCoords.has(coordKey)) return;
        seenCoords.add(coordKey);
        monitoredZones.push({
          id: id || name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          name: name || 'Monitored Zone',
          lat: Number(lat),
          lng: Number(lng),
          type
        });
      };

      hospSnap.forEach(d => {
        const data = d.data();
        addZone(d.id, data.name, data.latitude || data.lat, data.longitude || data.lng, 'hospital');
      });
      sheltSnap.forEach(d => {
        const data = d.data();
        addZone(d.id, data.name, data.latitude || data.lat, data.longitude || data.lng, 'shelter');
      });
      resSnap.forEach(d => {
        const data = d.data();
        addZone(d.id, data.name, data.latitude || data.lat, data.longitude || data.lng, 'resource');
      });
    } catch (err) {
      console.error('Error fetching monitored infrastructure from Firestore:', err.message);
    }

    // Fallback default zones if Firestore infrastructure is empty
    if (monitoredZones.length === 0) {
      monitoredZones.push(
        { id: 'zone_kurla_east', name: 'Kurla East Sector', lat: 20.5933, lng: 78.9628, type: 'general' },
        { id: 'zone_north_station', name: 'North Station Sector', lat: 20.6020, lng: 78.9750, type: 'general' },
        { id: 'zone_river_basin', name: 'Central River Basin', lat: 20.5850, lng: 78.9550, type: 'general' }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const nowStr = new Date().toISOString();

    // 2. Fetch Open-Meteo forecasts for each zone & evaluate risk
    for (const zone of monitoredZones) {
      let precipMax = 0;
      let dischargeMax = 0;
      let dischargeTrendingUp = false;

      try {
        // Fetch weather / precipitation forecast
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${zone.lat}&longitude=${zone.lng}&hourly=precipitation&forecast_days=2`;
        const weatherRes = await fetch(weatherUrl);
        if (weatherRes.ok) {
          const weatherData = await weatherRes.json();
          const precipArray = weatherData.hourly?.precipitation || [];
          if (precipArray.length > 0) {
            precipMax = Math.max(...precipArray);
          }
        }

        // Fetch flood / river discharge forecast
        const floodUrl = `https://flood-api.open-meteo.com/v1/flood?latitude=${zone.lat}&longitude=${zone.lng}&daily=river_discharge&forecast_days=3`;
        const floodRes = await fetch(floodUrl);
        if (floodRes.ok) {
          const floodData = await floodRes.json();
          const dischargeArray = floodData.daily?.river_discharge || [];
          if (dischargeArray.length > 0) {
            dischargeMax = Math.max(...dischargeArray.filter(v => typeof v === 'number'));
            if (dischargeArray.length >= 2) {
              dischargeTrendingUp = dischargeArray[dischargeArray.length - 1] > dischargeArray[0];
            }
          }
        }
      } catch (apiErr) {
        console.warn(`Open-Meteo API fetch error for ${zone.name}:`, apiErr.message);
      }

      // 3. Apply pure deterministic risk classifier
      const riskLevel = classifyFloodRisk(precipMax, dischargeMax, dischargeTrendingUp);
      let aiWarningText = '';

      // 4. Generate AI plain-language warning for elevated/severe zones
      if ((riskLevel === 'elevated' || riskLevel === 'severe') && apiKey) {
        const systemPrompt = `You are the RAAHAT Disaster Early Warning Specialist.
Given forecast numbers for a monitored zone, output ONLY a 2-3 sentence clear, objective public flood warning.
State the zone name, cited peak precipitation (mm) or river discharge (m³/s), and recommended precautionary action.
Do NOT invent fake locations or details not provided. Output plain text only.`;

        const userPrompt = `Zone: ${zone.name}\nCoordinates: ${zone.lat}, ${zone.lng}\nCalculated Risk Level: ${riskLevel.toUpperCase()}\nPeak 48h Precipitation: ${precipMax.toFixed(1)} mm\nPeak 72h River Discharge: ${dischargeMax.toFixed(1)} m³/s\nDischarge Trending Up: ${dischargeTrendingUp}`;

        try {
          aiWarningText = await callGemini(apiKey, systemPrompt, userPrompt, 200);
        } catch (aiErr) {
          console.warn(`AI warning generation failed for ${zone.name}:`, aiErr.message);
          aiWarningText = `ALERT (${riskLevel.toUpperCase()}): Flood forecast indicates peak precipitation of ${precipMax.toFixed(1)}mm and river discharge of ${dischargeMax.toFixed(1)} m³/s in ${zone.name}. Please stay vigilant and monitor emergency channels.`;
        }
      } else if (riskLevel === 'normal') {
        aiWarningText = `Conditions normal for ${zone.name}. Peak forecast precipitation: ${precipMax.toFixed(1)}mm, river discharge: ${dischargeMax.toFixed(1)} m³/s.`;
      }

      // 5. Overwrite/update deterministic doc in flood_warnings collection
      const docId = `zone_${zone.id || zone.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      try {
        await db.collection('flood_warnings').doc(docId).set({
          zone_id: docId,
          zone_name: zone.name,
          lat: zone.lat,
          lng: zone.lng,
          zone_type: zone.type,
          risk_level: riskLevel,
          raw_forecast: {
            precip_max_mm: Number(precipMax.toFixed(1)),
            discharge_max_m3s: Number(dischargeMax.toFixed(1)),
            discharge_trending_up: dischargeTrendingUp
          },
          ai_warning_text: aiWarningText,
          updated_at: nowStr
        }, { merge: true });
        console.log(`Updated flood warning for ${zone.name}: ${riskLevel}`);
      } catch (writeErr) {
        console.error(`Error saving flood warning doc for ${zone.name}:`, writeErr.message);
      }
    }
  }
);

