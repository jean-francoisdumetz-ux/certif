// CERTIF — le bouton : produit le PDF prêt à imprimer
//
// Rend le document lui-même, en octets, plus un en-tête qui porte le compte de
// pages et les avertissements. L'écran affiche ceux-ci AVANT que le notaire
// n'ouvre le fichier : un plan de situation manquant ou des pièces non signées
// doivent se voir sans avoir à feuilleter onze pages.

import { protege } from '../lib/verrou.js';
import { demandeDepuisRequete, preparerDossier, Refus } from '../lib/preparer.js';

export default protege(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu' });

  try {
    const demande = demandeDepuisRequete(req.body || {});
    const r = await preparerDossier(demande, req.body?.phrase);

    // Le compte-rendu voyage en en-tête plutôt que dans le corps : le corps,
    // c'est le PDF. Encodé en base64 parce qu'un en-tête HTTP ne transporte
    // pas d'accents.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${r.fichier}"`);
    res.setHeader('X-Certif-Compte-Rendu', Buffer.from(JSON.stringify({
      fichier: r.fichier,
      pagination: r.pagination,
      signature: r.signature,
      annexe: r.annexe,
      plan: r.plan,
      avertissements: r.avertissements,
    }), 'utf8').toString('base64'));

    return res.status(200).send(Buffer.from(r.octets));
  } catch (e) {
    if (e instanceof Refus) return res.status(e.code).json({ erreur: e.message, ...e.details });
    console.error('[CERTIF] generer', e);
    return res.status(500).json({ erreur: e.message });
  }
});
