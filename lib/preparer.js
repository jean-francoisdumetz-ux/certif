// CERTIF — préparation d'un lot de demandes, du formulaire reçu au PDF prêt à partir
//
// Un seul chemin, employé par les deux routes : celle qui télécharge le PDF et
// celle qui dépose le brouillon Outlook. C'est délibéré — si chacune fabriquait
// le sien, le jour où l'une évolue, l'assistante imprimerait un document et le
// notaire en aurait relu un autre.
//
// DEUX NIVEAUX DE DÉCOUPAGE, ET ILS NE SE CONFONDENT PAS.
//
//   1. LA COMMUNE. Un certificat d'urbanisme se demande à la mairie du lieu du
//      terrain. Deux communes, ce sont deux mairies, donc deux plis, deux
//      adresses, deux délais qui courent séparément. Rien ne se mutualise — pas
//      même la lettre d'accompagnement, qui s'adresse nominativement à
//      « Monsieur le Maire » de telle commune.
//
//   2. L'UNITÉ FONCIÈRE, à l'intérieur de chaque commune. Le certificat porte
//      sur un îlot d'un seul tenant : deux parcelles qui ne se touchent pas en
//      appellent deux, dans la même commune et à la même mairie.
//
// Une saisie de trois communes dont l'une compte deux îlots donne donc QUATRE
// demandes, quatre lettres, quatre plis — et un seul PDF à imprimer.
//
// LA RÉFÉRENCE PORTE LES DEUX RANGS quand il y a plusieurs communes :
// 15151/1-1, 15151/1-2, 15151/2-1. Le premier chiffre est la commune, le second
// l'unité foncière. Une mairie qui répond sur /2-1 est identifiable sans ouvrir
// le dossier. Quand il n'y a qu'une commune, on garde la forme courte —
// 15151/1, /2 — et quand il n'y a qu'une demande, la référence reste nue.
//
// LES REFUS SONT ICI, ET ILS SONT EXPLICITES. Rien n'est complété d'office :
// une donnée manquante arrête la génération et se dit par son nom, en précisant
// DE QUELLE COMMUNE il s'agit. C'est la leçon de MATRICE, où un défaut « de
// test » avait fait partir un PDF portant une adresse inventée.

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

/** La parcelle telle qu'elle a été saisie — « 355 AB 12 ». */
const etiquette = (p) => [p.prefixe, p.section, p.numero].filter(Boolean).join(' ');

/**
 * Un terrain : une commune, son adresse, ses parcelles, sa mairie.
 *
 * @param {object} b       le bloc reçu de l'écran
 * @param {number} rang    son rang dans la saisie, pour nommer les manques
 * @param {number} total   le nombre de communes, pour savoir s'il faut les nommer
 * @param {Array} absents  s'enrichit des données manquantes
 */
