// CERTIF — les consignes d'envoi, dans le courriel et nulle part ailleurs
//
// Elles ne figurent pas dans le PDF, délibérément. Une feuille de consignes
// internes glissée en tête du document, c'est une feuille qu'on oublie de
// retirer avant de fermer l'enveloppe — et la mairie reçoit alors le mode
// d'emploi de sa propre demande. Le PDF ne contient donc que ce qui part.
//
// Le courriel, lui, est le bon support : l'assistante l'a sous les yeux au
// moment d'imprimer, elle peut copier l'adresse pour l'affranchissement, et il
// reste dans la boîte comme trace de l'instruction donnée.
//
// QUAND LE PLI CONTIENT PLUSIEURS DEMANDES — autant que d'unités foncières, et
// autant de fois que de communes — c'est ici que cela se dit, et cela doit se
// dire trois fois : pourquoi il y en a plusieurs, quelles pages font chacune, et
// À QUELLE MAIRIE chacune part. Un document de quarante pages sans ces trois
// choses, ce sont deux demandes agrafées ensemble et une enveloppe à la mauvaise
// adresse.
//
// Deux versions du même texte, tenues côte à côte : le texte brut et le HTML.
// C'est la leçon de MATRICE — un message dont les deux versions divergent finit
// par montrer au destinataire celle qu'on n'a pas relue.

import { e, p, vide } from './signature-mail.js';
import { adressePostale, designerParcelles, contenanceTotale, metresCarres, dateCourte } from './format.js';

const CERFA = 'Cerfa n° 13410*13';

// L'ÉCHELLE D'IMPRESSION, ET POURQUOI LA CONSIGNE EST DANS CE SENS-LÀ.
//
// L'imprimé officiel laisse 4,2 mm sous son pied de page — moins que la marge
// non imprimable d'une laser ordinaire. CERTIF le remonte donc de 3 mm à la
// fabrication (voir REMONTEE dans lib/cerfa-cu.js) : le bas passe à 7,1 mm, le
// haut reste au-dessus de 6. Tout est alors imprimable À 100 %.
//
// Et c'est à 100 % qu'il FAUT imprimer, désormais : « Ajuster » réduirait
// l'ensemble de 4 % sans nécessité, et un formulaire à cases à peigne réduit se
// remplit moins bien à la main si le service a besoin d'y ajouter quelque chose.
const ECHELLE = 'Imprimer à 100 % — « Taille réelle », et non « Ajuster » : le formulaire est '
  + 'calé pour laisser environ 7 mm de marge en haut comme en bas, et une réduction n’apporte '
  + 'rien.';

const terrainsDe = (lot) => lot.terrains || [lot.terrain].filter(Boolean);

export function objetCourriel(lot, demandes = 1) {
  const terrains = terrainsDe(lot);
  const ou = terrains.length > 1
    ? `${terrains.length} communes`
    : (terrains[0]?.commune?.nom || '');
  return [
    demandes > 1 ? 'Certificats d’urbanisme' : 'Certificat d’urbanisme',
    ou ? `— ${ou}` : '',
    lot.reference ? `— ${lot.reference}` : '',
    demandes > 1 ? `— ${demandes} demandes` : '',
    '— à imprimer et à envoyer en recommandé',
  ].filter(Boolean).join(' ');
}

/** L'adresse d'une mairie, en bloc postal. */
function adresseMairie(terrain) {
  return adressePostale({
    destinataire: 'Monsieur le Maire',
    nom: terrain?.mairie?.nom || `Mairie de ${terrain?.commune?.nom || ''}`,
    adresse: terrain?.mairie?.adresse,
    complement: terrain?.mairie?.complement,
    codePostal: terrain?.mairie?.codePostal,
    commune: terrain?.mairie?.commune || terrain?.commune?.nom,
  });
}

/** La mairie sur une seule ligne, pour la glisser dans une étape numérotée. */
function mairieEnLigne(terrain) {
  return [terrain?.mairie?.nom, terrain?.mairie?.adresse, terrain?.mairie?.complement,
    terrain?.mairie?.codePostal, terrain?.mairie?.commune]
    .filter(Boolean).join(', ');
}

/**
 * @param {object} lot        le retour de demandeDepuisRequete()
 * @param {object} pagination { total, feuilles, exemplaires, dossiers:[…] }
 * @param {string} fichier    nom de la pièce jointe
 * @param {object} [etat]
 *   planJoint  la pièce jointe contient-elle le plan ? (forme à une demande)
 *   demandes   [{reference, rangCommune, parcelles, plan, annexe}] — le compte
 *              rendu par demande, qui dit pour CHACUNE si son plan est là et de
 *              quelle commune elle relève.
 */
