/* ===== common.js — utilitaires partagés host + student ===== */

// API sur la même origine que la page (test->test, prod->prod)
const API = window.location.origin;

// Échappe le HTML pour prévenir les injections (prénoms, etc.)
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


// ===== Avatars robots deterministes (salles d'attente) =====

// hashName : transforme un pseudo en entier positif stable.
// h * 31 + code : multiplicateur classique pour bien disperser les valeurs.
// >>> 0 force un entier 32 bits non signe (donc toujours positif).
function hashName(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// robotSVG : petit robot en SVG inline, construit depuis le hash du pseudo.
// On decoupe le hash en "tranches de bits" avec >>> : chaque tranche choisit
// une caracteristique (couleur, yeux, bouche, antenne).
// Meme pseudo = meme hash = meme robot, partout, sans stockage ni API externe.
// 6 couleurs x 3 yeux x 3 bouches x 2 antennes = 108 robots possibles.
function robotSVG(pseudo) {
  const colors = ['#7c6aff', '#22d98a', '#ff9f43', '#378add', '#d4537e', '#ffd166'];
  const h = hashName(pseudo);
  const color = colors[h % colors.length];
  const eyes = (h >>> 3) % 3;
  const mouth = (h >>> 6) % 3;
  const antenna = (h >>> 9) % 2;
  const dark = '#0f0f13';

  const eyeShapes = [
    `<circle cx="24" cy="30" r="4.5" fill="${dark}"/><circle cx="40" cy="30" r="4.5" fill="${dark}"/>`,
    `<rect x="19" y="25" width="9" height="9" rx="2" fill="${dark}"/><rect x="36" y="25" width="9" height="9" rx="2" fill="${dark}"/>`,
    `<path d="M19 31 q5 -7 10 0" stroke="${dark}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M35 31 q5 -7 10 0" stroke="${dark}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
  ];
  const mouthShapes = [
    `<path d="M24 43 q8 7 16 0" stroke="${dark}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    `<line x1="25" y1="44" x2="39" y2="44" stroke="${dark}" stroke-width="3.5" stroke-linecap="round"/>`,
    `<rect x="27" y="40" width="10" height="8" rx="3.5" fill="${dark}"/>`
  ];
  const ant = antenna
    ? `<line x1="32" y1="12" x2="32" y2="5" stroke="${color}" stroke-width="3"/><circle cx="32" cy="4" r="3.5" fill="${color}"/>`
    : '';

  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${ant}`
    + `<rect x="2" y="26" width="6" height="14" rx="3" fill="${color}"/>`
    + `<rect x="56" y="26" width="6" height="14" rx="3" fill="${color}"/>`
    + `<rect x="8" y="12" width="48" height="44" rx="14" fill="${color}"/>`
    + eyeShapes[eyes] + mouthShapes[mouth] + `</svg>`;
}
