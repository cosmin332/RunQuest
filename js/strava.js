// ============================================================
// RunQuest — synchronisation Strava (API v3, OAuth côté client)
//
// Prérequis : créer une app sur https://www.strava.com/settings/api
// et renseigner Client ID + Client Secret dans Réglages.
// Le « Authorization Callback Domain » de l'app Strava doit être le domaine
// où RunQuest est hébergée (ex. tonpseudo.github.io, ou localhost pour tester).
// ============================================================

import { getState, setState } from './db.js';
import { normalizeSport } from './parsers.js';

const AUTH_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';

function creds() {
  const s = getState('settings', {});
  return { id: s.stravaClientId, secret: s.stravaClientSecret };
}

export function isConfigured() {
  const { id, secret } = creds();
  return !!(id && secret);
}

export function isConnected() {
  const t = getState('strava', {});
  return !!t.refreshToken;
}

export function athlete() {
  return getState('strava', {})?.athlete || null;
}

export function lastSync() {
  return getState('strava', {})?.lastSync || null;
}

// Redirige vers l'écran d'autorisation Strava
export function startAuth() {
  const { id } = creds();
  const redirect = location.origin + location.pathname;
  const url = `${AUTH_URL}?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(redirect)}`
    + `&response_type=code&approval_prompt=auto&scope=read,activity:read_all`;
  location.href = url;
}

// À appeler au chargement : si ?code= est présent, échange le code contre des tokens.
export async function handleAuthCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return false;
  history.replaceState(null, '', location.pathname); // nettoie l'URL
  const { id, secret } = creds();
  if (!id || !secret) throw new Error('Client ID/Secret Strava manquants dans Réglages');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, code, grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error(`Échange du code refusé par Strava (${res.status})`);
  const data = await res.json();
  setState('strava', {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athlete: data.athlete ? { id: data.athlete.id, name: `${data.athlete.firstname || ''} ${data.athlete.lastname || ''}`.trim(), avatar: data.athlete.profile_medium } : null,
    lastSync: getState('strava', {})?.lastSync || null,
  });
  return true;
}

async function freshToken() {
  const t = getState('strava', {});
  if (!t.refreshToken) throw new Error('Non connecté à Strava');
  if (t.accessToken && t.expiresAt && t.expiresAt * 1000 > Date.now() + 5 * 60000) return t.accessToken;
  const { id, secret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: t.refreshToken, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`Rafraîchissement du token refusé (${res.status})`);
  const data = await res.json();
  setState('strava', { ...t, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at });
  return data.access_token;
}

function normalizeApiActivity(a) {
  return {
    id: `strava-${a.id}`,
    source: 'strava-api',
    date: a.start_date,
    name: a.name,
    sport: normalizeSport(a.sport_type === 'Run' ? 'run' : a.sport_type) || (a.sport_type === 'Run' ? 'run' : 'other'),
    distance: a.distance,
    movingTime: a.moving_time,
    elapsedTime: a.elapsed_time,
    avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    maxHr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    cadence: a.average_cadence ? Math.round(a.average_cadence * 2) : null, // Strava donne des tours/min
    elevGain: a.total_elevation_gain,
    calories: a.kilojoules ? Math.round(a.kilojoules / 4.184) : null,
    effort: a.suffer_score || null,
    gear: null,
    hrSeries: null,
  };
}

// Récupère les activités depuis la dernière sync (ou 1 an par défaut).
export async function syncActivities() {
  const token = await freshToken();
  const t = getState('strava', {});
  const after = t.lastSync ? Math.floor(t.lastSync / 1000) - 3600 : Math.floor(Date.now() / 1000) - 365 * 86400;
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) throw new Error('Limite de requêtes Strava atteinte, réessaie dans 15 min');
    if (!res.ok) throw new Error(`Erreur API Strava (${res.status})`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  setState('strava', { ...getState('strava', {}), lastSync: Date.now() });
  return all.map(normalizeApiActivity);
}

export function disconnect() {
  const t = getState('strava', {});
  setState('strava', { lastSync: t.lastSync || null });
}
