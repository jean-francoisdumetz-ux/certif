// CERTIF — épreuve de la lecture des fichiers déposés
//
// Trois pièces, dans essais/pieces/ :
//
//   parcelles.xlsx  un tableur avec en-tête, un titre au-dessus et une ligne de
//                   total en dessous — la forme qu'a une liste faite à l'étude
//   parcelles.csv   les mêmes, sans en-tête du tout, en point-virgule
//   m1.pdf          un relevé de propriété RECONSTITUÉ : mêmes colonnes, même
//                   ordre, même écriture des contenances en hectares-ares-
//                   centiares, tableau des propriétés bâties compris
//
// CE QUE CET ESSAI NE PROUVE PAS. m1.pdf n'est pas un vrai relevé : il en a la
// forme, pas la provenance. Il vérifie la mécanique — regroupement des mots par
// ordonnée, lecture des jetons, contenances, doublon bâti/non bâti — pas que la
// mise en page réelle de la DGFiP soit celle-là. Le premier vrai relevé déposé
// sera l'épreuve véritable, et c'est pour cela que la route rend, sur demande,
// les lignes telles qu'elle les a reconstituées.
//
//   node essais/import.mjs

import { readFileSync } from 'fs';
import { importerParcelles, enMetresCarres, lireJetons } from '../lib/import-parcelles.js';

let echecs = 0;
const verifier = (intitule, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'} ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
};

console.log('\n— les contenances —');
verifier('hectares-ares-centiares', enMetresCarres('00 08 42') === 842);
verifier('un hectare vingt ares', enMetresCarres('01 20 00') === 12000);
verifier('avec les unités écrites', enMetresCarres('1 ha 20 a 00 ca') === 12000);
verifier('un entier simple', enMetresCarres('842') === 842);
verifier('un entier avec espace de milliers', enMetresCarres('1 234 m²') === 1234);
// Ce qu'on REFUSE de lire : un revenu cadastral, une date, un code.
verifier('un revenu cadastral n’est pas une contenance', enMetresCarres('12,45') === null);
verifier('une date non plus', enMetresCarres('01/01/2026') === null);
verifier('vide', enMetresCarres('') === null);

console.log('\n— une ligne de jetons —');
{
  const p = lireJetons(['26', 'AB', '0012', '14', 'LE PETIT BELGIQUE', '0154', '01', 'S', 'T', '00', '08', '42', '12,45']);
  verifier('section et numéro', p && p.section === 'AB' && p.numero === '12');
  verifier('contenance prise dans le triplet', p?.contenance === '842', p?.contenance);
  verifier('lieudit repéré', p?.lieudit === 'LE PETIT BELGIQUE', p?.lieudit);
  // « 26 » précède la section mais n'est pas un préfixe : trois chiffres exigés.
  verifier('l’année n’est pas prise pour un préfixe', p?.prefixe === '', `« ${p?.prefixe} »`);
}
{
  const p = lireJetons(['355', 'AB', '12', 'LE PETIT BELGIQUE', '00 08 42']);
  verifier('un préfixe à trois chiffres est pris', p?.prefixe === '355');
  verifier('contenance déjà groupée', p?.contenance === '842');
}
verifier('une ligne sans parcelle ne rend rien',
  lireJetons(['CONTENANCE', 'TOTALE', '01', '44', '87']) === null);
verifier('une ligne vide non plus', lireJetons([]) === null);

console.log('\n— le tableur —');
{
  const r = await importerParcelles(readFileSync('essais/pieces/parcelles.xlsx'), 'parcelles.xlsx');
  verifier('reconnu comme tableur', r.genre === 'tableur');
  verifier('cinq parcelles', r.parcelles.length === 5, `${r.parcelles.length}`);
  verifier('en-tête reconnu', /colonnes reconnues/.test(r.methode), r.methode);
  verifier('préfixe repris', r.parcelles[0].prefixe === '355');
  verifier('numéro sans zéros de tête', r.parcelles[3].numero === '7');
  verifier('contenance convertie', r.parcelles[4].contenance === '12000');
  // La ligne « Total » ne doit pas devenir une parcelle.
  verifier('la ligne de total est écartée',
    !r.parcelles.some((p) => p.section === 'TO' || p.contenance === '24491'));
}

console.log('\n— le csv sans en-tête —');
{
  const r = await importerParcelles(readFileSync('essais/pieces/parcelles.csv'), 'parcelles.csv');
  verifier('reconnu comme csv', r.genre === 'csv');
  verifier('trois parcelles', r.parcelles.length === 3, `${r.parcelles.length}`);
  verifier('séparateur détecté', /point-virgule|« ; »/.test(r.methode), r.methode);
  verifier('lecture par la forme', /aucun en-tête/.test(r.methode));
  verifier('dernière sans préfixe', r.parcelles[2].prefixe === '');
}

console.log('\n— le relevé de propriété —');
{
  const r = await importerParcelles(readFileSync('essais/pieces/m1.pdf'), 'm1.pdf');
  verifier('reconnu comme pdf', r.genre === 'pdf');
  verifier('cinq parcelles', r.parcelles.length === 5, `${r.parcelles.length}`);
  // AB 12 figure au tableau des non bâties ET à celui des bâties.
  verifier('le doublon bâti/non bâti est écarté',
    r.parcelles.filter((p) => p.section === 'AB' && p.numero === '12').length === 1);
  verifier('contenances lues', r.parcelles.map((p) => p.contenance).join(',')
    === '842,219,1330,96,12000', r.parcelles.map((p) => p.contenance).join(','));
  verifier('lieudits lus', r.parcelles[4].lieudit === 'LES QUATRE VENTS', r.parcelles[4].lieudit);
  verifier('commune reconnue', r.commune?.nom === 'LOMME', r.commune?.nom);
  verifier('code INSEE recollé du département et du code commune',
    r.commune?.codeInsee === '59355', r.commune?.codeInsee);
  verifier('la contenance totale n’est pas devenue une parcelle',
    !r.parcelles.some((p) => p.contenance === '14487'));
  verifier('les lignes brutes sont rendues pour diagnostic', r.lignes.length > 10);
  verifier('aucun avertissement de contenance', r.avertissements.length === 0,
    r.avertissements.join(' | '));
}

console.log('\n— ce qui est refusé —');
{
  const r = await importerParcelles(Buffer.from('nimportequoi'), 'notes.docx');
  verifier('format non reconnu', /format non reconnu/.test(r.erreur || ''), r.erreur);
  verifier('aucune parcelle rendue', r.parcelles.length === 0);
}
{
  // Un PDF sans texte : c'est un scan, et il faut le dire plutôt que de rendre
  // une liste vide qu'on prendrait pour « aucune parcelle dans ce relevé ».
  const { PDFDocument } = await import('pdf-lib');
  const vide = await PDFDocument.create();
  vide.addPage([595, 842]);
  const r = await importerParcelles(await vide.save(), 'scan.pdf');
  verifier('un PDF sans texte est signalé comme scan', /scan|image/.test(r.erreur || ''), r.erreur);
}

console.log(`\n${echecs === 0 ? 'tout passe' : `${echecs} échec(s)`}`);
process.exit(echecs === 0 ? 0 : 1);
