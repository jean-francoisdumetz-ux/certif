// CERTIF — la mise en page du plan de situation, éprouvée hors ligne.
//
// Les deux sources extérieures sont remplacées : des contours connus, et des
// tuiles fabriquées ici, chacune portant ses indices en clair. Cela vérifie ce
// qui ne se déduit pas — l'orientation des axes, le recouvrement du cadre, la
// place des parcelles sur la carte.
//
//   node essais/plan.mjs [sortie.pdf]
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { construirePlanSituation } from '../lib/plan-situation.js';

process.env.CERTIF_OFFICE_NOM ||= 'FIDAL Notaires';
process.env.CERTIF_OFFICE_ADRESSE ||= '3 place de la Madeleine';
process.env.CERTIF_OFFICE_CP ||= '75008';
process.env.CERTIF_OFFICE_COMMUNE ||= 'Paris';
process.env.CERTIF_OFFICE_SIGNATAIRE ||= 'Jean-François DUMETZ';

/* --- une tuile fabriquée : damier pâle, coin marqué, pour voir l'assemblage --- */
const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (const o of buf) c = TABLE_CRC[(c ^ o) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
function png(dessiner, cote = 256) {
  const pixels = Buffer.alloc(cote * (1 + cote * 3), 255);
  for (let y = 0; y < cote; y += 1) {
    for (let x = 0; x < cote; x += 1) {
      const [r, v, b] = dessiner(x, y);
      const i = y * (1 + cote * 3) + 1 + x * 3;
      pixels[i] = r; pixels[i + 1] = v; pixels[i + 2] = b;
    }
  }
  const morceau = (type, contenu) => {
    const t = Buffer.from(type, 'latin1');
    const l = Buffer.alloc(4); l.writeUInt32BE(contenu.length);
    const s = Buffer.alloc(4); s.writeUInt32BE(crc32(Buffer.concat([t, contenu])) >>> 0);
    return Buffer.concat([l, t, contenu, s]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cote, 0); ihdr.writeUInt32BE(cote, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    morceau('IHDR', ihdr), morceau('IDAT', deflateSync(pixels)), morceau('IEND', Buffer.alloc(0)),
  ]);
}

const tuileTemoin = async (col, rang, zoom, fond) => ({
  ok: true,
  octets: png((x, y) => {
    // Bord haut et bord gauche marqués : on voit l'orientation de chaque tuile.
    if (y < 3) return [200, 60, 60];
    if (x < 3) return [60, 90, 200];
    const damier = (Math.floor(x / 32) + Math.floor(y / 32) + col + rang) % 2;
    return damier ? [246, 246, 242] : [232, 234, 228];
  }),
});

/* --- un terrain connu : deux parcelles voisines, l'une nettement au nord --- */
const ANNEAUX = [
  [[3.0560, 50.6285], [3.0568, 50.6285], [3.0568, 50.6290], [3.0560, 50.6290], [3.0560, 50.6285]],
  [[3.0560, 50.6296], [3.0564, 50.6296], [3.0564, 50.6301], [3.0560, 50.6301], [3.0560, 50.6296]],
];

const cadastreTemoin = async () => ({
  parcelles: [
    { designation: '355 AB 0012', contenance: 842 },
    { designation: '355 AB 0013', contenance: 219 },
  ],
  anneaux: ANNEAUX,
  journal: [{ parcelle: '355 AB 0012', resultat: 'témoin' }],
});

const demande = {
  reference: '2026-0117',
  terrain: {
    commune: { code: '59355', nom: 'Lomme', chefLieu: '59350' },
    adresse: '14 rue du Petit Belgique',
    parcelles: [
      { prefixe: '355', section: 'AB', numero: '0012', contenance: 842 },
      { prefixe: '355', section: 'AB', numero: '0013', contenance: 219 },
    ],
  },
};

const r = await construirePlanSituation(demande, {
  chargerTuile: tuileTemoin,
  chercherGeometries: cadastreTemoin,
});

if (r.erreur) { console.error('ÉCHEC :', r.erreur); process.exit(1); }

const sortie = process.argv[2] || 'essais/apercu-plan.pdf';
writeFileSync(sortie, Buffer.from(r.octets));
console.log(`écrit : ${sortie}`);
console.log(`échelle 1/${r.echelle} · zoom ${r.zoom} · tuiles ${r.tuiles.obtenues}/${r.tuiles.demandees}`);
