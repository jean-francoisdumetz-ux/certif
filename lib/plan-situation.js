// CERTIF — le plan de situation
//
// La seule pièce exigée à l'appui d'une demande de certificat d'urbanisme
// d'information : « un plan de situation du terrain », article R*410-1. Le
// texte n'impose aucune échelle chiffrée — l'exigence est fonctionnelle,
// localiser le terrain dans la commune.
//
// DEUX SOURCES, TOUTES DEUX PUBLIQUES ET SANS CLEF :
//   • le contour des parcelles          → PCI Express, via l'API Carto (lib/cadastre.js)
//   • le fond de plan                   → Géoplateforme, tuiles WMTS PLAN IGN v2
//
// CE MODULE EST LE SEUL QUE JE N'AI PAS PU ÉPROUVER HORS LIGNE. Le bac à sable
// où il a été écrit n'a pas de sortie vers data.geopf.fr ni apicarto.ign.fr.
// Tout ce qui se calcule — projection, emprise, échelle, tuiles — vit dans
// lib/geo.js et passe ses essais ; ce qui reste ici, ce sont deux appels HTTP
// et un dessin. D'où la route /api/plan, qui rend le plan seul avec son
// journal : au premier essai en ligne, l'erreur se lit au lieu de se deviner.

import { PDFDocument, rgb } from 'pdf-lib';
import { fontes, A4, MM, net } from './mise-en-page.js';
import { geometriesParcelles } from './cadastre.js';
import {
  emprise, choisirEchelle, choisirZoom, tuilesDuCadre, versCadre, echelleGraphique,
} from './geo.js';
import { designerParcelles, hectaresAresCentiares, contenanceTotale } from './format.js';

const WMTS = 'https://data.geopf.fr/wmts';
const COUCHE = 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2';
export const TUILES_MAX = 60;

// Le cadre de la carte sur la page. Marges généreuses : le plan sera plié dans
// une enveloppe et manipulé par un service, pas encadré.
const MARGE = 18 * MM;
const HAUT_TITRE = 34 * MM;
const BAS_LEGENDE = 20 * MM;
const CADRE = {
  x: MARGE,
  y: BAS_LEGENDE,
  largeur: A4.largeur - 2 * MARGE,
  hauteur: A4.hauteur - MARGE - HAUT_TITRE - BAS_LEGENDE,
};

const BLANC = rgb(1, 1, 1);
const NOIR = rgb(0.06, 0.13, 0.22);
const GRIS = rgb(0.42, 0.45, 0.5);
const TRAIT_CADRE = rgb(0.25, 0.28, 0.32);
const CARMIN = rgb(0.63, 0.06, 0.25);

