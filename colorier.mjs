// CERTIF — la règle de report sur l'extrait officiel, rejouée sur un vrai fichier.
//
// L'essai ne simule rien : il reprend l'extrait de Saint-Omer AV 168 rendu par
// PAINT le 18 août 2026, lit les étiquettes de coordonnées imprimées en marge
// — ce sont du texte, avec leurs positions —, et vérifie que la règle de
// lib/colorier.js les replace là où le service les a dessinées.
//
// C'est la seule vérification possible hors ligne, et c'est la bonne : si la
// règle replace les étiquettes au dixième de point, elle place le contour au
// même endroit.
//
//   node essais/colorier.mjs
import { execFileSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { CADRES, DEBORD, versPage } from '../lib/colorier.js';
import { zoneDepuisY, versConiqueConforme } from '../lib/lambert.js';
import { METRE_PAR_POINT } from '../lib/geo.js';

const FICHIER = 'essais/extrait-saint-omer.pdf';
const ECHELLE = 2000;
const PAGE_HAUTEUR = 842;

let echecs = 0;
const dire = (quoi, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' ÉCHEC'} ${quoi}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs += 1;
};
const proche = (a, b, t) => Math.abs(a - b) <= t;

if (!existsSync(FICHIER)) {
  console.log(`  (${FICHIER} absent — essai ignoré)`);
  process.exit(0);
}

// --- les étiquettes, lues dans le PDF avec leurs positions -------------------
let xml;
try {
  execFileSync('pdftotext', ['-bbox', FICHIER, '/tmp/etiquettes.xml']);
  xml = readFileSync('/tmp/etiquettes.xml', 'utf8');
} catch {
  console.log('  (pdftotext absent — essai ignoré)');
  process.exit(0);
}

const mots = [...xml.matchAll(
  /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
  .map((m) => ({
    x: (parseFloat(m[1]) + parseFloat(m[3])) / 2,
    // pdftotext compte les ordonnées depuis le HAUT ; le PDF depuis le bas.
    y: PAGE_HAUTEUR - (parseFloat(m[2]) + parseFloat(m[4])) / 2,
    t: m[5].trim(),
  }))
  .filter((m) => /^\d{6,8}$/.test(m.t));

dire('huit étiquettes de coordonnées trouvées', mots.length === 8, `${mots.length}`);

// Les abscisses sont portées en haut et en bas (même valeur, deux fois), les
// ordonnées à gauche et à droite. On les distingue par leur ordre de grandeur.
const abscisses = mots.filter((m) => Number(m.t) < 3000000);
const ordonnees = mots.filter((m) => Number(m.t) >= 3000000);
dire('quatre abscisses et quatre ordonnées',
  abscisses.length === 4 && ordonnees.length === 4);

// --- l'échelle réellement servie --------------------------------------------
const xs = [...new Set(abscisses.map((m) => Number(m.t)))].sort((a, b) => a - b);
const paires = abscisses.filter((m) => Number(m.t) === xs[0]);
const autres = abscisses.filter((m) => Number(m.t) === xs[1]);
const pas = Math.abs(autres[0].x - paires[0].x);
const metres = xs[1] - xs[0];
const echelleServie = metres / (pas * METRE_PAR_POINT);
dire(`échelle servie = celle demandée (1/${ECHELLE})`, proche(echelleServie, ECHELLE, 5),
  `1/${Math.round(echelleServie)} — ${metres} m sur ${pas.toFixed(2)} pt`);

// --- la zone, lue sur les ordonnées ------------------------------------------
const ys = [...new Set(ordonnees.map((m) => Number(m.t)))].sort((a, b) => a - b);
const zone = zoneDepuisY(ys[0]);
dire('zone conique lue sur l’ordonnée', zone === 50, `CC${zone} pour Y=${ys[0]}`);

// --- reconstitution de l'emprise, puis vérification de la règle ---------------
// On ne dispose pas de l'en-tête X-Paint-Bbox pour ce fichier : on le
// reconstitue à partir d'une étiquette et du cadre mesuré. Si la règle est
// juste, elle doit alors replacer les TROIS AUTRES étiquettes.
const cadre = CADRES['A4-Portrait'];
const pointParMetre = 1 / (ECHELLE * METRE_PAR_POINT);
const debordSol = DEBORD * ECHELLE;

const reference = abscisses.find((m) => Number(m.t) === xs[0]);
const referenceY = ordonnees.find((m) => Number(m.t) === ys[0]);
const bbox = {
  xMin: xs[0] - (reference.x - cadre.x) / pointParMetre - debordSol,
  yMin: ys[0] - (referenceY.y - cadre.y) / pointParMetre - debordSol,
};
bbox.xMax = bbox.xMin + (cadre.largeur / pointParMetre) + 2 * debordSol;
bbox.yMax = bbox.yMin + (cadre.hauteur / pointParMetre) + 2 * debordSol;

console.log(`\n  emprise reconstituée : ${bbox.xMin.toFixed(1)}, ${bbox.yMin.toFixed(1)}, `
  + `${bbox.xMax.toFixed(1)}, ${bbox.yMax.toFixed(1)}`);
console.log(`  cadre mesuré : ${cadre.largeur.toFixed(1)} × ${cadre.hauteur.toFixed(1)} pt `
  + `= ${(cadre.largeur * METRE_PAR_POINT * 1000).toFixed(1)} × `
  + `${(cadre.hauteur * METRE_PAR_POINT * 1000).toFixed(1)} mm\n`);

let pire = 0;
for (const m of [...abscisses, ...ordonnees]) {
  const estAbscisse = Number(m.t) < 3000000;
  const p = versPage(
    { X: estAbscisse ? Number(m.t) : bbox.xMin + debordSol, Y: estAbscisse ? bbox.yMin + debordSol : Number(m.t) },
    { bbox, echelle: ECHELLE, cadre },
  );
  const attendu = estAbscisse ? m.x : m.y;
  const obtenu = estAbscisse ? p.x : p.y;
  pire = Math.max(pire, Math.abs(attendu - obtenu));
  dire(`étiquette ${m.t} replacée`, proche(obtenu, attendu, 0.6),
    `${obtenu.toFixed(2)} pour ${attendu.toFixed(2)} pt`);
}
console.log(`\n  écart maximal : ${pire.toFixed(3)} pt, soit ${(pire * METRE_PAR_POINT * ECHELLE * 100).toFixed(1)} cm au sol`);

// --- la projection tombe-t-elle dans la bonne planche ? -----------------------
// Saint-Omer est autour de 50,750 N / 2,252 E. On ne vérifie pas une valeur
// exacte — on n'en a pas — mais que le point projeté tombe dans l'emprise de
// l'extrait, ce qui n'arriverait pas si la zone ou la formule était fausse.
const p = versConiqueConforme(50.7503, 2.2522, zone);
dire('Saint-Omer projeté dans la bonne planche',
  p && Math.abs(p.X - (bbox.xMin + bbox.xMax) / 2) < 3000
    && Math.abs(p.Y - (bbox.yMin + bbox.yMax) / 2) < 3000,
  p ? `X ${p.X.toFixed(0)} Y ${p.Y.toFixed(0)}` : 'null');

console.log(`\n${echecs === 0 ? 'tout passe' : `${echecs} échec(s)`}`);
process.exit(echecs === 0 ? 0 : 1);
