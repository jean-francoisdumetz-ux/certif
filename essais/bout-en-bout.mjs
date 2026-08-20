// CERTIF — la chaîne complète, sans serveur ni réseau.
//
// Fait tourner exactement le code des routes : validation, refus, fabrication
// du PDF, corps du courriel. Ce qui échoue ici échouerait en production.
//
//   node essais/bout-en-bout.mjs
import { writeFileSync } from 'fs';
import { demandeDepuisRequete, preparerDossier, decouperCadastre, Refus } from '../lib/preparer.js';
import { consignes } from '../lib/consignes.js';

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

let echecs = 0;
const verifier = (intitule, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'} ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
};

function refus(intitule, corps, code, dansLeMessage) {
  try {
    demandeDepuisRequete(corps);
    verifier(intitule, false, 'aucun refus');
  } catch (e) {
    const bon = e instanceof Refus && e.code === code
      && JSON.stringify(e.details || e.message).includes(dansLeMessage);
    verifier(intitule, bon, bon ? `${e.code} ${e.message}` : `reçu : ${e.code} ${JSON.stringify(e.details)}`);
  }
}

const COMPLET = {
  // Numero de groupe Data Room, 4 chiffres — decision du 19/08/2026. Les
  // anciens formats (2026-0117, 15151) sont refuses par preparer.js depuis.
  reference: '0117',
  commune: { code: '59355', nom: 'Lomme' },
  adresse: '14 rue du Petit Belgique',
  codePostalTerrain: '59160',
  mairie: { nom: 'Mairie de Lomme', adresse: '160 rue Sadi Carnot', codePostal: '59160', commune: 'Lomme' },
  parcelles: [
    { prefixe: '355', section: 'AB', numero: '0012', contenance: 842 },
    { prefixe: '355', section: 'ab', numero: '0013', contenance: 219 },
    { prefixe: '355', section: 'AB', numero: '0014', contenance: 1330 },
    { prefixe: '355', section: 'AC', numero: '0007', contenance: 96 },
    { prefixe: '355', section: 'AC', numero: '0008', contenance: 2451 },
  ],
  date: '2026-08-18T00:00:00Z',
};

console.log('\n— ce que CERTIF refuse —');
refus('sans référence de dossier', { ...COMPLET, reference: '' }, 400, 'référence');
refus('sans commune', { ...COMPLET, commune: {} }, 400, 'commune');
refus('sans parcelle', { ...COMPLET, parcelles: [] }, 400, 'parcelle');
refus('parcelle sans numéro', { ...COMPLET, parcelles: [{ section: 'AB' }] }, 400, 'numéro');
refus('contenance non numérique', {
  ...COMPLET, parcelles: [{ section: 'AB', numero: '12', contenance: 'douze' }],
}, 400, 'contenance');
refus('sans adresse de mairie', { ...COMPLET, mairie: { nom: 'Mairie' } }, 400, 'mairie');
// UN BLOC VIDE SE DIT EN UNE LIGNE. Énumérer commune, parcelles et mairie d'une
// saisie pas commencée donne trois oublis là où il n'y en a aucun.
refus('écran vierge', { reference: '0042', communes: [{ commune: {}, parcelles: [], mairie: {} }] },
  400, 'la saisie est vide');
refus('un bloc vide parmi d’autres', {
  reference: '0042',
  communes: [
    { ...COMPLET, commune: { code: '59355', nom: 'Lomme' } },
    { commune: {}, parcelles: [], mairie: {} },
  ],
}, 400, 'la commune n° 2 est vide');

console.log('\n— la demande complète —');
const demande = demandeDepuisRequete(COMPLET);
verifier('section normalisée en capitales', demande.terrain.parcelles[1].section === 'AB');
verifier('cinq parcelles retenues', demande.terrain.parcelles.length === 5);
verifier('voie électronique acceptée par défaut', demande.accepterVoieElectronique === true);