function lireTerrain(b, rang, total, absents) {
  const commune = b.commune || {};
  // Quand il y a plusieurs communes, un refus qui dirait « commune manquante »
  // sans dire laquelle obligerait à tout relire.
  const ou = total > 1 ? ` — ${texte(commune.nom) || `commune n° ${rang + 1}`}` : '';

  const parcelles = (Array.isArray(b.parcelles) ? b.parcelles : [])
    .map((p) => ({
      prefixe: texte(p.prefixe) || null,
      section: texte(p.section).toUpperCase(),
      numero: texte(p.numero),
      lieuDit: texte(p.lieuDit) || null,
      contenance: p.contenance === '' || p.contenance === null || p.contenance === undefined
        ? null : Number(p.contenance),
    }))
    .filter((p) => p.section || p.numero);

  const mairieBrute = b.mairie || {};

  // UN BLOC ENTIÈREMENT VIDE SE DIT EN UNE LIGNE, pas en trois. Énumérer la
  // commune, les parcelles et la mairie d'un bloc où rien n'a été saisi donne
  // une liste qui semble décrire trois oublis, là où il n'y a qu'une saisie pas
  // commencée — et l'on cherche ce qu'on aurait raté.
  const rienDuTout = !texte(commune.code) && !texte(commune.nom) && parcelles.length === 0
    && !texte(mairieBrute.adresse) && !texte(b.adresse);
  if (rienDuTout) {
    absents.push(total > 1
      ? `la commune n° ${rang + 1} est vide : renseignez-la ou retirez-la`
      : 'la saisie est vide : déposez une liste, ou renseignez une commune et ses parcelles');
    return terrainDe(commune, b, parcelles, mairieBrute);
  }

  if (!texte(commune.code) || !texte(commune.nom)) {
    absents.push(`commune (code INSEE et nom)${ou}`);
  }

  if (parcelles.length === 0) absents.push(`au moins une parcelle${ou}`);
  parcelles.forEach((p, i) => {
    if (!p.section) absents.push(`section de la parcelle ${i + 1}${ou}`);
    if (!p.numero) absents.push(`numéro de la parcelle ${i + 1}${ou}`);
    if (p.contenance !== null && !Number.isFinite(p.contenance)) {
      absents.push(`contenance de la parcelle ${i + 1}${ou} (nombre attendu)`);
    }
  });

  if (!texte(mairieBrute.adresse) || !texte(mairieBrute.codePostal)) {
    absents.push(`adresse postale de la mairie${ou} (c'est elle qui figure sur le recommandé)`);
  }

  return terrainDe(commune, b, parcelles, mairieBrute);
}

/** Le terrain mis en forme, une fois les manques relevés. */
function terrainDe(commune, b, parcelles, mairie) {
  return {
    commune: {
      code: texte(commune.code),
      nom: texte(commune.nom),
      chefLieu: texte(commune.chefLieu) || null,
    },
    // Une seule ligne d'adresse, vérifiée contre la Base Adresse Nationale. Le
    // champ lieu-dit distinct a été retiré : il faisait saisir deux fois la même
    // chose pour les terrains ruraux, où l'adresse EST le lieu-dit.
    adresse: texte(b.adresse) || null,
    codePostal: texte(b.codePostalTerrain) || null,
    parcelles,
    mairie: {
      nom: texte(mairie.nom) || `Mairie de ${texte(commune.nom)}`,
      adresse: texte(mairie.adresse),
      complement: texte(mairie.complement) || null,
      codePostal: texte(mairie.codePostal),
      commune: texte(mairie.commune) || texte(commune.nom),
    },
  };
}

/**
 * Construit le lot à partir de ce que l'écran a envoyé.
 *
 * DEUX FORMES ACCEPTÉES. La nouvelle porte un tableau `communes`. L'ancienne —
 * commune, adresse, parcelles, mairie au premier niveau — reste comprise : c'est
 * celle de /api/plan et des essais, et rien ne justifie de casser un appelant
 * qui ne traite qu'une commune.
 *
 * @throws {Refus} 503 si l'identité de l'office n'est pas configurée,
 *                 400 si la saisie elle-même est incomplète.
 */
export function demandeDepuisRequete(corps = {}) {
  const manquantes = officeManquant();
  if (manquantes.length) {
    throw new Refus(503, "l'identité de l'office n'est pas configurée", { variables: manquantes });
  }

  const absents = [];
  const reference = texte(corps.reference);
  if (!reference) absents.push('référence de dossier');

  const bruts = Array.isArray(corps.communes) && corps.communes.length
    ? corps.communes
    : [corps];
  const terrains = bruts.map((b, i) => lireTerrain(b, i, bruts.length, absents));

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
    terrains,
    // La première commune exposée à plat : /api/plan et les essais lisent
    // `terrain` et `mairie` sans savoir qu'il peut y en avoir plusieurs.
    terrain: terrains[0],
    mairie: terrains[0].mairie,
  };
}

/**
 * La référence d'une demande dans le lot.
 *
 * Trois régimes, du plus simple au plus complet — alourdir la référence d'un
 * dossier à une seule demande n'apporterait rien.
 */
