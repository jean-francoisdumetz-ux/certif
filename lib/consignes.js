// CERTIF — les consignes d'envoi, dans le courriel et nulle part ailleurs
//
// Elles ne figurent pas dans le PDF, délibérément. Une feuille de consignes
// internes glissée en tête du document, c'est une feuille qu'on oublie de
// retirer avant de fermer l'enveloppe — et la mairie reçoit alors le mode
// d'emploi de sa propre demande. Le PDF ne contient donc que ce qui part.
//
// Le courriel, lui, est le bon support : l'assistante l'a sous les yeux au
// moment d'imprimer, elle peut copier l'adresse pour l'affranchissement, et
// il reste dans la boîte comme trace de l'instruction donnée.
//
// QUAND LE PLI CONTIENT PLUSIEURS DEMANDES — autant que d'unités foncières —
// c'est ici que cela se dit, et cela doit se dire deux fois : une fois pour
// expliquer POURQUOI il y en a plusieurs, une fois pour donner les bornes de
// pages de chacune. Un document de vingt pages sans ces bornes, ce sont deux
// demandes agrafées ensemble et une mairie qui en instruit une seule.
//
// Deux versions du même texte, tenues côte à côte : le texte brut et le HTML.
// C'est la leçon de MATRICE — un message dont les deux versions divergent
// finit par montrer au destinataire celle qu'on n'a pas relue.

import { e, p, vide } from './signature-mail.js';
import { adressePostale, designerParcelles, contenanceTotale, metresCarres, dateCourte } from './format.js';

const CERFA = 'Cerfa n° 13410*13';

// L'ÉCHELLE D'IMPRESSION, ET POURQUOI ELLE COMPTE. Le pied de page du Cerfa —
// « 1 / 7 » — est imprimé par l'administration à 4,7 mm du bord de la feuille.
// La plupart des imprimantes laser ne descendent pas en dessous de 4 à 5 mm :
// tirée « à 100 % » ou « en taille réelle », la page perd sa numérotation, et le
// bas de l'imprimé avec elle. « Ajuster à la zone imprimable » réduit l'ensemble
// d'environ 4 % et rend la page entière — c'est le bon réglage, et il n'altère
// pas l'imprimé, qui reste complet et lisible.
const ECHELLE = 'Dans la fenêtre d’impression, choisir « Ajuster » ou « Ajuster à la zone '
  + 'imprimable », et NON « Taille réelle » : le pied de page du formulaire est à moins de '
  + '5 mm du bord et une impression à 100 % le rogne.';

export function objetCourriel(d, demandes = 1) {
  // Meme regle que le nom de fichier : un lot sur deux communes ne s'annonce
  // pas sous le nom de la premiere.
  const noms = [...new Set((d.terrains || [d.terrain])
    .map((t) => t?.commune?.nom).filter(Boolean))];
  const commune = noms.length > 1 ? `${noms.length} communes` : (noms[0] || '');
  return [
    demandes > 1 ? 'Certificats d’urbanisme' : 'Certificat d’urbanisme',
    commune ? `— ${commune}` : '',
    d.reference ? `— ${d.reference}` : '',
    demandes > 1 ? `— ${demandes} demandes` : '',
    '— à imprimer et à envoyer en recommandé',
  ].filter(Boolean).join(' ');
}

function adresseMairie(d) {
  return adressePostale({
    destinataire: 'Monsieur le Maire',
    nom: d.mairie?.nom || `Mairie de ${d.terrain?.commune?.nom || ''}`,
    adresse: d.mairie?.adresse,
    complement: d.mairie?.complement,
    codePostal: d.mairie?.codePostal,
    commune: d.mairie?.commune || d.terrain?.commune?.nom,
  });
}

/**
 * @param {object} d          la demande telle qu'elle a été saisie
 * @param {object} pagination { total, feuilles, exemplaires, dossiers:[…] }
 * @param {string} fichier    nom de la pièce jointe
 * @param {object} [etat]
 *   planJoint  la pièce jointe contient-elle le plan ? (forme à une demande)
 *   demandes   [{reference, parcelles, plan, annexe}] — le compte rendu par
 *              unité foncière, qui dit pour CHACUNE si son plan est là.
 */
export function consignes(d, pagination, fichier, { planJoint = true, demandes = null } = {}) {
  const blocs = pagination?.dossiers || [];
  const nombre = Math.max(blocs.length, 1);
  const sansPlan = demandes
    ? demandes.map((x, i) => (x.plan ? null : (blocs[i]?.reference || `demande ${i + 1}`)))
      .filter(Boolean)
    : (planJoint ? [] : [blocs[0]?.reference || null]);

  // Les mairies par demande, alignees sur les blocs : c'est ce qui permet a
  // chaque etape de porter SON adresse quand le lot couvre plusieurs communes.
  const mairies = (demandes || []).map((x) => x?.mairie || null);
  const communesDistinctes = [...new Set((demandes || []).map((x) => x?.commune).filter(Boolean))];
  const plusieursCommunes = communesDistinctes.length > 1;

  const rappel = nombre > 1
    ? rappelPlusieurs(d, blocs, plusieursCommunes ? communesDistinctes : null)
    : rappelUnique(d);
  const etapes = nombre > 1
    ? etapesPlusieurs(pagination, blocs, sansPlan, plusieursCommunes ? mairies : null)
    : etapesUnique(pagination, sansPlan.length === 0);

  const ouverture = nombre > 1
    ? `Merci de bien vouloir adresser les ${nombre} demandes de certificat d’urbanisme `
      + `ci-jointes (${fichier}).`
    : `Merci de bien vouloir adresser la demande de certificat d’urbanisme ci-jointe (${fichier}).`;

  const texte = [
    'Bonjour,',
    '',
    ouverture,
    '',
    ...rappel.map(([k, v]) => `${k} : ${v}`),
    '',
    ...etapes.map((s, i) => `${i + 1}. ${s}`),
    '',
    // Deux communes, deux guichets : une adresse unique en pied serait fausse
    // pour l'un des deux plis. Chaque etape porte alors la sienne.
    ...(plusieursCommunes
      ? ['Chaque demande part a SA mairie : l\u2019adresse figure dans son etape ci-dessus.']
      : ['Adresse du destinataire :', adresseMairie(d)]),
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
    p('<b>Adresse du destinataire :</b>'),
    ...adresseMairie(d).split('\n').map((l) => p(e(l))),
    vide(),
    p('Merci beaucoup.'),
  ].join('\n');

  return { objet: objetCourriel(d, nombre), texte, html };
}

