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
import { geometriesParcelles } from './cadastre.js';
import { groupementDeLaSaisie } from './unite-fonciere.js';

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
      // Une seule ligne d'adresse, vérifiée contre la Base Adresse Nationale.
      // Le champ lieu-dit distinct a été retiré : il faisait saisir deux fois
      // la même chose pour les terrains ruraux, où l'adresse EST le lieu-dit,
      // et il partait dans une case du Cerfa que personne ne relisait.
      adresse: texte(corps.adresse) || null,
      codePostal: texte(corps.codePostalTerrain) || null,
      parcelles,
    },
  };
}


/**
 * Fabrique le PDF complet — UNE demande par unité foncière.
 *
 * C'est le point où CERTIF cesse d'être un formulaire pour devenir un outil :
 * le notaire saisit un terrain, l'outil constate qu'il est fait de deux îlots
 * séparés, et sort deux demandes complètes plutôt que de refuser ou, pire, de
 * n'en sortir qu'une.
 *
 * @param {object} demande
 * @param {string} [phrase]  la phrase qui ouvre le paraphe scellé
 * @param {object} [options]
 *   sansPlan  produire sans carte
 *   cadastre  une réponse de geometriesParcelles() déjà obtenue. Sert aux
 *             essais hors ligne : sans elle, le découpage en unités foncières
 *             ne serait éprouvable qu'avec le réseau, c'est-à-dire jamais.
 */
export async function preparerDossier(demande, phrase, { sansPlan = false, cadastre: fourni = null } = {}) {
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

  // LE CADASTRE, UNE SEULE FOIS. Sa réponse sert deux fois : à découper en
  // unités foncières, et à composer les plans. On l'interroge donc ici, avant
  // toute fabrication, et on distribue le résultat.
  const commune = demande.terrain?.commune || {};
  const parcelles = demande.terrain?.parcelles || [];
  let cadastre = fourni;
  if (!cadastre && commune.code && parcelles.length) {
    try { cadastre = await geometriesParcelles(parcelles, commune); }
    catch { cadastre = null; }
  }

  const groupement = cadastre ? groupementDeLaSaisie(parcelles, cadastre) : null;
  const { groupes, ecartees } = repartir(parcelles, groupement);

  const dossiers = [];
  const comptesRendus = [];
  const avertissements = [];

  for (const [rang, groupe] of groupes.entries()) {
    // LA RÉFÉRENCE PORTE LE RANG quand il y a plusieurs demandes : 2026-0117/1,
    // /2. Elle figure au pied de chaque page du Cerfa, dans le bloc « Dossier
    // suivi par » de la lettre et en tête de l'annexe. Une mairie qui répond
    // sur /2 est ainsi identifiable sans ouvrir le dossier — sans quoi deux
    // certificats reviendraient sous la même référence, portant sur des
    // terrains différents.
    const reference = groupes.length > 1 ? `${demande.reference}/${rang + 1}` : demande.reference;
    const sienne = {
      ...demande,
      reference,
      terrain: { ...demande.terrain, parcelles: groupe },
    };

    const sonCadastre = decouperCadastre(cadastre, groupe);

    // Le plan de situation dépend de deux services extérieurs. Son échec
    // n'empêche PAS de produire le dossier : il descend en avertissement, et le
    // notaire décide. Bloquer là-dessus reviendrait à laisser une panne du
    // cadastre arrêter les envois de l'étude.
    let plan = null;
    let planEchec = null;
    if (!sansPlan) {
      try {
        const carte = await construirePlan(sienne, sonCadastre ? { cadastre: sonCadastre } : {});
        if (carte.erreur) planEchec = carte.erreur;
        else plan = { octets: carte.octets, voie: carte.voie, echelle: carte.echelle, details: carte.details };
      } catch (e) {
        planEchec = `plan de situation : ${e.message}`;
      }
    }

    const cerfa = await remplirCerfa(sienne, images);
    const annexe = await construireAnnexe(sienne);
    dossiers.push({ demande: sienne, cerfa, annexe: annexe?.octets, plan: plan?.octets });

    comptesRendus.push({
      reference,
      parcelles: groupe.map(etiquette),
      annexe: annexe ? { pages: annexe.pages, parcelles: annexe.nombre } : null,
      plan: plan ? { voie: plan.voie, echelle: plan.echelle, details: plan.details } : null,
    });

    // Un avertissement qui ne dirait pas DE QUELLE demande il parle serait
    // inutilisable dès qu'il y en a deux.
    const prefixe = groupes.length > 1 ? `demande ${reference} — ` : '';
    for (const a of avertirDemande(plan, planEchec)) avertissements.push(prefixe + a);
  }

  const { octets, pagination } = await construireDossier({ dossiers, images });

  return {
    octets,
    pagination,
    fichier: nomFichier(demande, dossiers.length),
    signature: etatSignature,
    demandes: comptesRendus,
    // Conservés pour la forme à une demande, qui reste le cas courant.
    annexe: comptesRendus[0]?.annexe || null,
    plan: comptesRendus[0]?.plan || null,
    unitesFoncieres: groupement
      ? {
        unites: groupement.unites,
        contiguiteSeule: true,
        demandes: dossiers.length,
        ecartees: ecartees.map(etiquette),
      }
      : null,
    avertissements: [
      ...avertirSaisie(demande, groupement, groupes.length, ecartees),
      ...avertissements,
      ...avertirOffice(demande, etatSignature),
    ],
  };
}

