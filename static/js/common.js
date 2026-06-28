/* ===== common.js — utilitaires partagés host + student ===== */

// API sur la même origine que la page (test->test, prod->prod)
const API = window.location.origin;

// Échappe le HTML pour prévenir les injections (prénoms, etc.)
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
