// CERTIF — les unités foncières d'un ensemble de parcelles
//
// POURQUOI CELA COMPTE : une demande de certificat d'urbanisme porte sur UNE
// unité foncière. Deux parcelles qui ne se touchent pas en forment deux, et
// appellent donc deux demandes — deux Cerfa, deux plis, deux délais. Les
// réunir sur un seul imprimé, c'est exposer la demande à un refus, ou pire à
// un certificat qui ne couvre qu'une partie du terrain sans que personne ne
// s'en aperçoive avant l'acte.
//
// LA DÉFINITION, ET SA MOITIÉ MANQUANTE. Le Conseil d'État l'a fixée le 27
// juin 2005 (Chambon, n° 264667) : « un îlot de propriété d'un seul tenant,
// composé d'une ou plusieurs parcelles contiguës appartenant à un même
// propriétaire ». Deux conditions, donc — la CONTIGUÏTÉ et l'UNITÉ DE
// PROPRIÉTÉ.
//
// CERTIF ne sait vérifier que la première. Le plan cadastral donne les
// contours, jamais les propriétaires : ceux-là sont dans la matrice, et c'est
// justement ce que MATRICE va chercher. Le regroupement rendu ici est donc une
// PROPOSITION fondée sur la seule géométrie. Deux parcelles contiguës
// appartenant à deux propriétaires différents font deux unités foncières, et
// aucun calcul de ce module ne le verra. Le notaire tranche.
//
// C'est dit explicitement dans ce qui remonte à l'écran, et ce n'est pas une
// précaution de style : un outil qui affirmerait « une seule unité foncière »
// sur la seule contiguïté ferait prendre pour vérifié ce qui ne l'est qu'à
// moitié.

import { versMercator } from './geo.js';

/** Tolérance de contiguïté, en mètres. */
export const TOLERANCE = 0.5;

/**
 * Le plan cadastral est topologiquement propre : deux parcelles voisines
 * partagent des sommets identiques. Une demi-mètre de tolérance absorbe les
 * arrondis de la projection et les rares décalages de numérisation, sans
 * jamais rapprocher deux parcelles séparées par une voie — la plus étroite des
 * sentes fait plus d'un mètre.
 */
const projeter = (anneau) => anneau.map(([lon, lat]) => {
  const p = versMercator(lon, lat);
  // On retire la déformation du Mercator : à 50° de latitude, un mètre projeté
  // ne vaut que 63 centimètres au sol, et une tolérance en mètres projetés
  // serait donc plus lâche qu'annoncé.
  const k = 1 / Math.cos((lat * Math.PI) / 180);
  return [p.x / k, p.y / k];
});

