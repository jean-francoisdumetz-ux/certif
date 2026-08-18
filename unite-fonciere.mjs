// CERTIF — épreuve du regroupement en unités foncières
//
// Hors ligne, sur des polygones fabriqués : la question posée est géométrique,
// elle n'a pas besoin du cadastre pour être éprouvée. Les cas retenus sont ceux
// qui se présentent réellement à l'étude — le bord commun, le coin commun, la
// jonction en T d'un lotissement, la parcelle de l'autre côté de la rue.
//
//   node essais/unite-fonciere.mjs

import assert from 'node:assert';
import { unitesFoncieres, seTouchent, groupementDeLaSaisie, TOLERANCE }
  from '../lib/unite-fonciere.js';

// Un degré de longitude vaut environ 71 km à cette latitude, un degré de
// latitude environ 111 km. On raisonne donc en très petits pas : 1e-5 degré de
// longitude ≈ 0,71 m, de quoi construire des parcelles de quelques dizaines de
// mètres autour de Saint-Omer.
const LON = 2.25;
const LAT = 50.75;
const PAS = 1e-5;

/** Un rectangle de i×j pas, posé au décalage (dx, dy) en pas. */
function rectangle(dx, dy, largeur, hauteur) {
  const x0 = LON + dx * PAS;
  const y0 = LAT + dy * PAS;
  const x1 = x0 + largeur * PAS;
  const y1 = y0 + hauteur * PAS;
  return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
}

const parcelle = (section, numero, anneaux) => ({
  designation: `000 ${section} ${numero}`,
  source: { prefixe: null, section, numero },
  anneaux,
});

let essais = 0;
const verifier = (titre, condition) => {
  essais += 1;
  assert.ok(condition, `ÉCHEC — ${titre}`);
  console.log(`  ok  ${titre}`);
};

console.log('\nContiguïté');

// Deux rectangles qui partagent tout un côté : le cas ordinaire.
verifier('bord commun', seTouchent(rectangle(0, 0, 10, 10), rectangle(10, 0, 10, 10)));

// Un coin commun, et rien d'autre. « D'un seul tenant » s'en satisfait : on ne
// franchit aucun fonds étranger pour passer de l'une à l'autre.
verifier('coin commun', seTouchent(rectangle(0, 0, 10, 10), rectangle(10, 10, 10, 10)));

// La jonction en T : le côté de la grande parcelle n'a AUCUN sommet en face du
// point où la petite vient buter. C'est ce cas qui impose de tester les sommets
// contre les segments, et non contre les sommets.
verifier('jonction en T', seTouchent(rectangle(0, 0, 4, 40), rectangle(4, 12, 10, 8)));

// Séparées par une voie de 7 m : deux unités foncières, quoi qu'en pense le
// propriétaire.
verifier('séparées par une rue', !seTouchent(rectangle(0, 0, 10, 10), rectangle(20, 0, 10, 10)));

// Un jeu à 30 cm l'une de l'autre — arrondi de numérisation, pas une séparation.
// La tolérance d'un demi-mètre doit l'absorber.
const jeu = 0.3 / (PAS * 71000); // 30 cm exprimés en pas
verifier(`jeu de 30 cm absorbé (tolérance ${TOLERANCE} m)`,
  seTouchent(rectangle(0, 0, 10, 10), rectangle(10 + jeu, 0, 10, 10)));

// Le contrôle en sens inverse : un mètre franc, c'est déjà une sente, et la
// tolérance ne doit PAS le rattraper. Sans cette vérification, on ne saurait
// pas si le test précédent passe parce que la tolérance est juste ou parce
// qu'elle est trop large.
const metre = 1.0 / (PAS * 71000);
verifier('écart d’un mètre non absorbé',
  !seTouchent(rectangle(0, 0, 10, 10), rectangle(10 + metre, 0, 10, 10)));

console.log('\nRegroupement');