async function tuile(col, rang, zoom) {
  const url = `${WMTS}?${new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: COUCHE,
    STYLE: 'normal',
    TILEMATRIXSET: 'PM',
    TILEMATRIX: String(zoom),
    TILEROW: String(rang),
    TILECOL: String(col),
    FORMAT: 'image/png',
  })}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'CERTIF/1.0 (FIDAL Notaires)' } });
    if (!r.ok) return { ok: false, statut: r.status };
    return { ok: true, octets: Buffer.from(await r.arrayBuffer()) };
  } catch (e) {
    return { ok: false, motif: e.message };
  }
}

/**
 * Chemin SVG d'un anneau, dans le repère du cadre.
 *
 * ATTENTION À L'AXE. drawSvgPath suit la convention SVG : l'ordonnée croît
 * vers le BAS depuis le point d'ancrage, à l'inverse de tout le reste du PDF.
 * Vérifié à l'image plutôt que supposé — un chemin ancré à y=100 s'est dessiné
 * entre 41 et 100, donc vers le bas. On ancre donc en HAUT du cadre et on
 * mesure les ordonnées vers le bas ; l'oublier retournerait les parcelles
 * comme dans un miroir, ce qui ne se voit pas sur une forme presque carrée.
 */
function chemin(anneau, repere, hauteur) {
  const points = anneau.map(([lon, lat]) => versCadre(lon, lat, repere));
  if (points.length < 2) return null;
  return `M ${points.map((p) => `${p.x.toFixed(2)} ${(hauteur - p.y).toFixed(2)}`).join(' L ')} Z`;
}

/**
 * @param {object} demande
 * @param {object} [options] `chargerTuile` et `chercherGeometries` remplacent
 *   les deux sources extérieures. C'est ce qui permet d'éprouver toute la mise
 *   en page hors ligne — l'orientation notamment, qui ne se déduit pas.
 * @returns {Promise<{octets:Uint8Array, pages:number, echelle:number, zoom:number,
 *   tuiles:{demandees:number, obtenues:number}, journal:Array}|
 *   {erreur:string, journal:Array}>}
 */
export async function construirePlanSituation(
  demande,
  { chargerTuile = tuile, chercherGeometries = geometriesParcelles } = {},
) {
  const commune = demande.terrain?.commune || {};
  const parcelles = demande.terrain?.parcelles || [];
  if (!commune.code || parcelles.length === 0) {
    return { erreur: 'commune ou parcelles absentes', journal: [] };
  }

  const cadastre = await chercherGeometries(parcelles, commune);
  if (cadastre.motif) return { erreur: cadastre.motif, journal: cadastre.journal };

  const bornes = emprise(cadastre.anneaux);
  if (!bornes) return { erreur: 'contours illisibles', journal: cadastre.journal };

  const echelle = choisirEchelle(bornes, CADRE);
  const centre = { lon: bornes.lon, lat: bornes.lat };
  const zoom = choisirZoom(echelle, centre.lat);
  const { tuiles } = tuilesDuCadre({ centre, echelle, zoom, cadre: CADRE });

  if (tuiles.length > TUILES_MAX) {
    // Garde-fou : au-delà, ce n'est plus un plan de situation, c'est une carte
    // de département — et soixante requêtes dans une fonction de trente
    // secondes finiraient par la faire expirer.
    return {
      erreur: `emprise trop vaste : ${tuiles.length} tuiles à ${zoom} (maximum ${TUILES_MAX})`,
      journal: cadastre.journal,
    };
  }

  const images = await Promise.all(tuiles.map((t) => chargerTuile(t.col, t.rang, zoom)));
  const obtenues = images.filter((i) => i.ok).length;
  if (obtenues === 0) {
    const premier = images[0] || {};
    return {
      erreur: `fond de plan indisponible (${premier.statut || premier.motif || 'aucune réponse'})`,
      journal: cadastre.journal,
    };
  }

  const pdf = await PDFDocument.create();
  const f = await fontes(pdf);
  const page = pdf.addPage([A4.largeur, A4.hauteur]);
  const repere = { centre, echelle, cadre: CADRE };

  // 1 — les tuiles. Elles débordent forcément du cadre : on les pose telles
  // quelles et on masque ensuite. Redimensionner chaque tuile pour la faire
  // tenir déformerait la carte.
  for (let i = 0; i < tuiles.length; i += 1) {
    if (!images[i].ok) continue;
    const t = tuiles[i];
    const img = await pdf.embedPng(images[i].octets);
    page.drawImage(img, {
      x: CADRE.x + t.x, y: CADRE.y + t.y, width: t.cote, height: t.cote,
    });
  }

  // 2 — le masque : quatre bandes blanches qui rendent la page à sa marge.
  const bandes = [
    { x: 0, y: CADRE.y + CADRE.hauteur, width: A4.largeur, height: A4.hauteur - CADRE.y - CADRE.hauteur },
    { x: 0, y: 0, width: A4.largeur, height: CADRE.y },
    { x: 0, y: 0, width: CADRE.x, height: A4.hauteur },
    { x: CADRE.x + CADRE.largeur, y: 0, width: A4.largeur - CADRE.x - CADRE.largeur, height: A4.hauteur },
  ];
  for (const bande of bandes) page.drawRectangle({ ...bande, color: BLANC });

  // 3 — le contour des parcelles, par-dessus le fond.
  for (const anneau of cadastre.anneaux) {
    const trace = chemin(anneau, repere, CADRE.hauteur);
    if (!trace) continue;
    page.drawSvgPath(trace, {
      x: CADRE.x,
      y: CADRE.y + CADRE.hauteur, // ancrage en haut : l'axe SVG descend

      color: CARMIN,
      opacity: 0.18,
      borderColor: CARMIN,
      borderWidth: 1.6,
      borderOpacity: 0.95,
    });
  }

  page.drawRectangle({
    x: CADRE.x, y: CADRE.y, width: CADRE.largeur, height: CADRE.hauteur,
    borderColor: TRAIT_CADRE, borderWidth: 0.8,
  });

  dessinerTitre(page, f, demande, echelle);
  dessinerLegende(page, f, echelle, cadastre.parcelles.length);
  dessinerNord(page, f);

  return {
    octets: await pdf.save(),
    pages: 1,
    echelle,
    zoom,
    tuiles: { demandees: tuiles.length, obtenues },
    parcelles: cadastre.parcelles,
    journal: cadastre.journal,
  };
}

/* --------------------------------------------------------------- habillage */

function ecrire(page, texte, { x, y, taille = 10, fonte, couleur = NOIR }) {
  page.drawText(net(texte, true), { x, y, size: taille, font: fonte, color: couleur });
}

function dessinerTitre(page, f, d, echelle) {
  const haut = A4.hauteur - MARGE;
  ecrire(page, 'Plan de situation', {
    x: MARGE, y: haut - 14, taille: 16, fonte: f.romainGras,
  });
  ecrire(page, `Annexe à la demande de certificat d’urbanisme — Cerfa n° 13410*13`, {
    x: MARGE, y: haut - 29, taille: 10, fonte: f.romain, couleur: GRIS,
  });

  const lieu = [d.terrain?.adresse, `${(d.terrain?.commune?.nom || '').toUpperCase()}`
    + (d.terrain?.commune?.code ? ` — code INSEE ${d.terrain.commune.code}` : '')]
    .filter(Boolean).join(' — ');
  ecrire(page, lieu, { x: MARGE, y: haut - 47, taille: 11, fonte: f.sansGras });

  const parcelles = designerParcelles(d.terrain?.parcelles);
  const surface = hectaresAresCentiares(
    d.terrain?.superficie ?? contenanceTotale(d.terrain?.parcelles));
  ecrire(page, [parcelles, surface].filter(Boolean).join(' — '), {
    x: MARGE, y: haut - 62, taille: 10, fonte: f.romain, couleur: GRIS,
  });

  // La référence et l'échelle, calées à droite sur le bord du cadre.
  const droite = (texte, y, taille, fonte, couleur) => {
    const l = fonte.widthOfTextAtSize(net(texte, true), taille);
    ecrire(page, texte, { x: CADRE.x + CADRE.largeur - l, y, taille, fonte, couleur });
  };
  if (d.reference) droite(`Dossier ${d.reference}`, haut - 14, 10, f.sans, GRIS);
  droite(`Échelle 1/${echelle.toLocaleString('fr-FR').replace(/ | /g, ' ')}`,
    haut - 47, 11, f.sansGras, NOIR);
}

function dessinerLegende(page, f, echelle, nombre) {
  const y = CADRE.y - 12;

  // L'échelle graphique : une photocopie réduite fausse le rapport annoncé,
  // jamais la règle dessinée.
  const g = echelleGraphique(echelle, 120);
  const x = CADRE.x;
  page.drawLine({ start: { x, y: y - 4 }, end: { x: x + g.points, y: y - 4 }, thickness: 1.2, color: NOIR });
  for (const bout of [x, x + g.points]) {
    page.drawLine({ start: { x: bout, y: y - 8 }, end: { x: bout, y: y }, thickness: 1.2, color: NOIR });
  }
  ecrire(page, `0`, { x: x - 2, y: y - 19, taille: 8.5, fonte: f.sans, couleur: GRIS });
  ecrire(page, `${g.metres} m`, { x: x + g.points - 8, y: y - 19, taille: 8.5, fonte: f.sans, couleur: GRIS });

  // Le rappel de ce que montre le liseré, et l'attribution des sources.
  page.drawRectangle({
    x: x + g.points + 26, y: y - 9, width: 14, height: 9,
    color: CARMIN, opacity: 0.18, borderColor: CARMIN, borderWidth: 1.2,
  });
  ecrire(page, nombre > 1 ? `Terrain — ${nombre} parcelles` : 'Terrain', {
    x: x + g.points + 46, y: y - 7, taille: 9, fonte: f.sans,
  });

  const source = 'Fond de plan © IGN — Géoplateforme · Parcellaire : PCI Express, API Carto IGN';
  const l = f.sans.widthOfTextAtSize(net(source, true), 7.5);
  ecrire(page, source, {
    x: CADRE.x + CADRE.largeur - l, y: y - 19, taille: 7.5, fonte: f.sans, couleur: GRIS,
  });
}

/**
 * La flèche du nord, dans le coin haut-droit du cadre.
 *
 * Même piège d'axe : le chemin est écrit en convention SVG, ordonnées vers le
 * bas depuis la pointe. La pointe est donc en (0,0) et la base en y positif.
 */
function dessinerNord(page, f) {
  const x = CADRE.x + CADRE.largeur - 22;
  const sommet = CADRE.y + CADRE.hauteur - 12;
  page.drawRectangle({
    x: x - 13, y: sommet - 30, width: 26, height: 42, color: BLANC, opacity: 0.85,
  });
  page.drawSvgPath('M 0 0 L 6 17 L 0 12 L -6 17 Z', {
    x, y: sommet, color: NOIR, borderColor: NOIR, borderWidth: 0.4,
  });
  const l = f.sansGras.widthOfTextAtSize('N', 9);
  ecrire(page, 'N', { x: x - l / 2, y: sommet - 27, taille: 9, fonte: f.sansGras });
}