const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Distance d'un point à un segment, au carré. */
function distanceAuSegment2(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const longueur2 = dx * dx + dy * dy;
  if (longueur2 === 0) return distance2(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / longueur2;
  t = Math.max(0, Math.min(1, t));
  return distance2(p, [a[0] + t * dx, a[1] + t * dy]);
}

/**
 * Deux jeux d'anneaux se touchent-ils ?
 *
 * On teste les sommets de l'un contre les SEGMENTS de l'autre, dans les deux
 * sens. Tester sommet contre sommet ne suffirait pas : quand une parcelle
 * longue borde deux petites, son côté n'a pas de sommet en face du point de
 * jonction — c'est le cas du T, et il est fréquent en lotissement.
 */
export function seTouchent(anneauxA, anneauxB, tolerance = TOLERANCE) {
  const t2 = tolerance * tolerance;
  const A = anneauxA.map(projeter);
  const B = anneauxB.map(projeter);

  const contre = (points, cible) => {
    for (const p of points) {
      for (const anneau of cible) {
        for (let i = 0; i < anneau.length - 1; i += 1) {
          if (distanceAuSegment2(p, anneau[i], anneau[i + 1]) <= t2) return true;
        }
      }
    }
    return false;
  };

  return contre(A.flat(), B) || contre(B.flat(), A);
}

/**
 * Regroupe les parcelles en îlots d'un seul tenant.
 *
 * @param {Array} parcelles [{designation, anneaux, source, contenance}]
 * @returns {{unites:Array, contiguiteSeule:true, motif?:string}}
 */
export function unitesFoncieres(parcelles, tolerance = TOLERANCE) {
  const utiles = parcelles.filter((p) => Array.isArray(p.anneaux) && p.anneaux.length);
  const sansContour = parcelles.filter((p) => !Array.isArray(p.anneaux) || !p.anneaux.length);

  // Composantes connexes, par parcours en largeur. Le nombre de parcelles d'une
  // demande se compte en dizaines : un algorithme en n² suffit, et il se relit.
  const vues = new Set();
  const unites = [];

  for (let depart = 0; depart < utiles.length; depart += 1) {
    if (vues.has(depart)) continue;
    const groupe = [depart];
    vues.add(depart);
    for (let k = 0; k < groupe.length; k += 1) {
      for (let j = 0; j < utiles.length; j += 1) {
        if (vues.has(j)) continue;
        if (seTouchent(utiles[groupe[k]].anneaux, utiles[j].anneaux, tolerance)) {
          vues.add(j);
          groupe.push(j);
        }
      }
    }
    unites.push(groupe.map((i) => utiles[i]));
  }

  // Une parcelle dont le contour manque ne peut être rattachée à rien. On ne
  // la range pas d'office avec les autres : ce serait affirmer une contiguïté
  // qu'on n'a pas vérifiée. Elle forme son propre lot, signalé comme tel.
  for (const p of sansContour) unites.push([p]);

  return {
    unites: unites.map((groupe, i) => ({
      rang: i + 1,
      parcelles: groupe.map(libelle),
      references: groupe.map((p) => p.source).filter(Boolean),
      contourConnu: groupe.every((p) => Array.isArray(p.anneaux) && p.anneaux.length),
    })),
    contiguiteSeule: true,
    motif: sansContour.length
      ? `${sansContour.length} parcelle(s) sans contour au cadastre : rattachement non vérifiable`
      : undefined,
  };
}

/**
 * La parcelle telle que le notaire l'a écrite — « AB 168 », et non
 * « 000 AB 0168 ». Ce libellé part à l'écran et dans le refus : il doit se
 * reconnaître d'un coup d'œil dans la saisie, sinon il faut le décoder pour
 * savoir quelle ligne retirer.
 */
function libelle(p) {
  const s = p.source || {};
  const ecrit = [s.prefixe, s.section, s.numero].filter(Boolean).join(' ').trim();
  return ecrit || p.designation || '?';
}

/**
 * Le groupement d'une saisie, en tenant compte des parcelles que le cadastre
 * n'a pas retrouvées.
 *
 * Elles ne figurent pas dans le résultat de l'API Carto — les omettre
 * reviendrait à les faire disparaître du raisonnement, et à conclure « une
 * seule unité foncière » sur les seules parcelles retrouvées. On les réinjecte
 * donc sans contour : elles formeront chacune leur propre lot, marqué comme
 * non vérifié.
 *
 * @param {Array} parcellesSaisies  les lignes de l'écran
 * @param {object} cadastre         le retour de geometriesParcelles()
 */
export function groupementDeLaSaisie(parcellesSaisies, cadastre, tolerance = TOLERANCE) {
  const trouvees = cadastre?.parcelles || [];
  // L'identité d'objet suffit dans le chemin normal — le cadastre garde la
  // ligne saisie telle quelle. On garde une comparaison par références au cas
  // où la saisie aurait été recopiée entre-temps : rater l'appariement ferait
  // croire à une parcelle sans contour, donc à une unité foncière de plus.
  const clef = (p) => [p?.prefixe || '', String(p?.section || '').toUpperCase(),
    String(p?.numero || '')].map((v) => v.trim()).join('|');
  const pourGrouper = (parcellesSaisies || []).map((p) => {
    const t = trouvees.find((x) => x.source === p || (x.source && clef(x.source) === clef(p)));
    return t || { designation: null, source: p, anneaux: [] };
  });
  return unitesFoncieres(pourGrouper, tolerance);
}
