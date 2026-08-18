// CERTIF — l'adresse de la mairie d'une commune
//
// L'écran l'appelle dès que la commune est choisie, pour préremplir l'adresse
// du destinataire. Le notaire garde la main : ce qui revient d'ici est une
// proposition affichée dans des champs modifiables, jamais une valeur figée.

import { protege } from '../lib/verrou.js';
import { chercherMairie } from '../lib/mairie.js';

export default protege(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ erreur: 'GET attendu' });

  const code = String(req.query?.code || '').trim();
  if (!code) return res.status(400).json({ erreur: 'paramètre code obligatoire' });

  const r = await chercherMairie(code);

  // « Indisponible » n'est pas « introuvable ». L'écran doit pouvoir dire au
  // notaire « l'annuaire ne répond pas, saisissez l'adresse » plutôt que
  // « cette commune n'a pas de mairie ».
  if (r.etat === 'indisponible') return res.status(502).json(r);
  return res.status(200).json(r);
});