/** La parcelle telle qu'elle a été saisie — « 355 AB 12 ». */
const etiquette = (p) => [p.prefixe, p.section, p.numero].filter(Boolean).join(' ');

/**
 * Le découpage de la saisie en demandes.
 *
 * UNE SEULE DEMANDE tant qu'on n'a pas CONSTATÉ plusieurs îlots : c'est le
 * constat qui commande, jamais son absence. Si le cadastre n'a rien rendu, on
 * ne découpe rien — on avertit.
 *
 * LES PARCELLES SANS CONTOUR NE SONT RATTACHÉES À RIEN. Tant qu'il n'y a qu'une
 * unité, la question ne se pose pas : elles y restent. Dès qu'il y en a
 * plusieurs, on ne peut pas deviner à laquelle elles appartiennent — les mettre
 * dans la première serait un tirage au sort, et le certificat porterait sur un
 * terrain qui n'est pas le bon. Elles sont donc ÉCARTÉES, et nommées.
 */
function repartir(parcelles, groupement) {
  const verifiees = groupement ? groupement.unites.filter((u) => u.contourConnu) : [];
  if (verifiees.length <= 1) return { groupes: [parcelles], ecartees: [] };

  const retenues = new Set(verifiees.flatMap((u) => u.references));
  return {
    groupes: verifiees.map((u) => u.references),
    ecartees: parcelles.filter((p) => !retenues.has(p)),
  };
}

/** La part du cadastre qui concerne un groupe de parcelles. */
function decouperCadastre(cadastre, groupe) {
  if (!cadastre) return null;
  const dedans = new Set(groupe);
  const trouvees = (cadastre.parcelles || []).filter((t) => dedans.has(t.source));
  return {
    parcelles: trouvees,
    anneaux: trouvees.flatMap((t) => t.anneaux || []),
    journal: cadastre.journal || [],
    motif: trouvees.length ? undefined : (cadastre.motif || 'aucune parcelle retrouvée au cadastre'),
  };
}

/**
 * Ce qui n'empêche pas de produire, mais que le notaire doit savoir avant
 * d'envoyer. On avertit plutôt que de bloquer : c'est lui qui décide si un
 * pli part sans son plan de situation, pas l'outil.
 */
function avertirDemande(plan, planEchec) {
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
  return liste;
}

/** Ce que le découpage en unités foncières oblige à dire. */
function avertirSaisie(demande, groupement, demandes, ecartees) {
  const liste = [];
  const parcelles = demande.terrain?.parcelles || [];
  if (parcelles.length <= 1) return liste;

  if (!groupement) {
    liste.push('la contiguïté des parcelles n’a PAS pu être vérifiée : le cadastre n’a pas '
      + 'répondu. Assurez-vous qu’elles forment bien une seule unité foncière — sinon il '
      + 'faut une demande par unité');
    return liste;
  }

  // ÉCARTÉES : le mot est fort, et il doit l'être. Une parcelle qui ne figure
  // dans aucune demande ne se voit pas en feuilletant le PDF.
  if (ecartees.length) {
    liste.push(`${ecartees.map(etiquette).join(', ')} ne figure dans AUCUNE demande : le `
      + 'cadastre n’en donne pas le contour, et les autres parcelles forment plusieurs unités '
      + 'foncières — impossible de savoir à laquelle la rattacher. Corrigez la référence, ou '
      + 'faites-en la demande à part');
  } else {
    const nonVerifiees = groupement.unites.filter((u) => !u.contourConnu)
      .flatMap((u) => u.parcelles);
    if (nonVerifiees.length) {
      liste.push(`contiguïté non vérifiable pour ${nonVerifiees.join(', ')} : le cadastre `
        + 'n’en donne pas le contour. Le rattachement à l’unité foncière reste à vérifier');
    }
  }

  // L'UNITÉ FONCIÈRE A DEUX CONDITIONS, ET CERTIF N'EN VÉRIFIE QU'UNE. Le dire
  // à chaque dossier n'est pas une précaution de style : sans cette ligne,
  // « une seule unité foncière » se lirait comme un constat, alors que ce n'est
  // qu'une contiguïté. La réserve ne vaut d'être écrite que si une contiguïté a
  // réellement été constatée — la servir quand le cadastre n'a rien rendu
  // laisserait croire qu'il ne manque que la propriété.
  if (groupement.unites.some((u) => u.contourConnu)) {
    liste.push(demandes > 1
      ? `${demandes} demandes produites : les parcelles forment ${demandes} unités foncières `
        + 'distinctes, constatées sur la seule CONTIGUÏTÉ. L’identité du propriétaire n’est pas '
        + 'contrôlée (CE 27 juin 2005, Chambon, n° 264667) : deux îlots contigus appartenant à '
        + 'des propriétaires différents feraient deux unités là où CERTIF n’en voit qu’une'
      : 'l’unité foncière n’est établie ici que sur la CONTIGUÏTÉ des parcelles ; '
        + 'l’identité du propriétaire n’est pas contrôlée (CE 27 juin 2005, Chambon, '
        + 'n° 264667 : îlot de propriété d’un seul tenant appartenant à un même propriétaire)');
  }
  return liste;
}

/** Ce qui tient à l'office et à la saisie, et vaut pour tout le pli. */
function avertirOffice(demande, etatSignature) {
  const liste = [];
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
