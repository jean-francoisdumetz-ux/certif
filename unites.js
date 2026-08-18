// CERTIF — combien d'unités foncières ces parcelles forment-elles ?
//
// La question se pose AVANT de fabriquer quoi que ce soit : un certificat
// d'urbanisme porte sur une unité foncière, et deux parcelles qui ne se
// touchent pas en appellent deux. L'écran interroge donc cette route dès que la
// saisie compte plusieurs parcelles, pour le dire pendant qu'il est encore
// temps de corriger — et non au moment de cliquer sur « Générer ».
//
// La génération refait le contrôle de son côté (lib/preparer.js). Ce n'est pas
// une redite inutile : cette route-ci renseigne, celle-là interdit. Un contrôle
// qui ne vivrait qu'à l'écran se contournerait en rechargeant la page.
//
// Elle ne touche à rien : ni base, ni écriture, ni fabrication.

import { protege } from '../lib/verrou.js';
import { geometriesParcelles } from '../lib/cadastre.js';
import { groupementDeLaSaisie, TOLERANCE } from '../lib/unite-fonciere.js';

const texte = (v) => (v === undefined || v === null ? '' : String(v).trim());

export default protege(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu' });

  const corps = req.body || {};
  const c = corps.commune || {};
  const commune = {
    code: texte(c.code),
    nom: texte(c.nom),
    chefLieu: texte(c.chefLieu) || null,
  };
  if (!commune.code) return res.status(400).json({ erreur: 'commune absente' });

  const parcelles = (Array.isArray(corps.parcelles) ? corps.parcelles : [])
    .map((p) => ({
      prefixe: texte(p.prefixe) || null,
      section: texte(p.section).toUpperCase(),
      numero: texte(p.numero),
    }))
    .filter((p) => p.section && p.numero);

  if (parcelles.length < 2) {
    return res.status(200).json({
      unites: parcelles.length
        ? [{ rang: 1, parcelles: parcelles.map((p) => [p.prefixe, p.section, p.numero].filter(Boolean).join(' ')), contourConnu: true }]
        : [],
      contiguiteSeule: true,
      question: false,
    });
  }

  let cadastre;
  try {
    cadastre = await geometriesParcelles(parcelles, commune);
  } catch (e) {
    return res.status(502).json({ erreur: `cadastre injoignable : ${e.message}` });
  }

  const groupement = groupementDeLaSaisie(parcelles, cadastre);
  const verifiees = groupement.unites.filter((u) => u.contourConnu);

  return res.status(200).json({
    unites: groupement.unites,
    verifiees: verifiees.length,
    // Ce que CERTIF a vérifié, et ce qu'il n'a PAS vérifié. La seconde ligne
    // compte autant que la première : la contiguïté ne fait pas l'unité
    // foncière à elle seule.
    contiguiteSeule: true,
    tolerance: TOLERANCE,
    motif: groupement.motif || cadastre.motif || null,
    question: verifiees.length > 1,
    journal: cadastre.journal,
  });
});
