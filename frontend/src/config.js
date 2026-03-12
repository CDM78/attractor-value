// In dev, proxy through Vite (same origin)
// In production, call the Worker directly via its workers.dev URL
export const API_BASE = import.meta.env.DEV
  ? ''
  : 'https://odieseyeball.com';