const r = await preparerDossier(demande, undefined);
// Sans plan de situation, un exemplaire fait quatre pages utiles : les trois
// du Cerfa et l'annexe. La lettre en fait une, complétée à deux pour que le
// premier exemplaire commence sur une feuille neuve.
verifier('dix pages', r.pagination.total === 10, `${r.pagination.total}`);
verifier('cinq feuilles en recto verso', r.pagination.feuilles === 5);
verifier('deux exemplaires de quatre pages', r.pagination.parExemplaire === 4);
verifier('une seule page blanche', r.pagination.blanches === 1, `${r.pagination.blanches}`);
verifier('annexe déclenchée', r.annexe?.parcelles === 5);
verifier('nom de fichier', r.fichier === 'CU_LOMME_0117.pdf', r.fichier);
verifier('plan signalé manquant', r.avertissements.some((a) => a.includes('plan de situation')));
verifier('absence de signature signalée', r.avertissements.some((a) => a.includes('non signées')));
// Cet essai tourne hors ligne : le cadastre ne répond pas, donc la contiguïté
// des cinq parcelles n'a pas pu être vérifiée. Le dossier sort quand même —
// une panne du cadastre n'arrête pas les envois de l'étude — mais il le DIT.
// On ne DÉCOUPE que sur un constat : plusieurs unités foncières constatées
// donnent plusieurs demandes, une absence de constat n'en donne qu'une.
verifier('contiguïté non vérifiée signalée',
  r.avertissements.some((a) => a.includes('contiguïté') || a.includes('Contiguïté')));
verifier('la réserve sur le propriétaire ne s’affiche pas sans contours',
  !r.avertissements.some((a) => a.includes('Chambon')));
verifier('le groupement remonte', Array.isArray(r.unitesFoncieres?.unites));

const c = consignes(demande, r.pagination, r.fichier, { planJoint: false });
verifier('consigne du plan absente du corps', c.texte.includes('PLAN DE SITUATION N’EST PAS'));
verifier('bornes de pages dans le corps', c.texte.includes('pages 3 à 6') && c.texte.includes('pages 7 à 10'));
verifier('consigne du recto verso', c.texte.includes('RECTO VERSO'));
verifier('adresse de la mairie dans le corps', c.texte.includes('160 rue Sadi Carnot'));
verifier('les deux versions comptent les mêmes étapes',
  (c.texte.match(/^\d\. /gm) || []).length === (c.html.match(/<p class=MsoNormal>\d\.&nbsp;/g) || []).length);

console.log('\n— deux unités foncières : deux demandes —');
{
  // Le cadastre est simulé : deux parcelles contiguës, une troisième à deux
  // cents mètres. C'est le cas qui doit produire DEUX demandes complètes — un
  // seul Cerfa pour deux unités foncières donnerait un certificat qui ne couvre
  // qu'une partie du terrain, sans que rien ne le signale avant l'acte.
  const trois = demandeDepuisRequete({ ...COMPLET, parcelles: COMPLET.parcelles.slice(0, 3) });
  const [p1, p2, p3] = trois.terrain.parcelles;
  const carre = (dx) => {
    const x = 3.06 + dx * 1e-5;
    const y = 50.64;
    return [[[x, y], [x + 1e-4, y], [x + 1e-4, y + 1e-4], [x, y + 1e-4], [x, y]]];
  };
  const cadastre = {
    parcelles: [
      { designation: '1', source: p1, anneaux: carre(0) },
      { designation: '2', source: p2, anneaux: carre(10) },   // colle à la première
      { designation: '3', source: p3, anneaux: carre(300) },  // à deux cents mètres
    ],
    anneaux: [], journal: [],
  };

  const lot = await preparerDossier(trois, undefined, { cadastre, sansPlan: true });
  verifier('deux demandes produites', lot.demandes.length === 2, `${lot.demandes.length}`);
  verifier('références suffixées',
    lot.demandes.map((x) => x.reference).join(' ') === '0117/1 0117/2',
    lot.demandes.map((x) => x.reference).join(' '));
  verifier('la paire contiguë tient dans la première',
    lot.demandes[0].parcelles.length === 2);
  verifier('l’isolée fait la seconde', lot.demandes[1].parcelles.length === 1);
  verifier('nom de fichier qui annonce le lot',
    lot.fichier === 'CU_LOMME_0117_2-demandes.pdf', lot.fichier);

  // Chaque demande : une lettre d'une page complétée à deux, puis DEUX
  // exemplaires de trois pages utiles complétées à quatre — soit 2 + 8 = 10
  // pages. Deux demandes font vingt pages, et pas une de moins : c'est le prix
  // de deux dossiers qui doivent pouvoir partir dans deux enveloppes.
  verifier('vingt pages', lot.pagination.total === 20, `${lot.pagination.total}`);
  verifier('deux blocs paginés', lot.pagination.dossiers.length === 2);
  verifier('le second bloc commence après le premier',
    lot.pagination.dossiers[1].de === lot.pagination.dossiers[0].a + 1);
  verifier('les bornes du second bloc sont justes',
    lot.pagination.dossiers[1].exemplaires[0].de === 13
    && lot.pagination.dossiers[1].exemplaires[1].a === 20,
    JSON.stringify(lot.pagination.dossiers[1].exemplaires));
  verifier('le compte des unités remonte', lot.unitesFoncieres.demandes === 2);
  verifier('le nombre de demandes est annoncé en avertissement',
    lot.avertissements.some((a) => a.startsWith('2 demandes produites')));
  verifier('chaque avertissement de plan nomme sa demande',
    lot.avertissements.filter((a) => a.includes('plan de situation')).length === 2
    && lot.avertissements.some((a) => a.startsWith('demande 0117/2 — ')));

  // Les consignes : c'est là que l'assistante lit ce qu'elle doit agrafer.
  const cl = consignes(trois, lot.pagination, lot.fichier, { demandes: lot.demandes });
  verifier('l’objet annonce deux demandes', /2 demandes/.test(cl.objet), cl.objet);
  verifier('le pourquoi est dit', cl.texte.includes('2 unités foncières distinctes'));
  verifier('les bornes de la première demande', cl.texte.includes('pages 3 à 6'));
  verifier('les bornes de la seconde', cl.texte.includes('pages 17 à 20'));
  verifier('deux plis séparés', cl.texte.includes('2 plis SÉPARÉS'));
  verifier('les deux versions comptent les mêmes étapes',
    (cl.texte.match(/^\d\. /gm) || []).length
    === (cl.html.match(/<p class=MsoNormal>\d\.&nbsp;/g) || []).length);

  // Et le contrôle en sens inverse : les mêmes trois parcelles, toutes
  // contiguës, doivent passer.
  const jointives = {
    parcelles: [
      { designation: '1', source: p1, anneaux: carre(0) },
      { designation: '2', source: p2, anneaux: carre(10) },
      { designation: '3', source: p3, anneaux: carre(20) },
    ],
    anneaux: [], journal: [],
  };
  const passe = await preparerDossier(trois, undefined, { cadastre: jointives, sansPlan: true });
  verifier('trois parcelles contiguës : le dossier sort',
    passe.unitesFoncieres.unites.length === 1);
  verifier('la réserve sur le propriétaire est dite',
    passe.avertissements.some((a) => a.includes('Chambon')));
}