const A = parcelle('AV', '168', rectangle(0, 0, 10, 10));
const B = parcelle('AV', '169', rectangle(10, 0, 10, 10));   // colle à A
const C = parcelle('AV', '412', rectangle(40, 0, 10, 10));   // à l'écart
const D = parcelle('AV', '413', rectangle(50, 0, 10, 10));   // colle à C

{
  const r = unitesFoncieres([A, B]);
  verifier('deux parcelles contiguës = une unité', r.unites.length === 1);
  verifier('les deux y figurent', r.unites[0].parcelles.join(',') === 'AV 168,AV 169');
  verifier('contour connu', r.unites[0].contourConnu === true);
}

{
  const r = unitesFoncieres([A, C]);
  verifier('deux parcelles séparées = deux unités', r.unites.length === 2);
}

{
  // Deux paires, données dans le désordre : le parcours en largeur doit les
  // reconstituer quand même.
  const r = unitesFoncieres([A, C, B, D]);
  verifier('deux paires mêlées = deux unités', r.unites.length === 2);
  const groupes = r.unites.map((u) => [...u.parcelles].sort().join(',')).sort();
  verifier('la première paire tient ensemble', groupes[0] === 'AV 168,AV 169');
  verifier('la seconde aussi', groupes[1] === 'AV 412,AV 413');
}

{
  // Une chaîne : A touche B, B touche C', C' touche D'. Aucune n'est voisine de
  // toutes, et pourtant l'îlot est d'un seul tenant.
  const chaine = [
    parcelle('AV', '1', rectangle(0, 0, 10, 10)),
    parcelle('AV', '2', rectangle(10, 0, 10, 10)),
    parcelle('AV', '3', rectangle(20, 0, 10, 10)),
    parcelle('AV', '4', rectangle(30, 0, 10, 10)),
  ];
  const r = unitesFoncieres(chaine);
  verifier('chaîne de quatre = une seule unité', r.unites.length === 1);
  verifier('les quatre y sont', r.unites[0].parcelles.length === 4);
}

console.log('\nParcelle introuvable au cadastre');

{
  // La parcelle absente du retour de l'API Carto ne doit pas disparaître du
  // raisonnement : elle forme son propre lot, marqué non vérifié.
  const saisie = [
    { prefixe: null, section: 'AV', numero: '168' },
    { prefixe: null, section: 'AV', numero: '169' },
    { prefixe: null, section: 'ZZ', numero: '9999' },
  ];
  const cadastre = {
    parcelles: [
      { designation: '000 AV 0168', source: saisie[0], anneaux: rectangle(0, 0, 10, 10) },
      { designation: '000 AV 0169', source: saisie[1], anneaux: rectangle(10, 0, 10, 10) },
    ],
  };
  const r = groupementDeLaSaisie(saisie, cadastre);
  verifier('trois lignes, trois parcelles comptées',
    r.unites.flatMap((u) => u.parcelles).length === 3);
  const verifiees = r.unites.filter((u) => u.contourConnu);
  verifier('une seule unité vérifiée', verifiees.length === 1);
  verifier('la troisième est isolée et non vérifiée',
    r.unites.some((u) => !u.contourConnu && u.parcelles[0] === 'ZZ 9999'));
  verifier('le motif le dit', /sans contour/.test(r.motif || ''));
}

{
  // L'appariement par références, au cas où la saisie aurait été recopiée.
  const saisie = [{ prefixe: null, section: 'av', numero: '168' }];
  const cadastre = {
    parcelles: [{
      designation: '000 AV 0168',
      source: { prefixe: null, section: 'AV', numero: '168' },
      anneaux: rectangle(0, 0, 10, 10),
    }],
  };
  const r = groupementDeLaSaisie(saisie, cadastre);
  verifier('appariement par références, sans identité d’objet',
    r.unites.length === 1 && r.unites[0].contourConnu === true);
}

console.log(`\n${essais} vérifications passées.\n`);
