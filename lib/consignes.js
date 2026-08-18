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
// Deux versions du même texte, tenues côte à côte : le texte brut et le HTML.
// C'est la leçon de MATRICE — un message dont les deux versions divergent
// finit par montrer au destinataire celle qu'on n'a pas relue.

import { e, p, vide } from './signature-mail.js';
import { adressePostale, designerParcelles, contenanceTotale, metresCarres, dateCourte } from './format.js';

const CERFA = 'Cerfa n° 13410*13';

export function objetCourriel(d) {
  const commune = d.terrain?.commune?.nom || '';
  return [
    'Certificat d’urbanisme',
    commune ? `— ${commune}` : '',
    d.reference ? `— ${d.reference}` : '',
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
 * @param {object} d          la demande
 * @param {object} pagination { total, parExemplaire, exemplaires:[{de,a},…] }
 * @param {string} fichier    nom de la pièce jointe
 * @param {object} [etat]     { planJoint } — ce que la pièce jointe contient
 *                            vraiment, pour que la consigne le dise.
 */
export function consignes(d, pagination, fichier, { planJoint = true } = {}) {
  const surface = metresCarres(d.terrain?.superficie ?? contenanceTotale(d.terrain?.parcelles));
  const ex = pagination?.exemplaires || [];
  const bornes = (i) => (ex[i] ? `pages ${ex[i].de} à ${ex[i].a}` : 'à repérer');

  const rappel = [
    ['Dossier', d.reference],
    ['Commune', [d.terrain?.commune?.nom, d.terrain?.commune?.code].filter(Boolean).join(' — ')],
    ['Terrain', d.terrain?.adresse],
    ['Références cadastrales', designerParcelles(d.terrain?.parcelles)],
    ['Contenance', surface],
    ['Formulaire', `${CERFA}, établi le ${dateCourte(d.date)}`],
  ].filter(([, v]) => v);

  const etapes = [
    `Imprimer la pièce jointe en entier — ${pagination?.total || '?'} pages.`,
    `La page 1 est la lettre d’accompagnement, à joindre une seule fois.`,
    `Suivent deux exemplaires identiques de la demande : ${bornes(0)} et ${bornes(1)}. `
    + `Agrafer chaque exemplaire pour lui-même, sans les agrafer à la lettre.`,

    // Dit seulement quand c'est vrai. Une consigne qui réclame une pièce déjà
    // présente use la confiance qu'on accorde aux autres.
    planJoint ? null
      : `LE PLAN DE SITUATION N’EST PAS DANS LA PIÈCE JOINTE : en imprimer deux exemplaires `
        + `et en glisser un dans chacun. C’est la seule pièce exigée à l’appui de la demande, `
        + `et son absence la rend incomplète.`,

    `Envoyer le tout dans un seul pli, en lettre recommandée avec avis de réception, `
    + `à l’adresse ci-dessous.`,
    `Conserver la preuve de dépôt et l’avis de réception, et me les transmettre : c’est la date `
    + `de réception en mairie qui fait courir le délai d’un mois, au terme duquel le silence `
    + `vaut certificat tacite.`,
  ].filter(Boolean);

  const texte = [
    'Bonjour,',
    '',
    `Merci de bien vouloir adresser la demande de certificat d’urbanisme ci-jointe (${fichier}).`,
    '',
    ...rappel.map(([k, v]) => `${k} : ${v}`),
    '',
    ...etapes.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Adresse du destinataire :',
    adresseMairie(d),
    '',
    'Merci beaucoup.',
  ].join('\n');

  const html = [
    p('Bonjour,'),
    vide(),
    p(`Merci de bien vouloir adresser la demande de certificat d’urbanisme ci-jointe (${e(fichier)}).`),
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

  return { objet: objetCourriel(d), texte, html };
}