export function consignes(lot, pagination, fichier, { planJoint = true, demandes = null } = {}) {
  const terrains = terrainsDe(lot);
  const blocs = pagination?.dossiers || [];
  const nombre = Math.max(blocs.length, 1);
  const sansPlan = demandes
    ? demandes.map((x, i) => (x.plan ? null : (blocs[i]?.reference || `demande ${i + 1}`)))
      .filter(Boolean)
    : (planJoint ? [] : [blocs[0]?.reference || null]);

  const rappel = nombre > 1 ? rappelPlusieurs(lot, terrains, blocs) : rappelUnique(lot);
  const etapes = nombre > 1
    ? etapesPlusieurs(pagination, blocs, sansPlan, terrains, demandes)
    : etapesUnique(pagination, sansPlan.length === 0);

  const ouverture = nombre > 1
    ? `Merci de bien vouloir adresser les ${nombre} demandes de certificat d’urbanisme `
      + `ci-jointes (${fichier}).`
    : `Merci de bien vouloir adresser la demande de certificat d’urbanisme ci-jointe (${fichier}).`;

  // LES ADRESSES, EN BLOC POSTAL, À RECOPIER SUR L'ENVELOPPE. Une par commune —
  // deux demandes dans la même commune partent à la même mairie, et répéter
  // l'adresse ferait croire qu'il y en a deux différentes.
  const adresses = terrains.length > 1
    ? terrains.map((t, i) => [`Commune ${i + 1} — ${t.commune?.nom || ''}`, adresseMairie(t)])
    : [[null, adresseMairie(terrains[0])]];

  const texte = [
    'Bonjour,',
    '',
    ouverture,
    '',
    ...rappel.map(([k, v]) => `${k} : ${v}`),
    '',
    ...etapes.map((s, i) => `${i + 1}. ${s}`),
    '',
    adresses.length > 1 ? 'Adresses des destinataires :' : 'Adresse du destinataire :',
    ...adresses.flatMap(([titre, bloc]) => (titre ? ['', titre, bloc] : [bloc])),
    '',
    'Merci beaucoup.',
  ].join('\n');

  const html = [
    p('Bonjour,'),
    vide(),
    p(e(ouverture)),
    vide(),
    ...rappel.map(([k, v]) => p(`${e(k)} : <b>${e(v)}</b>`)),
    vide(),
    ...etapes.map((s, i) => p(`${i + 1}.&nbsp; ${e(s)}`)),
    vide(),
    p(`<b>${adresses.length > 1 ? 'Adresses des destinataires :' : 'Adresse du destinataire :'}</b>`),
    ...adresses.flatMap(([titre, bloc]) => [
      ...(titre ? [vide(), p(`<b>${e(titre)}</b>`)] : []),
      ...bloc.split('\n').map((l) => p(e(l))),
    ]),
    vide(),
    p('Merci beaucoup.'),
  ].join('\n');

  return { objet: objetCourriel(lot, nombre), texte, html };
}

/* ------------------------------------------------------------ une demande */

function rappelUnique(lot) {
  const t = terrainsDe(lot)[0] || {};
  const surface = metresCarres(t.superficie ?? contenanceTotale(t.parcelles));
  return [
    ['Dossier', lot.reference],
    ['Commune', [t.commune?.nom, t.commune?.code].filter(Boolean).join(' — ')],
    ['Terrain', t.adresse],
    ['Références cadastrales', designerParcelles(t.parcelles)],
    ['Contenance', surface],
    ['Formulaire', `${CERFA}, établi le ${dateCourte(lot.date)}`],
  ].filter(([, v]) => v);
}

function etapesUnique(pagination, planJoint) {
  const ex = pagination?.exemplaires || [];
  const bornes = (i) => (ex[i] ? `pages ${ex[i].de} à ${ex[i].a}` : 'à repérer');
  const bloc = pagination?.dossiers?.[0];
  return [
    `Imprimer la pièce jointe en entier, EN RECTO VERSO — ${pagination?.total || '?'} pages, `
    + `soit ${pagination?.feuilles || '?'} feuilles.`,
    ECHELLE,
    'La page 1 est la lettre d’accompagnement, à joindre une seule fois. Son verso est blanc, '
    + 'c’est voulu : chaque partie commence sur une feuille neuve, de sorte que les deux '
    + 'exemplaires se séparent sans se déchirer.',
    `Suivent deux exemplaires identiques de la demande : ${bornes(0)} et ${bornes(1)}. `
    + 'Agrafer chaque exemplaire pour lui-même, sans les agrafer à la lettre.',
    bloc?.planParExemplaire
      ? `Dans chaque exemplaire, les ${bloc.planParExemplaire} dernières pages sont le plan de `
        + 'situation : il commence sur une feuille neuve et ne doit pas être agrafé au dos du '
        + 'formulaire. C’est une pièce jointe à la demande, que le service détache pour la '
        + 'verser au dossier.'
      : null,

    // Dit seulement quand c'est vrai. Une consigne qui réclame une pièce déjà
    // présente use la confiance qu'on accorde aux autres.
    planJoint ? null
      : 'LE PLAN DE SITUATION N’EST PAS DANS LA PIÈCE JOINTE : en imprimer deux exemplaires '
        + 'et en glisser un dans chacun. C’est la seule pièce exigée à l’appui de la demande, '
        + 'et son absence la rend incomplète.',

    'Envoyer le tout dans un seul pli, en lettre recommandée avec avis de réception, '
    + 'à l’adresse ci-dessous.',
    'Conserver la preuve de dépôt et l’avis de réception, et me les transmettre : c’est la date '
    + 'de réception en mairie qui fait courir le délai d’un mois, au terme duquel le silence '
    + 'vaut certificat tacite.',
  ].filter(Boolean);
}

