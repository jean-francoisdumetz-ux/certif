// CERTIF — état de la configuration
//
// Des booléens, jamais des valeurs. Savoir qu'un secret est en place n'est pas
// un secret ; le lire en est un. C'est la règle posée sur MATRICE, et elle vaut
// d'autant plus ici que la route est ouverte pour permettre le diagnostic
// depuis n'importe quel poste.

import { gabaritPresent, MILLESIME } from '../lib/cerfa-cu.js';
import { present as enTetePresent } from '../lib/papier-en-tete.js';
import { polices } from '../lib/mise-en-page.js';
import { sceauConfigure } from '../lib/sceau.js';
import { officeManquant } from '../lib/office.js';
import { signatureMail } from '../lib/signature-mail.js';

export default async function (req, res) {
  const manquantes = officeManquant();
  const sceau = sceauConfigure();

  return res.status(200).json({
    outil: 'CERTIF',
    formulaire: { millesime: MILLESIME, gabarit: gabaritPresent() },
    identite: { complete: manquantes.length === 0, aRenseigner: manquantes },
    documents: {
      papierEnTete: enTetePresent(),
      policesMaison: polices(),
      signatureManuscrite: sceau.signature,
      signatureCourriel: signatureMail().presente,
    },
    courriel: {
      entra: Boolean(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID),
      boiteService: Boolean(process.env.CERTIF_BOITE_SERVICE || process.env.MATRICE_BOITE_SERVICE),
    },
    // Ce que CERTIF ne sait pas encore faire, dit ici plutôt que découvert à
    // l'usage : le plan de situation est la seule pièce exigée par R*410-1.
    reste: { planDeSituation: false },
  });
}
