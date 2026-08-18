// CERTIF — le plan de situation seul, pour le mettre à l'épreuve
//
// Cette route existe parce que le plan est la seule partie de CERTIF qui n'a
// pas pu être éprouvée hors ligne : elle dépend de deux services extérieurs,
// le cadastre et le fond de plan de la Géoplateforme. Plutôt que de laisser
// une panne se manifester par un dossier silencieusement incomplet, on l'isole.
//
//   POST /api/plan             rend le plan en PDF
//   POST /api/plan?journal=1   rend le compte rendu en JSON : ce qui a été
//                              demandé au cadastre, combinaison par combinaison,
//                              ce que PAINT a répondu, et par quelle voie le
//                              plan a finalement été obtenu.
//   POST /api/plan?sansPaint=1 force la carte de secours, pour l'éprouver
//                              sans avoir à débrancher PAINT.

import { protege } from '../lib/verrou.js';
import { demandeDepuisRequete, Refus } from '../lib/preparer.js';
import { construirePlan } from '../lib/plan.js';

export default protege(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu' });

  try {
    const demande = demandeDepuisRequete(req.body || {});
    const r = await construirePlan(demande, req.query?.sansPaint ? { sansPaint: true } : {});

    if (r.erreur) return res.status(502).json({ erreur: r.erreur, journal: r.journal });

    if (req.query?.journal) {
      return res.status(200).json({
        voie: r.voie, echelle: r.echelle, details: r.details, journal: r.journal,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="plan-de-situation.pdf"');
    return res.status(200).send(Buffer.from(r.octets));
  } catch (e) {
    if (e instanceof Refus) return res.status(e.code).json({ erreur: e.message, ...e.details });
    console.error('[CERTIF] plan', e);
    return res.status(500).json({ erreur: e.message });
  }
});