console.log('\n— plusieurs communes, plusieurs mairies —');
{
  // Le cas que le dossier de succession présente tous les mois : des terrains
  // dans deux communes, dont l'une compte deux îlots séparés. Trois demandes,
  // trois lettres, trois plis, DEUX adresses.
  const lot = demandeDepuisRequete({
    reference: '0042',
    accepterVoieElectronique: true,
    date: '2026-08-18T00:00:00Z',
    communes: [
      {
        commune: { code: '59009', nom: 'Villeneuve-d’Ascq' },
        adresse: '11 allée du Tennis',
        codePostalTerrain: '59650',
        mairie: {
          nom: 'Mairie de Villeneuve-d’Ascq', adresse: '1 place Salvador Allende',
          codePostal: '59650', commune: 'Villeneuve-d’Ascq',
        },
        parcelles: [
          { section: 'NL', numero: '113', contenance: 1429 },
          { section: 'NL', numero: '117', contenance: 2370 },
          { section: 'ZC', numero: '294', contenance: 858 },
        ],
      },
      {
        commune: { code: '59355', nom: 'Lomme' },
        adresse: '14 rue du Petit Belgique',
        codePostalTerrain: '59160',
        mairie: {
          nom: 'Mairie de Lomme', adresse: '160 rue Sadi Carnot',
          codePostal: '59160', commune: 'Lomme',
        },
        parcelles: [{ prefixe: '355', section: 'AB', numero: '12', contenance: 842 }],
      },
    ],
  });

  verifier('deux terrains lus', lot.terrains.length === 2);
  verifier('chaque terrain a SA mairie',
    lot.terrains[0].mairie.codePostal === '59650' && lot.terrains[1].mairie.codePostal === '59160');

  // Cadastre simulé : à Villeneuve, deux parcelles contiguës et une isolée ;
  // à Lomme, une seule parcelle.
  const carre = (dx, dy = 0) => {
    const x = 3.14 + dx * 1e-5;
    const y = 50.62 + dy * 1e-5;
    return [[[x, y], [x + 1e-4, y], [x + 1e-4, y + 1e-4], [x, y + 1e-4], [x, y]]];
  };
  const [a, b, c] = lot.terrains[0].parcelles;
  const [d] = lot.terrains[1].parcelles;
  const cadastres = [
    {
      parcelles: [
        { source: a, anneaux: carre(0) },
        { source: b, anneaux: carre(10) },
        { source: c, anneaux: carre(400) },
      ],
      anneaux: [], journal: [],
    },
    { parcelles: [{ source: d, anneaux: carre(0, 900) }], anneaux: [], journal: [] },
  ];

  const r = await preparerDossier(lot, undefined, { cadastres, sansPlan: true });
  verifier('trois demandes', r.demandes.length === 3, `${r.demandes.length}`);
  verifier('références commune-unité',
    r.demandes.map((x) => x.reference).join(' ') === '0042/1-1 0042/1-2 0042/2-1',
    r.demandes.map((x) => x.reference).join(' '));
  verifier('la troisième relève de Lomme', r.demandes[2].commune === 'Lomme');
  verifier('chaque demande porte SON adresse de mairie',
    r.demandes[0].mairie.includes('59650') && r.demandes[2].mairie.includes('59160'));
  verifier('le nom de fichier compte les communes',
    r.fichier === 'CU_2-COMMUNES_0042_3-demandes.pdf', r.fichier);
  verifier('deux communes rendues', r.communes.length === 2);
  verifier('la première en donne deux', r.communes[0].demandes === 2);

  // Trois demandes de 2 + 8 pages : 30 pages.
  verifier('trente pages', r.pagination.total === 30, `${r.pagination.total}`);

  const c3 = consignes(lot, r.pagination, r.fichier, { demandes: r.demandes });
  verifier('l’objet annonce deux communes', /2 communes/.test(c3.objet), c3.objet);
  verifier('les deux adresses figurent',
    c3.texte.includes('Salvador Allende') && c3.texte.includes('Sadi Carnot'));
  verifier('l’adresse est rappelée dans l’étape', c3.texte.includes('À envoyer à :'));
  verifier('les deux versions comptent les mêmes étapes',
    (c3.texte.match(/^\d+\. /gm) || []).length
    === (c3.html.match(/<p class=MsoNormal>\d+\.&nbsp;/g) || []).length);
  verifier('le pli unique est explicitement écarté', c3.texte.includes('3 plis SÉPARÉS'));
}