export function referencer(base, rangCommune, rangUnite, communes, unites) {
  if (communes > 1) return `${base}/${rangCommune + 1}-${rangUnite + 1}`;
  if (unites > 1) return `${base}/${rangUnite + 1}`;
  return base;
}

/**
 * Fabrique le PDF complet — UNE demande par unité foncière, dans chaque commune.
 *
 * C'est le point où CERTIF cesse d'être un formulaire pour devenir un outil : le
 * notaire dépose une liste, l'outil constate qu'elle porte sur trois communes
 * dont l'une compte deux îlots séparés, et sort quatre demandes complètes plutôt
 * que de refuser ou, pire, de n'en sortir qu'une.
 *
 * @param {object} lot       le retour de demandeDepuisRequete()
 * @param {string} [phrase]  la phrase qui ouvre le paraphe scellé
 * @param {object} [options]
 *   sansPlan   produire sans carte
 *   cadastres  un tableau de réponses de geometriesParcelles(), une par commune,
 *              ou `cadastre` pour la forme à une commune. Sert aux essais hors
 *              ligne : sans elles, le découpage en unités foncières ne serait
 *              éprouvable qu'avec le réseau, c'est-à-dire jamais.
 */
export async function preparerDossier(lot, phrase, options = {}) {
  const { sansPlan = false } = options;
  const fournis = options.cadastres || (options.cadastre ? [options.cadastre] : null);

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

  const terrains = lot.terrains || [lot.terrain];
  const dossiers = [];
  const comptesRendus = [];
  const avertissements = [];
  const parCommune = [];

  for (const [rangCommune, terrain] of terrains.entries()) {
    // LE CADASTRE, UNE SEULE FOIS PAR COMMUNE. Sa réponse sert deux fois : à
    // découper en unités foncières, et à composer les plans. On l'interroge donc
    // avant toute fabrication, et on distribue le résultat.
    let cadastre = fournis ? fournis[rangCommune] || null : null;
    if (!cadastre && terrain.commune.code && terrain.parcelles.length) {
      try { cadastre = await geometriesParcelles(terrain.parcelles, terrain.commune); }
      catch { cadastre = null; }
    }

    const groupement = cadastre ? groupementDeLaSaisie(terrain.parcelles, cadastre) : null;
    const { groupes, ecartees } = repartir(terrain.parcelles, groupement);

    parCommune.push({
      commune: terrain.commune.nom,
      code: terrain.commune.code,
      unites: groupement ? groupement.unites : null,
      contiguiteSeule: true,
      demandes: groupes.length,
      ecartees: ecartees.map(etiquette),
    });

    // Un avertissement qui ne dirait pas de quelle commune il parle serait
    // inutilisable dès qu'il y en a deux.
    const dit = terrains.length > 1 ? `${terrain.commune.nom} — ` : '';
    for (const a of avertirSaisie(terrain, groupement, groupes.length, ecartees)) {
      avertissements.push(dit + a);
    }

    for (const [rangUnite, groupe] of groupes.entries()) {
      const reference = referencer(
        lot.reference, rangCommune, rangUnite, terrains.length, groupes.length);

      // La demande telle que la connaissent le Cerfa, la lettre et l'annexe :
      // une commune, une mairie, un îlot. Rien de ce qui suit n'a besoin de
      // savoir qu'il y en a d'autres.
      const sienne = {
        office: lot.office,
        demandeur: lot.demandeur,
        reference,
        date: lot.date,
        accepterVoieElectronique: lot.accepterVoieElectronique,
        mairie: terrain.mairie,
        terrain: {
          commune: terrain.commune,
          adresse: terrain.adresse,
          codePostal: terrain.codePostal,
          parcelles: groupe,
        },
      };

      const sonCadastre = decouperCadastre(cadastre, groupe);

      // Le plan de situation dépend de deux services extérieurs. Son échec
      // n'empêche PAS de produire le dossier : il descend en avertissement, et
      // le notaire décide. Bloquer là-dessus reviendrait à laisser une panne du
      // cadastre arrêter les envois de l'étude.
      let plan = null;
      let planEchec = null;
      if (!sansPlan) {
        try {
          const carte = await construirePlan(sienne, sonCadastre ? { cadastre: sonCadastre } : {});
          if (carte.erreur) planEchec = carte.erreur;
          else {
            plan = {
              octets: carte.octets,
              voie: carte.voie,
              echelle: carte.echelle,
              details: carte.details,
            };
          }
        } catch (e) {
          planEchec = `plan de situation : ${e.message}`;
        }
      }

      const cerfa = await remplirCerfa(sienne, images);
      const annexe = await construireAnnexe(sienne);
      dossiers.push({ demande: sienne, cerfa, annexe: annexe?.octets, plan: plan?.octets });

      comptesRendus.push({
        reference,
        // Le rang de la commune : c'est par lui que les consignes retrouvent
        // l'adresse de la mairie à qui CE pli doit partir.
        rangCommune,
        rangUnite,
        commune: terrain.commune.nom,
        mairie: [terrain.mairie.adresse, terrain.mairie.codePostal, terrain.mairie.commune]
          .filter(Boolean).join(' '),
        parcelles: groupe.map(etiquette),
        annexe: annexe ? { pages: annexe.pages, parcelles: annexe.nombre } : null,
        plan: plan ? { voie: plan.voie, echelle: plan.echelle, details: plan.details } : null,
      });

      const prefixe = terrains.length > 1 || groupes.length > 1 ? `demande ${reference} — ` : '';
      for (const a of avertirDemande(plan, planEchec)) avertissements.push(prefixe + a);
    }
  }

  const { octets, pagination } = await construireDossier({ dossiers, images });

  return {
    octets,
    pagination,
    fichier: nomFichier(lot, dossiers.length),
    signature: etatSignature,
    demandes: comptesRendus,
    communes: parCommune,
    // Conservés pour la forme à une commande, qui reste le cas courant.
    annexe: comptesRendus[0]?.annexe || null,
    plan: comptesRendus[0]?.plan || null,
    unitesFoncieres: parCommune.length === 1
      ? { ...parCommune[0], demandes: dossiers.length }
      : null,
    avertissements: [...avertissements, ...avertirOffice(lot, etatSignature)],
  };
}

