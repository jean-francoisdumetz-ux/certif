// CERTIF — préparation d'une demande, du formulaire reçu au PDF prêt à partir
//
// Un seul chemin, employé par les deux routes : celle qui télécharge le PDF et
// celle qui dépose le brouillon Outlook. C'est délibéré — si chacune fabriquait
// le sien, le jour où l'une évolue, l'assistante imprimerait un document et le
// notaire en aurait relu un autre.
//
// LES REFUS SONT ICI, ET ILS SONT EXPLICITES. Rien n'est complété d'office :
// une donnée manquante arrête la génération et se dit par son nom. C'est la
// leçon de MATRICE, où un défaut « de test » avait fait partir un PDF portant
// une adresse inventée.

import { office, demandeurDepuisOffice, officeManquant } from './office.js';
import { imagesScellees } from './sceau.js';
import { remplirCerfa } from './cerfa-cu.js';
import { construireAnnexe } from './annexe.js';
import { construireDossier, nomFichier } from './dossier-pdf.js';
import { caracteresPerdus, polices } from './mise-en-page.js';
import { construirePlan } from './plan.js';

export class Refus extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const texte = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * Construit l'objet demande à partir de ce que l'écran a envoyé.
 *
 * @throws {Refus} 503 si l'identité de l'office n'est pas configurée,
 *                 400 si la demande elle-même est incomplète.
 */
export function demandeDepuisRequete(corps = {}) {
  const manquantes = officeManquant();
  if (manquantes.length) {
    throw new Refus(503, "l'identité de l'office n'est pas configurée", { variables: manquantes });
  }

  const absents = [];
  const reference = texte(corps.reference);
  if (!reference) absents.push('référence de dossier');

  const commune = corps.commune || {};
  if (!texte(commune.code) || !texte(commune.nom)) absents.push('commune (code INSEE et nom)');

  const parcelles = (Array.isArray(corps.parcelles) ? corps.parcelles : [])
    .map((p) => ({
      prefixe: texte(p.prefixe) || null,
      section: texte(p.section).toUpperCase(),
      numero: texte(p.numero),
      lieuDit: texte(p.lieuDit) || null,
      contenance: p.contenance === '' || p.contenance === null || p.contenance === undefined
        ? null : Number(p.contenance),
    }))
    .filter((p) => p.section || p.numero);

  if (parcelles.length === 0) absents.push('au moins une parcelle');
  parcelles.forEach((p, i) => {
    if (!p.section) absents.push(`section de la parcelle ${i + 1}`);
    if (!p.numero) absents.push(`numéro de la parcelle ${i + 1}`);
    if (p.contenance !== null && !Number.isFinite(p.contenance)) {
      absents.push(`contenance de la parcelle ${i + 1} (nombre attendu)`);
    }
  });

  const mairie = corps.mairie || {};
  if (!texte(mairie.adresse) || !texte(mairie.codePostal)) {
    absents.push("adresse postale de la mairie (c'est elle qui figure sur le recommandé)");
  }

  if (absents.length) {
    throw new Refus(400, 'demande incomplète', { manque: absents });
  }

  const o = office();
  return {
    office: o,
    demandeur: demandeurDepuisOffice(o),
    reference,
    date: corps.date ? new Date(corps.date) : new Date(),
    accepterVoieElectronique: corps.accepterVoieElectronique !== false,
    mairie: {
      nom: texte(mairie.nom) || `Mairie de ${texte(commune.nom)}`,
      adresse: texte(mairie.adresse),
      complement: texte(mairie.complement) || null,
      codePostal: texte(mairie.codePostal),
      commune: texte(mairie.commune) || texte(commune.nom),
    },
    terrain: {
      commune: {
        code: texte(commune.code),
        nom: texte(commune.nom),
        chefLieu: texte(commune.chefLieu) || null,
      },
      adresse: texte(corps.adresse) || null,
      codePostal: texte(corps.codePostalTerrain) || null,
      lieuDit: texte(corps.lieuDit) || null,
      parcelles,
    },
  };
}

/**
 * Fabrique le PDF complet.
 *
 * @param {object} demande
 * @param {string} [phrase]  la phrase qui ouvre le paraphe scellé
 * @param {object} [options] { sansPlan } pour produire sans carte
 */
