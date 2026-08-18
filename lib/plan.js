// CERTIF — le plan de situation : d'où il vient, et dans quel ordre
//
// DEUX VOIES. LA CARTE D'ABORD, ET VOICI POURQUOI.
//
//   1. La carte fabriquée par CERTIF (lib/plan-situation.js) : fond PLAN IGN v2
//      de la Géoplateforme, contour de la parcelle en carmin. Elle est
//      DÉTERMINISTE — CERTIF compose lui-même la carte, il sait donc à quel
//      point du papier correspond chaque coordonnée, et le contour tombe juste
//      par construction.
//
//   2. PAINT — l'extrait de plan cadastral officiel de la DGFiP. Meilleure
//      pièce sur le fond, MAIS SA PARCELLE N'EST PAS COLORÉE, et elle ne peut
//      pas l'être ici : la colorisation de PAINT vit dans son navigateur et
//      repose sur un géoréférencement par OCR (Tesseract) des étiquettes de
//      coordonnées en marge de l'extrait. Son propre code décrit ces six cents
//      lignes comme « une fermeture insoudable du bloc de chargement ». Une
//      fonction serverless ne les rejoue pas.
//
// D'où l'ordre : la carte, qui colore ; l'extrait officiel en repli, ou sur
// demande expresse. Aucune des deux n'est silencieuse — la voie employée
// remonte jusqu'à l'écran. Un extrait qu'on croirait colorié et qui ne l'est
// pas ferait chercher au service une parcelle qu'il ne verrait pas.
//
// CERTIF_PLAN_VOIE règle l'ordre : « carte » (défaut), « paint », ou
// « paint-seul » pour interdire le repli.
//
// POURQUOI IL FAUT QUAND MÊME INTERROGER LE CADASTRE AVANT D'APPELER PAINT :
// PAINT centre l'extrait sur UNE parcelle et l'échelle est un paramètre. Pour
// choisir cette échelle — et pour savoir laquelle des parcelles est la plus
// centrale quand le terrain en compte plusieurs — il faut connaître l'emprise.
// C'est l'API Carto qui la donne, et c'est le même appel que celui dont la
// carte de tuiles a besoin. Rien n'est fait deux fois.

import { geometriesParcelles } from './cadastre.js';
import { emprise, versMercator, deformation } from './geo.js';
import { echellePour, extrait, empriseSol } from './plan-paint.js';
import { construirePlanSituation } from './plan-situation.js';

/** Dimensions au sol d'une emprise, en mètres. */
function dimensions(bornes) {
  const a = versMercator(bornes.ouest, bornes.sud);
  const b = versMercator(bornes.est, bornes.nord);
  const k = deformation(bornes.lat);
  return { largeur: Math.abs(b.x - a.x) / k, hauteur: Math.abs(b.y - a.y) / k };
}

/**
 * La parcelle la plus proche du centre du terrain.
 *
 * PAINT centre sur la parcelle qu'on lui nomme. Quand le terrain en compte
 * plusieurs, prendre la première venue peut rejeter les autres hors de la
 * page ; on prend donc celle dont le centre est le plus proche du centre de
 * l'ensemble.
 */
function laPlusCentrale(trouvees, centre) {
  let retenue = trouvees[0];
  let meilleure = Infinity;
  for (const t of trouvees) {
    const bornes = emprise(t.anneaux || []);
    if (!bornes) continue;
    const d = (bornes.lon - centre.lon) ** 2 + (bornes.lat - centre.lat) ** 2;
    if (d < meilleure) { meilleure = d; retenue = t; }
  }
  return retenue;
}

/**
 * @returns {Promise<{octets:Uint8Array, voie:'paint'|'tuiles', echelle:number,
 *   details:object, journal:Array} | {erreur:string, journal:Array}>}
 */
