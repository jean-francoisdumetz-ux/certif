// CERTIF — fabrique le document complet et affiche les consignes du courriel.
//
// Le Cerfa est le vrai gabarit officiel, réellement rempli. Seul le plan de
// situation reste une page témoin, en attendant PAINT.
//
//   node essais/apercu.js [sortie.pdf]

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { construireDossier, nomFichier } from '../lib/dossier-pdf.js';
import { remplirCerfa } from '../lib/cerfa-cu.js';
import { construireAnnexe } from '../lib/annexe.js';
import { consignes } from '../lib/consignes.js';
import { A4, MM } from '../lib/mise-en-page.js';

// Faux paraphe, fabriqué ici, uniquement pour vérifier l'emplacement. En
// service, la signature vient de lib/sceau.js : le bloc chiffré déposé en
// variable d'environnement, ouvert par la phrase secrète du notaire — jamais
// une image en clair dans le dépôt, c'est la règle posée sur MATRICE. D'où ce
// PNG fabriqué à la volée plutôt qu'un fichier d'essai qui traînerait.
function paraphePourEssai(largeur = 600, hauteur = 200) {
  const pixels = Buffer.alloc(hauteur * (1 + largeur * 4)); // filtre + RGBA
  const point = (x, y) => {
    if (x < 0 || y < 0 || x >= largeur || y >= hauteur) return;
    const i = y * (1 + largeur * 4) + 1 + x * 4;
    pixels[i] = 12; pixels[i + 1] = 20; pixels[i + 2] = 90; pixels[i + 3] = 255;
  };
  const trait = (a, b) => {
    const pas = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let k = 0; k <= pas; k += 1) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * k) / pas);
      const y = Math.round(a[1] + ((b[1] - a[1]) * k) / pas);
      for (let e = -3; e <= 3; e += 1) point(x, y + e);
    }
  };
  const pts = [[20, 150], [120, 40], [200, 160], [300, 50], [420, 140], [560, 60]];
  for (let i = 0; i < pts.length - 1; i += 1) trait(pts[i], pts[i + 1]);

  const morceau = (type, contenu) => {
    const t = Buffer.from(type, 'latin1');
    const longueur = Buffer.alloc(4); longueur.writeUInt32BE(contenu.length);
    const somme = Buffer.alloc(4); somme.writeUInt32BE(crc32(Buffer.concat([t, contenu])) >>> 0);
    return Buffer.concat([longueur, t, contenu, somme]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RVBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    morceau('IHDR', ihdr),
    morceau('IDAT', deflateSync(pixels)),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const octet of buf) c = TABLE_CRC[(c ^ octet) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

process.env.CERTIF_OFFICE_NOM ||= 'FIDAL Notaires';
process.env.CERTIF_OFFICE_ADRESSE ||= '3 place de la Madeleine';
process.env.CERTIF_OFFICE_CP ||= '75008';
process.env.CERTIF_OFFICE_COMMUNE ||= 'Paris';
process.env.CERTIF_OFFICE_SIGNATAIRE ||= 'Jean-François DUMETZ';
process.env.CERTIF_OFFICE_QUALITE ||= 'Notaire associé';
process.env.CERTIF_OFFICE_FORME ||= 'SELAS';
process.env.CERTIF_OFFICE_SIRET ||= '33102277200023';
process.env.CERTIF_OFFICE_COURRIEL ||= 'accueil@fidal.notaires.fr';
process.env.CERTIF_OFFICE_TELEPHONE ||= '01 44 51 01 23';
process.env.CERTIF_OFFICE_SIGNATAIRE_COURRIEL ||= 'jean-francois.dumetz@fidal.notaires.fr';

const { office, demandeurDepuisOffice } = await import('../lib/office.js');

async function temoin(titre, sousTitre, nb = 1) {
  const pdf = await PDFDocument.create();
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < nb; i += 1) {
    const p = pdf.addPage([A4.largeur, A4.hauteur]);
    p.drawRectangle({
      x: 15 * MM, y: 15 * MM, width: A4.largeur - 30 * MM, height: A4.hauteur - 30 * MM,
      borderColor: rgb(0.8, 0.82, 0.85), borderWidth: 1, borderDashArray: [6, 5],
    });
    p.drawText(titre, { x: 28 * MM, y: A4.hauteur / 2 + 10, size: 20, font: gras, color: rgb(0.55, 0.58, 0.62) });
    p.drawText(`${sousTitre}${nb > 1 ? `  (${i + 1}/${nb})` : ''}`,
      { x: 28 * MM, y: A4.hauteur / 2 - 14, size: 11, font: normal, color: rgb(0.55, 0.58, 0.62) });
  }
  return pdf.save();
}

const demande = {
  office: office(),
  demandeur: demandeurDepuisOffice(),
  reference: '2026-0117',
  date: new Date(2026, 7, 18),
  motif: "l’étude de l’origine de propriété d’un ensemble immobilier",
  mairie: {
    nom: 'Mairie de Lomme',
    adresse: '160 rue Sadi Carnot',
    codePostal: '59160',
    commune: 'Lomme',
  },
  terrain: {
    commune: { code: '59355', nom: 'Lomme' },
    adresse: '14 rue du Petit Belgique',
    codePostal: '59160',
    // Cinq parcelles : de quoi éprouver le débord en annexe, qui ne se
    // déclenche qu'au-delà des trois lignes de l'imprimé.
    parcelles: [
      { prefixe: '355', section: 'AB', numero: '0012', contenance: 842 },
      { prefixe: '355', section: 'AB', numero: '0013', contenance: 219 },
      { prefixe: '355', section: 'AB', numero: '0014', contenance: 1330 },
      { prefixe: '355', section: 'AC', numero: '0007', contenance: 96 },
      { prefixe: '355', section: 'AC', numero: '0008', contenance: 2451 },
    ],
  },
};

const images = { signature: paraphePourEssai() };

const cerfa = await remplirCerfa(demande, images);
const annexe = await construireAnnexe(demande);
const plan = await temoin('PLAN DE SITUATION', 'fabrication à brancher sur PAINT', 1);

const { octets, pagination } = await construireDossier({
  demande, cerfa, annexe: annexe?.octets, plan, images,
});

const sortie = process.argv[2] || 'essais/apercu-certif.pdf';
writeFileSync(sortie, octets);

const fichier = nomFichier(demande);
const c = consignes(demande, pagination, fichier);

console.log(`écrit : ${sortie}  (${(octets.length / 1024).toFixed(0)} ko, nom d'envoi : ${fichier})`);
console.log('pagination :', JSON.stringify(pagination));
console.log(`impression : ${pagination.feuilles} feuilles en recto verso, ${pagination.blanches} page(s) blanche(s)`);
console.log('annexe :', annexe ? `${annexe.nombre} parcelles sur ${annexe.pages} page(s)` : 'aucune');
console.log(`\n--- objet ---\n${c.objet}\n--- corps ---\n${c.texte}`);
