// CERTIF — dépose dans Outlook un brouillon avec le dossier en pièce jointe
//
// Un BROUILLON, jamais un envoi. Le notaire relit, ajoute ce qu'il veut, et
// clique lui-même. C'est la règle posée sur MATRICE le jour où un seul bouton
// aurait déclenché quarante-sept courriels irréversibles.
//
// Le PDF joint est fabriqué par le même chemin que celui du bouton de
// téléchargement : le document relu et le document envoyé sont le même.

import { protege } from '../lib/verrou.js';
import { demandeDepuisRequete, preparerDossier, Refus } from '../lib/preparer.js';
import { consignes } from '../lib/consignes.js';
import { deposerBrouillon } from '../lib/courriel.js';
import { envelopper } from '../lib/signature-mail.js';

export default protege(async (req, res, utilisateur, jetonDelegue) => {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu' });

  try {
    const demande = demandeDepuisRequete(req.body || {});
    const r = await preparerDossier(demande, req.body?.phrase);

    const destinataires = String(req.body?.destinataire || '')
      .split(/[;,]/).map((s) => s.trim()).filter(Boolean);

    // La consigne dit ce que la pièce jointe contient vraiment. Quand le plan
    // a pu être fabriqué, elle se tait là-dessus ; quand il manque, elle le
    // réclame en toutes lettres.
    const c = consignes(demande, r.pagination, r.fichier, {
      planJoint: Boolean(r.plan), demandes: r.demandes,
    });
    const { html, images } = envelopper(c.html);

    const depot = await deposerBrouillon({
      objet: c.objet,
      corps: c.texte,
      corpsHtml: html,
      imagesEnLigne: images,
      destinataires,
      pieces: [{ nom: r.fichier, type: 'application/pdf', contenu: Buffer.from(r.octets) }],
      jetonDelegue,
    });

    return res.status(200).json({
      voie: depot.voie,
      fichier: r.fichier,
      pagination: r.pagination,
      signature: r.signature,
      plan: r.plan,
      demandes: r.demandes,
      unitesFoncieres: r.unitesFoncieres,
      avertissements: r.avertissements,
      destinataires,
      // Le repli .eml n'est pas un échec, mais il ne doit pas passer pour un
      // succès : l'écran affiche le motif, et le fichier se télécharge.
      ...(depot.voie === 'eml'
        ? { eml: depot.eml, nomEml: r.fichier.replace(/\.pdf$/i, '.eml'), motif: depot.motif }
        : { webLink: depot.webLink }),
    });
  } catch (e) {
    if (e instanceof Refus) return res.status(e.code).json({ erreur: e.message, ...e.details });
    console.error('[CERTIF] courriel', e);
    return res.status(500).json({ erreur: e.message });
  }
});