export async function construirePlan(demande, options = {}) {
  const commune = demande.terrain?.commune || {};
  const parcelles = demande.terrain?.parcelles || [];
  if (!commune.code || parcelles.length === 0) {
    return { erreur: 'commune ou parcelles absentes', journal: [] };
  }

  const cadastre = await geometriesParcelles(parcelles, commune);
  const journal = [...cadastre.journal];

  // Sans géométrie, on ne sait ni quelle échelle demander ni sur quelle
  // parcelle centrer. On tente quand même PAINT sur la première parcelle, à
  // l'échelle par défaut : le SCPC a sa propre recherche, et il arrive qu'il
  // trouve là où l'API Carto n'a rien rendu.
  const bornes = cadastre.anneaux.length ? emprise(cadastre.anneaux) : null;
  const echelle = bornes ? echellePour(dimensions(bornes)) : echellePour({ largeur: 0, hauteur: 0 });

  // La parcelle sur laquelle centrer, et le code de commune AU CADASTRE —
  // celui qu'a retenu la résolution, donc le chef-lieu pour une commune
  // associée. Sans lui, PAINT chercherait Lomme là où le PCI range Lille.
  const trouvee = bornes && cadastre.parcelles.length
    ? laPlusCentrale(cadastre.parcelles, bornes)
    : null;
  const centrale = trouvee?.source || parcelles[0];
  const codeCadastre = trouvee?.codeInsee || commune.chefLieu || commune.code;
  const prefixeCadastre = trouvee?.prefixe || centrale.prefixe || '000';

  const voie = options.voie || process.env.CERTIF_PLAN_VOIE || 'carte';

  // La carte d'abord, sauf ordre contraire : c'est la seule des deux qui
  // colore la parcelle.
  if (voie === 'carte' && !options.sansCarte) {
    const carte = await construirePlanSituation(demande, options);
    if (!carte.erreur) {
      return {
        octets: carte.octets,
        voie: 'carte',
        echelle: carte.echelle,
        details: { zoom: carte.zoom, tuiles: carte.tuiles, parcelleColoree: true },
        journal: [...journal, ...carte.journal],
      };
    }
    journal.push({ voie: 'carte', resultat: carte.erreur });
  }

  if (!options.sansPaint) {
    const r = await extrait({
      parcelle: { ...centrale, prefixe: prefixeCadastre },
      codeInsee: codeCadastre,
      echelle,
    });
    journal.push({
      voie: 'paint',
      demande: { commune: codeCadastre, prefixe: prefixeCadastre, section: centrale.section, parcelle: centrale.numero, echelle },
      resultat: r.ok ? 'extrait obtenu' : r.motif,
      ...(r.ok ? { entetes: r.entetes } : {}),
    });

    if (r.ok) {
      return {
        octets: r.octets,
        voie: 'paint',
        echelle,
        details: {
          ...r.entetes,
          centreSur: `${prefixeCadastre} ${centrale.section} ${centrale.numero}`,
          // Dit franchement : l'extrait officiel ne porte aucune couleur sur
          // la parcelle. Le service la retrouve par sa référence, imprimée sur
          // le plan, mais elle ne saute pas aux yeux.
          parcelleColoree: false,
          emprise: empriseSol(echelle),
          parcellesHorsPage: bornes
            ? aVerifier(dimensions(bornes), empriseSol(echelle)) : null,
        },
        journal,
      };
    }
  }

  if (voie === 'paint-seul') {
    return { erreur: 'extrait officiel indisponible et repli interdit (CERTIF_PLAN_VOIE)', journal };
  }

  // Repli : la carte de tuiles, si elle n'a pas déjà été tentée plus haut.
  if (voie === 'carte') {
    return { erreur: 'ni la carte ni l’extrait officiel n’ont abouti', journal };
  }
  const carte = await construirePlanSituation(demande, options);
  if (carte.erreur) {
    return { erreur: `PAINT puis carte de secours : ${carte.erreur}`, journal: [...journal, ...carte.journal] };
  }
  return {
    octets: carte.octets,
    voie: 'carte',
    echelle: carte.echelle,
    details: { zoom: carte.zoom, tuiles: carte.tuiles },
    journal: [...journal, ...carte.journal],
  };
}

/**
 * Le terrain risque-t-il de déborder de la page ?
 *
 * On ne peut pas l'affirmer : l'extrait est centré sur une parcelle, pas sur
 * le terrain, et le service se réserve de recentrer. On peut en revanche dire
 * quand c'est POSSIBLE — quand l'emprise du terrain dépasse la moitié de la
 * page, un décentrage suffirait à en sortir une partie.
 */
function aVerifier(terrain, page) {
  return terrain.largeur > page.largeur / 2 || terrain.hauteur > page.hauteur / 2;
}
