// CERTIF — le plan de situation : d'où il vient, et dans quel ordre
//
// L'EXTRAIT OFFICIEL, COLORISÉ. C'est la pièce voulue, et elle est atteignable.
//
//   1. PAINT rend l'extrait de plan cadastral de la DGFiP, et l'emprise
//      employée dans l'en-tête X-Paint-Bbox.
//   2. CERTIF y pose le liseré carmin lui-même (lib/colorier.js), par une
//      règle de trois calée sur un cadre mesuré. Aucun OCR : PAINT en a besoin
//      parce que son écran ne sait pas d'avance comment le service a composé
//      la page ; CERTIF le sait, puisque c'est lui qui a demandé l'extrait.
//   3. En repli seulement, la carte de tuiles sur fond cadastral IGN
//      (lib/plan-situation.js), si le SCPC ne rend rien.
//
// Aucune voie n'est silencieuse : celle qui a servi remonte à l'écran, et
// l'avertissement dit si la parcelle a pu être colorée. Un extrait qu'on
// croirait colorié et qui ne l'est pas ferait chercher au service une parcelle
// qu'il ne verrait pas.
//
// CERTIF_PLAN_VOIE règle l'ordre : « paint » (défaut), « carte », ou
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
import { colorier, CADRES, versPage, lireBbox } from './colorier.js';
import { zoneDepuisY, versConiqueConforme } from './lambert.js';

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

  // L'appelant peut avoir déjà interrogé le cadastre — c'est le cas de
  // preparerDossier, qui en a besoin pour compter les unités foncières AVANT de
  // fabriquer quoi que ce soit. On réemploie sa réponse plutôt que de refaire
  // l'appel : deux interrogations du même service pour un même dossier, c'est
  // deux fois le délai, et le risque que la seconde échoue là où la première
  // avait réussi.
  const cadastre = options.cadastre || await geometriesParcelles(parcelles, commune);
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

  const voie = options.voie || process.env.CERTIF_PLAN_VOIE || 'paint';

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
      // Le liseré. Seuls les contours ENTIÈREMENT dans le cadre sont posés :
      // pdf-lib ne découpe pas, et une parcelle à cheval déborderait sur les
      // marges de l'extrait, par-dessus les étiquettes de coordonnées.
      const dedans = (cadastre.anneaux || []).filter(
        (a) => dansLeCadre(a, r.entetes.bbox, echelle));
      const horsCadre = (cadastre.anneaux || []).length - dedans.length;

      let octets = r.octets;
      let coloree = false;
      let motifCouleur = null;

      if (dedans.length) {
        const peint = await colorier(r.octets, {
          anneaux: dedans, bbox: r.entetes.bbox, echelle, format: 'A4-Portrait',
        });
        if (peint.ok) { octets = peint.octets; coloree = true; }
        else motifCouleur = peint.motif;
      } else {
        motifCouleur = (cadastre.anneaux || []).length
          ? 'contours hors du cadre de l’extrait'
          : 'contour cadastral indisponible';
      }
      journal.push({ voie: 'colorisation', resultat: coloree ? `${dedans.length} contour(s) posé(s)` : motifCouleur });

      return {
        octets,
        voie: 'paint',
        echelle,
        details: {
          ...r.entetes,
          centreSur: `${prefixeCadastre} ${centrale.section} ${centrale.numero}`,
          parcelleColoree: coloree,
          motifCouleur,
          horsCadre,
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
 * Un contour tient-il entièrement dans le cadre dessiné de l'extrait ?
 *
 * pdf-lib ne sait pas découper un tracé. Un contour à cheval déborderait donc
 * sur les marges, là où le service imprime ses étiquettes de coordonnées — et
 * un trait carmin en travers d'une étiquette rend le plan moins lisible, pas
 * plus. On préfère ne pas poser celui-là, et le dire.
 */
function dansLeCadre(anneau, bboxBrute, echelle) {
  const bbox = lireBbox(bboxBrute);
  const cadre = CADRES['A4-Portrait'];
  if (!bbox || !cadre || !zoneDepuisY(bbox.yMin)) return false;
  const zone = zoneDepuisY(bbox.yMin);
  for (const [lon, lat] of anneau) {
    const p = versConiqueConforme(lat, lon, zone);
    if (!p) return false;
    const q = versPage(p, { bbox, echelle, cadre });
    if (q.x < cadre.x || q.x > cadre.x + cadre.largeur) return false;
    if (q.y < cadre.y || q.y > cadre.y + cadre.hauteur) return false;
  }
  return true;
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
