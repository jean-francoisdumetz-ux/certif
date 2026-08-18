// CERTIF — le bouton : produit le PDF prêt à imprimer
//
// Rend le document lui-même, en octets, plus un en-tête qui porte le compte de
// pages et les avertissements. L'écran affiche ceux-ci AVANT que le notaire
// n'ouvre le fichier : un plan de situation manquant ou des pièces non signées
// doivent se voir sans avoir à feuilleter onze pages.

import { protege } from '../lib/verrou.js';
import { demandeDepuisRequete, preparerDossier, Refus } from '../lib/preparer.js';

/**
 * Ce qu'un fichier peut peser, avec la marge qu'impose la plateforme.
 *
 * Vercel ne rend pas une réponse de plus de 4,5 Mo. On vise 3,8 : il reste
 * l'en-tête du compte rendu, et le poids d'une demande n'est estimé qu'à un
 * pour cent près. Une demande pèse environ 900 ko, plan compris — quatre par
 * fichier, donc.
 */
const BUDGET = 3.8 * 1024 * 1024;

export default protege(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu' });

  try {
    const demande = demandeDepuisRequete(req.body || {});

    // UN GROS DOSSIER SORT EN PLUSIEURS FICHIERS, ET C'EST L'ÉCRAN QUI BOUCLE.
    //
    // La plateforme ne rend pas plus de 4,5 Mo par réponse : au-delà, la requête
    // échoue sur une erreur qui ne dit rien, après une minute d'attente et une
    // dizaine d'appels au cadastre. Plutôt que de refuser un dossier de six
    // communes, on en rend les quatre premières demandes et on dit OÙ REPRENDRE.
    // L'écran redemande, avec ce curseur, et télécharge la partie suivante.
    //
    // Les communes déjà servies ne sont pas réexaminées : le curseur porte le
    // rang de la commune et celui de l'unité foncière, et la fabrication reprend
    // exactement là. Rien n'est demandé deux fois au cadastre, hormis la commune
    // à cheval sur la coupure.
    const partie = Math.max(1, Number(req.body?.partie) || 1);
    const r = await preparerDossier(demande, req.body?.phrase, {
      depuis: req.body?.depuis || null,
      budget: BUDGET,
      // Le nom ne porte un numéro de partie que s'il y en a plusieurs — ce que
      // l'on sait à la première réponse, puisqu'elle annonce une suite.
      partie: partie > 1 ? partie : 0,
    });

    // La première partie ne sait qu'à la fin qu'elle en appelle une seconde :
    // son nom doit alors le dire aussi.
    const fichier = r.suite && partie === 1
      ? r.fichier.replace(/\.pdf$/i, '_partie-1.pdf')
      : r.fichier;

    // Le compte-rendu voyage en en-tête plutôt que dans le corps : le corps,
    // c'est le PDF. Encodé en base64 parce qu'un en-tête HTTP ne transporte
    // pas d'accents.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fichier}"`);
    res.setHeader('X-Certif-Compte-Rendu', Buffer.from(JSON.stringify({
      fichier,
      partie,
      // Le curseur de reprise, nul quand tout tient dans ce fichier.
      suite: r.suite,
      pagination: r.pagination,
      signature: r.signature,
      annexe: r.annexe,
      plan: r.plan,
      // Une demande par unité foncière : l'écran doit pouvoir annoncer
      // « 2 demandes produites » et dire laquelle porte sur quelles parcelles.
      demandes: r.demandes,
      unitesFoncieres: r.unitesFoncieres,
      avertissements: r.avertissements,
    }), 'utf8').toString('base64'));

    return res.status(200).send(Buffer.from(r.octets));
  } catch (e) {
    if (e instanceof Refus) return res.status(e.code).json({ erreur: e.message, ...e.details });
    console.error('[CERTIF] generer', e);
    return res.status(500).json({ erreur: e.message });
  }
});