/* ------------------------------------------------------------ une demande */

function rappelUnique(d) {
  const surface = metresCarres(d.terrain?.superficie ?? contenanceTotale(d.terrain?.parcelles));
  return [
    ['Dossier', d.reference],
    ['Commune', [d.terrain?.commune?.nom, d.terrain?.commune?.code].filter(Boolean).join(' — ')],
    ['Terrain', d.terrain?.adresse],
    ['Références cadastrales', designerParcelles(d.terrain?.parcelles)],
    ['Contenance', surface],
    ['Formulaire', `${CERFA}, établi le ${dateCourte(d.date)}`],
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

/* ------------------------------------------------- plusieurs unités foncières */

function rappelPlusieurs(d, blocs, communes = null) {
  return [
    ['Dossier', d.reference],
    communes
      ? ['Communes', communes.join(', ')]
      : ['Commune', [d.terrain?.commune?.nom, d.terrain?.commune?.code].filter(Boolean).join(' — ')],
    communes ? null : ['Terrain', d.terrain?.adresse],
    ['Nombre de demandes', `${blocs.length} — une par unité foncière`],
    ['Formulaire', `${CERFA}, établi le ${dateCourte(d.date)}`],
  ].filter((l) => l && l[1]);
}

function etapesPlusieurs(pagination, blocs, sansPlan, mairies = null) {
  const etapes = [
    `Imprimer la pièce jointe en entier, EN RECTO VERSO — ${pagination?.total || '?'} pages, `
    + `soit ${pagination?.feuilles || '?'} feuilles.`,
    ECHELLE,

    // Le POURQUOI avant le COMMENT : sans cette phrase, deux demandes à la même
    // mairie pour le même client passent pour un doublon, et l'une des deux
    // finit à la corbeille.
    `Ce pli n’en est pas un mais ${blocs.length} : les parcelles forment ${blocs.length} unités `
    + 'foncières distinctes, et un certificat d’urbanisme ne porte que sur une unité. Chaque '
    + 'demande a sa lettre, sa référence et ses deux exemplaires. Ne pas les mélanger.',
  ];

  for (const bloc of blocs) {
    const ex = bloc.exemplaires || [];
    const bornes = (i) => (ex[i] ? `pages ${ex[i].de} à ${ex[i].a}` : 'à repérer');
    etapes.push(
      `Demande ${bloc.reference || ''} — ${(bloc.parcelles || []).join(', ')} : la lettre `
      + `page ${bloc.de}, puis deux exemplaires identiques, ${bornes(0)} et ${bornes(1)}. `
      + 'Agrafer chaque exemplaire pour lui-même, sans l’agrafer à sa lettre.'
      + (bloc.planParExemplaire
        ? ` Les ${bloc.planParExemplaire} dernières pages de chaque exemplaire sont le plan de `
          + 'situation, à ne pas agrafer au formulaire.'
        : '')
      // L'adresse dans l'etape meme, en une ligne : c'est au moment ou
      // l'assistante tient CE pli qu'elle a besoin de SA destination.
      + (mairies && mairies[blocs.indexOf(bloc)]
        ? ` À envoyer à : ${String(mairies[blocs.indexOf(bloc)]).replace(/\n+/g, ', ')}.`
        : ''));
  }

  if (sansPlan.length) {
    etapes.push(
      `LE PLAN DE SITUATION N’EST PAS DANS LA PIÈCE JOINTE pour ${sansPlan.join(', ')} : `
      + 'en imprimer deux exemplaires par demande concernée et en glisser un dans chacun. '
      + 'C’est la seule pièce exigée à l’appui de la demande, et son absence la rend incomplète.');
  }

  etapes.push(
    `Envoyer ${blocs.length} plis SÉPARÉS, un par demande — sa lettre et ses deux exemplaires —, `
    + 'chacun en lettre recommandée avec avis de réception, à la même adresse ci-dessous. Un pli '
    + 'unique ferait courir un seul avis de réception pour deux demandes dont les délais sont '
    + 'distincts.',
    'Conserver les preuves de dépôt et les avis de réception, et me les transmettre : c’est la '
    + 'date de réception en mairie qui fait courir le délai d’un mois, au terme duquel le silence '
    + 'vaut certificat tacite.');

  return etapes;
}
