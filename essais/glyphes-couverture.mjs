// Quels caractères les polices du projet dessinent-elles RÉELLEMENT ?
//
// pdf-lib ne se plaint pas d'un caractère qu'il ne sait pas rendre : il le
// laisse tomber, et la page sort avec un trou. Avec les polices de base du
// format, « 1 061 m² » devenait « 1 061 m ». Aucune exception, aucun
// avertissement — le pire cas.
//
// On ne raisonne donc pas sur une table théorique : on dessine chaque
// caractère seul dans une case, on rend l'image, et on regarde s'il y a de
// l'encre. Le résultat est recopié en dur dans lib/mise-en-page.js.
//
//   node essais/glyphes-couverture.mjs        (avec Segoe UI si elle est là)
//   CERTIF_SANS_POLICES=1 node essais/…       (pour éprouver le repli)
import { PDFDocument } from 'pdf-lib';
import { writeFileSync } from 'fs';
import { fontes, polices, A4 } from '../lib/mise-en-page.js';

const CANDIDATS = [];
for (let c = 0x20; c <= 0xFF; c += 1) CANDIDATS.push(String.fromCharCode(c));
for (const c of '€‘’“”‚„–—†‡•…‰‹›ŒœŠšŸŽžƒˆ˜™№₂½¼¾×÷≤≥→') CANDIDATS.push(c);

const CASE = 24, COLONNES = 16;
const pdf = await PDFDocument.create();
const f = await fontes(pdf);
const roles = ['romain', 'romainGras', 'romainItalique', 'sans', 'sansGras'];
const lignes = Math.ceil(CANDIDATS.length / COLONNES);

for (const role of roles) {
  const page = pdf.addPage([COLONNES * CASE, lignes * CASE]);
  CANDIDATS.forEach((ch, i) => {
    const col = i % COLONNES, lig = Math.floor(i / COLONNES);
    try {
      page.drawText(ch, {
        x: col * CASE + 6, y: (lignes - lig - 1) * CASE + 7, size: 15, font: f[role],
      });
    } catch { /* refus explicite : l'analyse d'image le notera comme absent */ }
  });
}

writeFileSync('essais/couverture.pdf', await pdf.save());
writeFileSync('essais/couverture.json', JSON.stringify({
  maison: Boolean(f.maison), polices: polices(),
  candidats: CANDIDATS.map((c) => c.codePointAt(0)),
  case: CASE, colonnes: COLONNES, lignes, roles,
}));
console.log(`${CANDIDATS.length} caractères, ${roles.length} rôles, polices maison : ${f.maison}`);