/* ------------------------ plusieurs demandes, une ou plusieurs communes */

function rappelPlusieurs(lot, terrains, blocs) {
  const plusieursCommunes = terrains.length > 1;
  return [
    ['Dossier', lot.reference],
    [plusieursCommunes ? 'Communes' : 'Commune',
      plusieursCommunes
        ? terrains.map((t) => t.commune?.nom).filter(Boolean).join(', ')
        : [terrains[0]?.commune?.nom, terrains[0]?.commune?.code].filter(Boolean).join(' — ')],
    [plusieursCommunes ? null : 'Terrain', plusieursCommunes ? null : terrains[0]?.adresse],
    ['Nombre de demandes', plusieursCommunes
      ? `${blocs.length} — une par unité foncière, dans ${terrains.length} communes`
      : `${blocs.length} — une par unité foncière`],
    ['Nombre de plis', `${blocs.length}, chacun en recommandé`],
    ['Formulaire', `${CERFA}, établi le ${dateCourte(lot.date)}`],
  ].filter(([k, v]) => k && v);
}

function etapesPlusieurs(pagination, blocs, sansPlan, terrains, demandes) {
  const plusieursCommunes = terrains.length > 1;
  const etapes = [
    `Imprimer la pièce jointe en entier, EN RECTO VERSO — ${pagination?.total || '?'} pages, `
    + `soit ${pagination?.feuilles || '?'} feuilles.`,
    ECHELLE,

    // Le POURQUOI avant le COMMENT : sans cette phrase, deux demandes à la même
    // mairie pour le même client passent pour un doublon, et l'une des deux
    // finit à la corbeille.
    plusieursCommunes
      ? `Ce pli n’en est pas un mais ${blocs.length} : le dossier porte sur des terrains situés `
        + `dans ${terrains.length} communes, et certains se divisent en plusieurs unités `
        + 'foncières — un certificat d’urbanisme ne porte que sur une unité, dans une commune. '
        + 'Chaque demande a sa lettre, sa référence, ses deux exemplaires et SA MAIRIE. '
        + 'Ne pas les mélanger.'
      : `Ce pli n’en est pas un mais ${blocs.length} : les parcelles forment ${blocs.length} `
        + 'unités foncières distinctes, et un certificat d’urbanisme ne porte que sur une unité. '
        + 'Chaque demande a sa lettre, sa référence et ses deux exemplaires. Ne pas les mélanger.',
  ];

  blocs.forEach((bloc, i) => {
    const ex = bloc.exemplaires || [];
    const bornes = (k) => (ex[k] ? `pages ${ex[k].de} à ${ex[k].a}` : 'à repérer');
    const terrain = terrains[demandes?.[i]?.rangCommune ?? 0] || terrains[0];
    etapes.push(
      `Demande ${bloc.reference || ''}`
      + (plusieursCommunes ? ` — ${terrain?.commune?.nom || ''}` : '')
      + ` — ${(bloc.parcelles || []).join(', ')} : la lettre page ${bloc.de}, puis deux `
      + `exemplaires identiques, ${bornes(0)} et ${bornes(1)}. Agrafer chaque exemplaire pour `
      + 'lui-même, sans l’agrafer à sa lettre.'
      + (bloc.planParExemplaire
        ? ` Les ${bloc.planParExemplaire} dernières pages de chaque exemplaire sont le plan de `
          + 'situation, à ne pas agrafer au formulaire.'
        : '')
      // L'adresse EN CLAIR dans l'étape : l'assistante prépare l'enveloppe en
      // lisant la ligne, sans avoir à redescendre au bas du message et à
      // recompter les communes.
      + (plusieursCommunes ? ` À envoyer à : ${mairieEnLigne(terrain)}.` : ''));
  });

  if (sansPlan.length) {
    etapes.push(
      `LE PLAN DE SITUATION N’EST PAS DANS LA PIÈCE JOINTE pour ${sansPlan.join(', ')} : `
      + 'en imprimer deux exemplaires par demande concernée et en glisser un dans chacun. '
      + 'C’est la seule pièce exigée à l’appui de la demande, et son absence la rend incomplète.');
  }

  etapes.push(
    `Envoyer ${blocs.length} plis SÉPARÉS, un par demande — sa lettre et ses deux exemplaires —, `
    + 'chacun en lettre recommandée avec avis de réception, '
    + (plusieursCommunes
      ? 'à l’adresse indiquée pour chacune ci-dessous. Deux demandes de la même commune vont à '
        + 'la même mairie, mais dans DEUX enveloppes.'
      : 'à la même adresse ci-dessous.')
    + ' Un pli unique ferait courir un seul avis de réception pour des demandes dont les délais '
    + 'sont distincts.',
    'Conserver les preuves de dépôt et les avis de réception, et me les transmettre : c’est la '
    + 'date de réception en mairie qui fait courir le délai d’un mois, au terme duquel le silence '
    + 'vaut certificat tacite.');

  return etapes;
}
