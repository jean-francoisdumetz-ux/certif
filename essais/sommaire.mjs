// CERTIF — épreuve du sommaire, en PDF et en tableur
//
// Le sommaire est le seul document que CERTIF produise POUR L'ÉTUDE et non pour
// une mairie. Ce qu'il doit garantir : une ligne par parcelle, la référence de
// la demande en face de chacune, et un tableur qui s'ouvre vraiment dans Excel —
// un classeur mal formé ne se voit qu'à l'ouverture, chez quelqu'un d'autre.
//
//   node essais/sommaire.mjs

import { writeFileSync } from 'fs';
import { construireSommaire, lignesDuSommaire } from '../lib/sommaire.js';
import { construireTableur, reference } from '../lib/tableur.js';

let echecs = 0;
const verifier = (intitule, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'} ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
};

const LOT = {
  reference: '15151',
  date: new Date('2026-08-18T00:00:00Z'),
  demandes: [
    {
      reference: '15151/1-1',
      commune: 'Villeneuve-d’Ascq',
      mairie: '1 place Salvador Allende 59650 Villeneuve-d’Ascq',
      parcelles: [
        { prefixe: '', section: 'NL', numero: '113', contenance: 1429, lieudit: '11 all du Tennis' },
        { prefixe: '', section: 'NL', numero: '117', contenance: 2370, lieudit: '1 all Turenne' },
      ],
    },
    {
      reference: '15151/1-2',
      commune: 'Villeneuve-d’Ascq',
      mairie: '1 place Salvador Allende 59650 Villeneuve-d’Ascq',
      parcelles: [{ prefixe: '', section: 'ZC', numero: '0294', contenance: 858, lieudit: 'Le Grand Clos' }],
    },
    {
      reference: '15151/2-1',
      commune: 'Lomme',
      mairie: '160 rue Sadi Carnot 59160 Lomme',
      parcelles: [{ prefixe: '355', section: 'AB', numero: '12', contenance: 842, lieudit: '' }],
    },
  ],
};

console.log('\n— les lignes —');
{
  const lignes = lignesDuSommaire(LOT);
  verifier('une ligne par parcelle', lignes.length === 4, `${lignes.length}`);
  verifier('la référence suit la parcelle',
    lignes.map((l) => l.demande).join(' ') === '15151/1-1 15151/1-1 15151/1-2 15151/2-1',
    lignes.map((l) => l.demande).join(' '));
  verifier('les zéros de tête tombent', lignes[2].numero === '294', lignes[2].numero);
  verifier('le préfixe 000 ne s’écrit pas', lignes[0].prefixe === '');
  verifier('celui de Lomme, si', lignes[3].prefixe === '355');
  verifier('la contenance reste un nombre', lignes[0].contenance === 1429);
  verifier('et se lit aussi en ha-a-ca', lignes[0].surface === '0 ha 14 a 29 ca', lignes[0].surface);
  verifier('chaque ligne porte sa mairie', lignes[3].mairie.includes('Sadi Carnot'));
}

console.log('\n— le PDF —');
{
  const r = await construireSommaire(LOT);
  verifier('une page suffit pour quatre parcelles', r.pages === 1, `${r.pages}`);
  verifier('quatre lignes annoncées', r.lignes === 4);
  verifier('le fichier n’est pas vide', r.octets.length > 2000, `${r.octets.length} octets`);
  writeFileSync('essais/apercu-sommaire.pdf', Buffer.from(r.octets));

  // À l'italienne : la largeur doit dépasser la hauteur.
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(r.octets);
  const { width, height } = doc.getPages()[0].getSize();
  verifier('à l’italienne', width > height, `${Math.round(width)} × ${Math.round(height)}`);
}

console.log('\n— le tableur —');
{
  verifier('références de cellules', reference(0, 0) === 'A1' && reference(26, 2) === 'AA3');

  const octets = construireTableur({
    nom: 'Sommaire',
    colonnes: [{ titre: 'Commune', largeur: 22 }, { titre: 'Contenance', largeur: 14 }],
    lignes: [['Villeneuve-d’Ascq', 1429], ['Lomme', 842]],
  });
  verifier('le classeur est une archive ZIP',
    octets[0] === 0x50 && octets[1] === 0x4B, `${octets[0]} ${octets[1]}`);

  // On le relit avec NOTRE propre lecteur : ce qui s'écrit doit se relire.
  const { depuisTableur } = await import('../lib/import-parcelles.js');
  const relu = await depuisTableur(octets);
  verifier('relu par CERTIF lui-même', Array.isArray(relu.lignes) && relu.lignes.length === 3,
    `${relu.lignes?.length} ligne(s)`);
  verifier('l’en-tête est là', relu.lignes[0][0] === 'Commune', relu.lignes[0][0]);
  verifier('les nombres restent des nombres', relu.lignes[1][1] === '1429', relu.lignes[1][1]);
  verifier('les apostrophes courbes survivent',
    relu.lignes[1][0] === 'Villeneuve-d’Ascq', relu.lignes[1][0]);

  // Deux classeurs au même contenu doivent être identiques : sans date fixe, ils
  // différeraient d'un octet à chaque seconde, et rien ne serait comparable.
  const bis = construireTableur({
    nom: 'Sommaire',
    colonnes: [{ titre: 'Commune', largeur: 22 }, { titre: 'Contenance', largeur: 14 }],
    lignes: [['Villeneuve-d’Ascq', 1429], ['Lomme', 842]],
  });
  verifier('reproductible à l’octet près',
    Buffer.from(octets).equals(Buffer.from(bis)));
}

console.log(`\n${echecs === 0 ? 'tout passe' : `${echecs} échec(s)`}`);
process.exit(echecs === 0 ? 0 : 1);