console.log('\n— l’imprimé est remonté de 3 mm —');
{
  // L'imprimé officiel laisse 9 à 10,7 mm de blanc en haut et 4,2 mm en bas :
  // mesuré à l'encre sur un tirage réel. Or une laser ne dépose rien à moins de
  // 4 à 5 mm du bord — le pied de page se perd. On remonte donc le contenu de
  // 8,5 points, et on le VÉRIFIE en relisant la position du « / 7 » au lieu de
  // faire confiance à l'appel.
  const { remplirCerfa } = await import('../lib/cerfa-cu.js');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  globalThis.pdfjsWorker ||= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');

  const cerfa = await remplirCerfa(demande, {});
  const doc = await pdfjs.getDocument({ data: new Uint8Array(cerfa), disableFontFace: true }).promise;
  const items = (await (await doc.getPage(1)).getTextContent()).items;
  const pied = items.filter((i) => i.str.includes('/ 7') || i.str.trim() === '/');
  const y = pied.length ? Math.round(pied[0].transform[5] * 10) / 10 : null;

  // Le « / 7 » du gabarit est sur une ligne de base à 13,5 points en pages 1 et
  // 2, à 13,3 en page 3 — d'où la mention « Dossier » posée à 13,4, entre les
  // deux. Remonté de 8,5, le pied de la page 1 doit donc se lire à 22,0.
  verifier('le pied de page est remonté à 22 points', Math.abs(y - 22) < 0.3, `${y}`);
  verifier('trois pages seulement', doc.numPages === 3, `${doc.numPages}`);
}

