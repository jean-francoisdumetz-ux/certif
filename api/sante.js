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
    // Le trio qui a manque pendant la panne du 20/08 — 1 h 40 a tester le
    // domaine public sans savoir quel deploiement il servait. `deploiement`
    // change a CHAQUE deploiement, rejeu compris : c'est lui qui dit si une
    // correction est en ligne. `commit` designe le code ; un Redeploy garde le
    // meme. La region se constate ici a l'execution, pas dans un reglage.
    execution: {
      region: process.env.VERCEL_REGION || null,
      environnement: process.env.VERCEL_ENV || null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      deploiement: process.env.VERCEL_DEPLOYMENT_ID || null,
      node: process.version,
    },
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
    // Le plan de situation est fabriqué, mais il dépend de deux services
    // extérieurs : le cadastre et le fond de plan. On dit ici qu'il est branché,
    // pas qu'il répondra — cela se vérifie sur /api/plan, dossier en main.
    planDeSituation: { branche: true, diagnostic: '/api/plan?journal=1' },
  });
}