/**
 * Le découpage d'une commune en demandes.
 *
 * UNE SEULE DEMANDE tant qu'on n'a pas CONSTATÉ plusieurs îlots : c'est le
 * constat qui commande, jamais son absence. Si le cadastre n'a rien rendu, on ne
 * découpe rien — on avertit.
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

/**
 * La part du cadastre qui concerne un groupe de parcelles.
 *
 * Exportée pour être éprouvée : c'est elle qui décide ce que le plan de
 * situation reçoit. Si elle rendait un jeu vide, chaque demande sortirait sans
 * plan sans qu'aucune erreur ne soit levée — une panne silencieuse.
 */
export function decouperCadastre(cadastre, groupe) {
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
 * d'envoyer. On avertit plutôt que de bloquer : c'est lui qui décide si un pli
 * part sans son plan de situation, pas l'outil.
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

/** Ce que le découpage en unités foncières oblige à dire, commune par commune. */
function avertirSaisie(terrain, groupement, demandes, ecartees) {
  const liste = [];
  if ((terrain.parcelles || []).length <= 1) return liste;

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
  // à chaque dossier n'est pas une précaution de style : sans cette ligne, « une
  // seule unité foncière » se lirait comme un constat, alors que ce n'est qu'une
  // contiguïté. La réserve ne vaut d'être écrite que si une contiguïté a
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
function avertirOffice(lot, etatSignature) {
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
  const champs = [lot.reference];
  for (const t of lot.terrains || [lot.terrain]) {
    champs.push(t?.adresse, t?.mairie?.adresse, t?.mairie?.nom, t?.commune?.nom);
  }
  for (const champ of champs) {
    for (const c of caracteresPerdus(champ, polices())) perdus.add(c);
  }
  if (perdus.size) {
    liste.push(`caractères non imprimables dans la saisie : ${[...perdus].join(' ')}`);
  }
  return liste;
}
