// CERTIF — la chaîne complète, sans serveur ni réseau.
//
// Fait tourner exactement le code des routes : validation, refus, fabrication
// du PDF, corps du courriel. Ce qui échoue ici échouerait en production.
//
//   node essais/bout-en-bout.mjs
import { writeFileSync } from 'fs';
import { demandeDepuisRequete, preparerDossier, Refus } from '../lib/preparer.js';
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
  reference: '2026-0117',
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
verifier('nom de fichier', r.fichier === 'CU_LOMME_2026-0117.pdf', r.fichier);
verifier('plan signalé manquant', r.avertissements.some((a) => a.includes('plan de situation')));
verifier('absence de signature signalée', r.avertissements.some((a) => a.includes('non signées')));

const c = consignes(demande, r.pagination, r.fichier, { planJoint: false });
verifier('consigne du plan absente du corps', c.texte.includes('PLAN DE SITUATION N’EST PAS'));
verifier('bornes de pages dans le corps', c.texte.includes('pages 3 à 6') && c.texte.includes('pages 7 à 10'));
verifier('consigne du recto verso', c.texte.includes('RECTO VERSO'));
verifier('adresse de la mairie dans le corps', c.texte.includes('160 rue Sadi Carnot'));
verifier('les deux versions comptent les mêmes étapes',
  (c.texte.match(/^\d\. /gm) || []).length === (c.html.match(/<p class=MsoNormal>\d\.&nbsp;/g) || []).length);

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