console.log('\n— le plan ne se met jamais au dos du formulaire —');
{
  // Le plan de situation est une PIÈCE JOINTE, pas un feuillet de l'imprimé :
  // le service le détache pour le verser au dossier. Au verso de la dernière
  // page du Cerfa, il faudrait couper la feuille pour l'en séparer.
  const { remplirCerfa } = await import('../lib/cerfa-cu.js');
  const { construireAnnexe } = await import('../lib/annexe.js');
  const { construireDossier } = await import('../lib/dossier-pdf.js');
  const { PDFDocument } = await import('pdf-lib');

  const deux = demandeDepuisRequete({ ...COMPLET, parcelles: COMPLET.parcelles.slice(0, 2) });
  const faux = await PDFDocument.create();
  faux.addPage([595, 842]); // le format de l'extrait du cadastre, différent d'un cheveu
  const plan = await faux.save();

  const cerfa = await remplirCerfa(deux, {});
  const annexe = await construireAnnexe(deux);
  const r = await construireDossier({
    dossiers: [{ demande: deux, cerfa, annexe: annexe?.octets, plan }],
  });
  const bloc = r.pagination.dossiers[0];

  // Trois pages d'imprimé complétées à quatre, puis une page de plan complétée
  // à deux : six pages par exemplaire, et le plan commence sur une feuille
  // neuve dans chacun.
  verifier('quatre pages d’imprimé', bloc.imprimeParExemplaire === 4, `${bloc.imprimeParExemplaire}`);
  verifier('deux pages pour le plan', bloc.planParExemplaire === 2, `${bloc.planParExemplaire}`);
  verifier('six pages par exemplaire', bloc.parExemplaire === 6, `${bloc.parExemplaire}`);
  verifier('quatorze pages en tout', r.pagination.total === 14, `${r.pagination.total}`);
  // La feuille se compte à partir de 1 : une page impaire est un recto.
  verifier('le plan tombe sur un recto',
    (bloc.exemplaires[0].de + bloc.imprimeParExemplaire) % 2 === 1,
    `page ${bloc.exemplaires[0].de + bloc.imprimeParExemplaire}`);

  // UN SEUL FORMAT dans tout le document : un pilote qui en voit deux peut
  // ramener l'ensemble au plus grand, et c'est ainsi qu'un pied de page se
  // retrouve rogné.
  const final = await PDFDocument.load(r.octets);
  const formats = new Set(final.getPages()
    .map((x) => `${x.getSize().width}x${x.getSize().height}`));
  verifier('toutes les pages au même format', formats.size === 1, [...formats].join(' '));

  const c = consignes(deux, r.pagination, 'essai.pdf', { demandes: [{ plan: {} }] });
  verifier('la consigne d’échelle est donnée', c.texte.includes('100 %'));
  verifier('la consigne dit que le plan se détache', c.texte.includes('pièce jointe'));
}

console.log('\n— chaque demande reçoit SES contours —');
{
  // Ce que le plan de situation reçoit, demande par demande. Si ce découpage
  // rendait un jeu vide, chaque demande sortirait sans plan et sans qu'aucune
  // erreur ne soit levée : une panne silencieuse, la pire espèce.
  const a = { section: 'AB', numero: '12' };
  const b = { section: 'AB', numero: '13' };
  const c = { section: 'ZC', numero: '104' };
  const anneau = (n) => [[[n, 50], [n + 1, 50], [n + 1, 51], [n, 51], [n, 50]]];
  const cadastre = {
    parcelles: [{ source: a, anneaux: anneau(1) }, { source: b, anneaux: anneau(2) },
      { source: c, anneaux: anneau(9) }],
    anneaux: [], journal: [],
  };
  const un = decouperCadastre(cadastre, [a, b]);
  const deux = decouperCadastre(cadastre, [c]);
  verifier('la première demande reçoit deux contours', un.anneaux.length === 2);
  verifier('la seconde n’en reçoit qu’un', deux.anneaux.length === 1);
  verifier('et ce n’est pas le même', deux.parcelles[0].source === c);
  verifier('un cadastre muet remonte son motif',
    decouperCadastre({ parcelles: [], anneaux: [], motif: 'rien' }, [a]).motif === 'rien');
}

console.log('\n— trois parcelles : pas d’annexe —');
const court = await preparerDossier(
  demandeDepuisRequete({ ...COMPLET, parcelles: COMPLET.parcelles.slice(0, 3) }), undefined);
verifier('aucune annexe', court.annexe === null);
// Trois pages utiles par exemplaire, complétées à quatre : le second
// exemplaire ne doit pas commencer au dos du premier.
verifier('dix pages aussi', court.pagination.total === 10, `${court.pagination.total}`);
verifier('trois pages utiles complétées à quatre',
  court.pagination.utilesParExemplaire === 3 && court.pagination.parExemplaire === 4);

writeFileSync('essais/apercu-certif.pdf', Buffer.from(r.octets));
console.log(`\n${echecs === 0 ? 'tout passe' : `${echecs} échec(s)`}`);
process.exit(echecs === 0 ? 0 : 1);
