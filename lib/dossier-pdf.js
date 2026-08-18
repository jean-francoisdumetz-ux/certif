// CERTIF — assemblage du document unique à imprimer
//
// Un seul PDF, un seul bouton, une seule impression. L'ordre est fixe :
//
//   lettre d'accompagnement          une fois, pour l'envoi entier
//   exemplaire 1   Cerfa 13410*13 (p. 1 à 3) · annexe s'il y a lieu · plan
//   exemplaire 2   idem, à l'identique
//
// UNE lettre pour DEUX exemplaires : c'est un pli, pas deux envois. Le
// formulaire est celui qui se produit en deux exemplaires — l'article R*410-2
// pour un certificat relevant du a) de L. 410-1, ce que l'imprimé rappelle
// lui-même en page 3 — et la lettre est le courrier qui les accompagne.
//
// Les deux exemplaires sont rigoureusement identiques. On ne marque RIEN
// dessus : ni « exemplaire 1 sur 2 », ni numéro de page. Une mention ajoutée
// sur un Cerfa officiel est une altération de l'imprimé. Les bornes de pages
// partent dans le courriel à l'assistante, pas sur le document.
//
// RECTO VERSO : CHAQUE BLOC COMMENCE SUR UNE FEUILLE NEUVE. La lettre, puis
// chaque exemplaire, sont complétés par une page blanche quand leur compte est
// impair. Sans cela l'impression recto verso colle le dos de la lettre au
// premier Cerfa, et la dernière page d'un exemplaire au dos du suivant — deux
// exemplaires qu'on ne peut plus séparer sans les déchirer.
//
// La règle est générale et non taillée sur un cas : elle vaut que le plan soit
// joint ou non, que l'annexe existe ou non. C'est ce qui la rend sûre — un
// calcul qui marche pour neuf pages et casse pour onze n'aurait été vérifié
// qu'une fois.
//
// Le Cerfa et le plan arrivent ici déjà fabriqués, en octets — ce qui permet
// d'éprouver tout l'assemblage sans gabarit ni accès réseau.

import { PDFDocument } from 'pdf-lib';
import { construireLettre } from './lettre.js';

async function nombreDePages(octets) {
  if (!octets) return 0;
  return (await PDFDocument.load(octets)).getPageCount();
}

/**
 * @param {object} o
 *   demande  {office, mairie, terrain, reference, date, motif}
 *   cerfa    Uint8Array — le formulaire rempli, aplati, pages 1 à 3
 *   annexe   Uint8Array|null — références cadastrales complémentaires
 *   plan     Uint8Array — le plan de situation
 *   images   {signature?} — paraphe déjà descellé
 *   rectoVerso  true par défaut : chaque bloc commence sur une feuille neuve
 * @returns {Promise<{octets:Uint8Array, pagination:object}>}
 */
export async function construireDossier({
  demande, cerfa, annexe, plan, images = {}, rectoVerso = true,
}) {
  if (!cerfa) throw new Error('le Cerfa rempli est requis');

  const lettre = await construireLettre(demande, images);
  const utiles = (await nombreDePages(cerfa))
    + (await nombreDePages(annexe)) + (await nombreDePages(plan));

  const pair = (n) => (rectoVerso && n % 2 ? n + 1 : n);
  const pagesLettre = pair(lettre.pages);
  const parExemplaire = pair(utiles);

  // L'annexe des références cadastrales complémentaires fait partie de la
  // demande, pas des pièces jointes : elle suit immédiatement l'imprimé
  // qu'elle complète, dans CHAQUE exemplaire. Un exemplaire dont l'annexe
  // manquerait désignerait trois parcelles au lieu de dix.
  const final = await PDFDocument.create();
  await verser(final, lettre.octets);
  completer(final, pagesLettre - lettre.pages);
  for (let i = 0; i < 2; i += 1) {
    await verser(final, cerfa);
    if (annexe) await verser(final, annexe);
    if (plan) await verser(final, plan);
    completer(final, parExemplaire - utiles);
  }

  const debut = pagesLettre + 1;
  const blanches = (pagesLettre - lettre.pages) + 2 * (parExemplaire - utiles);
  const pagination = {
    lettre: pagesLettre,
    parExemplaire,
    utilesParExemplaire: utiles,
    blanches,
    rectoVerso,
    total: pagesLettre + 2 * parExemplaire,
    feuilles: Math.ceil((pagesLettre + 2 * parExemplaire) / 2),
    exemplaires: [
      { de: debut, a: debut + parExemplaire - 1 },
      { de: debut + parExemplaire, a: debut + 2 * parExemplaire - 1 },
    ],
  };

  final.setTitle(`Certificat d'urbanisme — ${demande.terrain?.commune?.nom || ''} — ${demande.reference || ''}`.trim());
  final.setProducer('CERTIF');
  final.setCreator('CERTIF — FIDAL Notaires');

  const octets = await final.save();

  // Le compte annoncé dans le courriel doit être celui du document produit.
  // S'ils divergent, l'assistante sépare les exemplaires au mauvais endroit.
  if (final.getPageCount() !== pagination.total) {
    throw new Error(
      `pagination incohérente : ${final.getPageCount()} pages produites, ${pagination.total} annoncées`);
  }

  return { octets, pagination };
}

/** Nom de fichier : lisible dans une boîte aux lettres, triable, sans accent. */
export function nomFichier(demande) {
  const commune = (demande.terrain?.commune?.nom || 'commune')
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
  const reference = (demande.reference || '').replace(/[^A-Za-z0-9-]+/g, '');
  return ['CU', commune, reference].filter(Boolean).join('_') + '.pdf';
}

/** Des pages blanches, au format de la page courante. */
function completer(destination, combien) {
  for (let i = 0; i < combien; i += 1) {
    const derniere = destination.getPages()[destination.getPageCount() - 1];
    const taille = derniere ? derniere.getSize() : { width: 595.276, height: 841.89 };
    destination.addPage([taille.width, taille.height]);
  }
}

async function verser(destination, octets) {
  const source = await PDFDocument.load(octets);
  const pages = await destination.copyPages(source, source.getPageIndices());
  pages.forEach((p) => destination.addPage(p));
}
