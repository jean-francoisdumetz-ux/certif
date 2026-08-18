// CERTIF — colorise la parcelle sur l'extrait de plan cadastral officiel
//
// Ce que REDPAR obtient en ouvrant PAINT dans un navigateur, obtenu ici dans
// une fonction serverless, et sans OCR.
//
// PAINT colorie en lisant les étiquettes de coordonnées à la loupe (Tesseract),
// parce que son écran ne sait pas d'avance comment le service a composé la
// page. CERTIF, lui, le sait : il a demandé l'extrait, il connaît donc
// l'échelle et le format, et PAINT lui rend l'emprise employée dans l'en-tête
// X-Paint-Bbox. Il ne reste qu'une règle de trois.
//
// LA GÉOMÉTRIE DU CADRE A ÉTÉ MESURÉE, PAS SUPPOSÉE — sur un extrait réel de
// Saint-Omer AV 168 au 1/2000, le 18 août 2026 :
//
//   • les étiquettes 1648000 et 1648200 sont centrées à 146,70 et 430,14 pt,
//     soit 283,44 pt pour 200 m — exactement 100 mm de papier au 1/2000 ;
//   • le cadre dessiné va de 33,8 à 559,4 pt en abscisse, et de 33,0 à 602,7 pt
//     en ordonnée (repère PDF, origine en bas) ;
//   • ce cadre mesure 185,4 × 201,0 mm, quand MAP_SIZES de PAINT annonce
//     195,5 × 211,0 : l'emprise MAPBBOX déborde donc le cadre dessiné de
//     EXACTEMENT 5 mm de papier sur chacun des quatre côtés.
//
// La dernière ligne est la clef, et elle se vérifie : la règle ainsi calée
// replace les quatre étiquettes imprimées au dixième de point près (voir
// essais/colorier.mjs, qui rejoue la mesure sur le fichier).
//
// CE QUI RESTE À VÉRIFIER, et que je ne peux pas faire d'ici : que ce cadre
// soit le même à une autre échelle et dans une autre commune. Il est dessiné
// par le service pour un format de page donné, il devrait donc l'être. Un
// second extrait à 1/1000 le confirmerait.

import { PDFDocument, rgb } from 'pdf-lib';
import { versConiqueConforme, zoneDepuisY } from './lambert.js';
import { METRE_PAR_POINT } from './geo.js';

/**
 * Le cadre dessiné, en points PDF, par format de page.
 * Mesuré sur l'extrait du 18 août 2026 ; A4 portrait seulement pour l'instant,
 * parce que c'est le seul que CERTIF demande.
 */
export const CADRES = {
  'A4-Portrait': { x: 33.8, y: 33.0, largeur: 525.6, hauteur: 569.7 },
};

/** Débordement de MAPBBOX au-delà du cadre dessiné, en mètres de PAPIER. */
export const DEBORD = 0.005; // 5 mm sur chaque côté

const CARMIN = rgb(0.63, 0.06, 0.25);

/** Lit « xMin,yMin,xMax,yMax » tel que PAINT le rend. */
export function lireBbox(brut) {
  const n = String(brut || '').split(',').map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null;
  return { xMin: n[0], yMin: n[1], xMax: n[2], yMax: n[3] };
}

/**
 * Report d'un point conique conforme sur la page.
 *
 * Le cadre dessiné correspond à MAPBBOX rentré de 5 mm de papier : le coin
 * bas-gauche du cadre vaut donc (xMin + 5 mm × échelle, yMin + 5 mm × échelle).
 */
export function versPage({ X, Y }, { bbox, echelle, cadre }) {
  const pointParMetre = 1 / (echelle * METRE_PAR_POINT);
  const debordSol = DEBORD * echelle;
  return {
    x: cadre.x + (X - (bbox.xMin + debordSol)) * pointParMetre,
    y: cadre.y + (Y - (bbox.yMin + debordSol)) * pointParMetre,
  };
}

/**
 * Pose le liseré carmin sur l'extrait.
 *
 * @param {Buffer|Uint8Array} extrait  le PDF rendu par PAINT
 * @param {object} o
 *   anneaux  Array d'anneaux GeoJSON, en WGS84
 *   bbox     l'en-tête X-Paint-Bbox, brut ou déjà lu
 *   echelle  le dénominateur demandé
 *   format   'A4-Portrait'
 * @returns {Promise<{ok:true, octets:Uint8Array, zone:number, dessines:number}
 *   | {ok:false, motif:string}>}
 */
export async function colorier(extrait, { anneaux, bbox, echelle, format = 'A4-Portrait' }) {
  const emprise = typeof bbox === 'string' ? lireBbox(bbox) : bbox;
  if (!emprise) return { ok: false, motif: 'emprise absente ou illisible (X-Paint-Bbox)' };

  const cadre = CADRES[format];
  if (!cadre) return { ok: false, motif: `cadre non mesuré pour le format ${format}` };

  // La zone se lit sur l'emprise, jamais sur la latitude — voir lib/lambert.js.
  const zone = zoneDepuisY(emprise.yMin);
  if (!zone) return { ok: false, motif: `zone conique illisible sur Y=${emprise.yMin}` };

  if (!Array.isArray(anneaux) || anneaux.length === 0) {
    return { ok: false, motif: 'aucun contour à poser' };
  }

  const pdf = await PDFDocument.load(extrait);
  const page = pdf.getPages()[0];
  if (!page) return { ok: false, motif: 'extrait sans page' };

  let dessines = 0;
  for (const anneau of anneaux) {
    const points = [];
    for (const [lon, lat] of anneau) {
      const p = versConiqueConforme(lat, lon, zone);
      if (!p) { points.length = 0; break; }
      points.push(versPage(p, { bbox: emprise, echelle, cadre }));
    }
    if (points.length < 3) continue;

    // Convention SVG : l'ordonnée descend depuis l'ancrage. On ancre donc en
    // haut du cadre — le même piège que sur la carte de tuiles, vérifié à
    // l'image plutôt que supposé.
    const trace = `M ${points.map((p) => `${p.x.toFixed(2)} ${(cadre.y + cadre.hauteur - p.y).toFixed(2)}`).join(' L ')} Z`;
    page.drawSvgPath(trace, {
      x: 0,
      y: cadre.y + cadre.hauteur,
      color: CARMIN,
      opacity: 0.22,
      borderColor: CARMIN,
      borderWidth: 1.8,
      borderOpacity: 0.95,
    });
    dessines += 1;
  }

  if (dessines === 0) return { ok: false, motif: 'aucun contour exploitable' };
  return { ok: true, octets: await pdf.save(), zone, dessines };
}