export async function preparerDossier(demande, phrase, { sansPlan = false } = {}) {
  let images = {};
  let etatSignature = 'non_configure';
  try {
    const sceau = imagesScellees(phrase);
    images = sceau.images;
    etatSignature = sceau.etat;
  } catch (e) {
    if (e.phraseFausse) throw new Refus(403, e.message);
    throw e;
  }

  // Le plan de situation dépend de deux services extérieurs. Son échec
  // n'empêche PAS de produire le dossier : il descend en avertissement, et le
  // notaire décide. Bloquer là-dessus reviendrait à laisser une panne du
  // cadastre arrêter les envois de l'étude.
  let plan = null;
  let planEchec = null;
  if (!sansPlan) {
    try {
      const carte = await construirePlan(demande);
      if (carte.erreur) planEchec = carte.erreur;
      else plan = { octets: carte.octets, voie: carte.voie, echelle: carte.echelle, details: carte.details };
    } catch (e) {
      planEchec = `plan de situation : ${e.message}`;
    }
  }

  const cerfa = await remplirCerfa(demande, images);
  const annexe = await construireAnnexe(demande);
  const { octets, pagination } = await construireDossier({
    demande, cerfa, annexe: annexe?.octets, plan: plan?.octets, images,
  });

  return {
    octets,
    pagination,
    fichier: nomFichier(demande),
    signature: etatSignature,
    annexe: annexe ? { pages: annexe.pages, parcelles: annexe.nombre } : null,
    plan: plan ? { voie: plan.voie, echelle: plan.echelle, details: plan.details } : null,
    avertissements: avertir(demande, etatSignature, plan, planEchec),
  };
}

/**
 * Ce qui n'empêche pas de produire, mais que le notaire doit savoir avant
 * d'envoyer. On avertit plutôt que de bloquer : c'est lui qui décide si un
 * pli part sans son plan de situation, pas l'outil.
 */
function avertir(demande, etatSignature, plan, planEchec) {
  const liste = [];

  if (!plan) {
    liste.push("le plan de situation n'est PAS joint — c'est la seule pièce exigée à l'appui "
      + "d'une demande de certificat d'urbanisme d'information (art. R*410-1)"
      + (planEchec ? ` : ${planEchec}` : ''));
  }
  // Le repli ne doit pas passer pour la voie normale : l'extrait officiel du
  // cadastre et une carte fabriquée par nos soins ne se valent pas devant un
  // service d'urbanisme.
  if (plan && plan.details?.parcelleColoree === false) {
    liste.push('la parcelle n’a PAS pu être colorée sur le plan'
      + (plan.details.motifCouleur ? ` : ${plan.details.motifCouleur}` : ''));
  }
  if (plan?.details?.horsCadre) {
    liste.push(`${plan.details.horsCadre} contour(s) laissé(s) sans couleur, hors du cadre `
      + 'de l’extrait');
  }
  if (plan && plan.voie === 'carte') {
    liste.push('le plan joint n’est PAS l’extrait cadastral officiel : le service du cadastre '
      + 'n’a pas répondu, CERTIF a fabriqué une carte sur fond IGN');
  }
  if (plan?.details?.parcellesHorsPage) {
    liste.push('le terrain est vaste au regard de la page : vérifier que toutes les parcelles '
      + 'figurent bien sur le plan');
  }
  if (etatSignature === 'sans_phrase') {
    liste.push('la demande et la lettre sortent non signées : aucune phrase de signature fournie');
  }
  if (etatSignature === 'non_configure') {
    liste.push('aucun paraphe scellé n’est configuré : les pièces sortent non signées');
  }
  if (!polices()) {
    liste.push('les fontes Segoe UI ne sont pas déposées : les documents sortent dans les '
      + 'polices de base du format PDF');
  }

  // Les caractères qu'une saisie perdrait à l'impression : mieux vaut le dire
  // avant que le pli ne parte que de laisser découvrir un mot tronqué.
  const perdus = new Set();
  for (const champ of [demande.reference, demande.terrain?.adresse, demande.mairie?.adresse,
    demande.mairie?.nom, demande.terrain?.commune?.nom]) {
    for (const c of caracteresPerdus(champ, polices())) perdus.add(c);
  }
  if (perdus.size) {
    liste.push(`caractères non imprimables dans la saisie : ${[...perdus].join(' ')}`);
  }

  return liste;
}
