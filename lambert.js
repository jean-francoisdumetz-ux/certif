// CERTIF — projection conique conforme de Lambert (RGF93 / CC42 à CC50)
//
// REPRISE DE REDPAR, à l'identique et sciemment. Cette fonction y est vérifiée
// contre le géoréférencement mesuré sur la planche de Saint-Omer : « le
// centroïde d'AV 1 se projette en X 1 647 577 / Y 9 283 388, soit exactement
// entre les étiquettes 1647500-1647600 et 9283300-9283400, et au centre du
// cadre ». La recopier plutôt que de la réécrire, c'est garder le bénéfice de
// cette vérification.
//
// Méthode EPSG 9802, ellipsoïde GRS80. Neuf zones : parallèle d'origine égal au
// numéro de zone, parallèles automécoïques à ±0,75°, méridien central 3° Est,
// constante en X 1 700 000 m, constante en Y (zone − 41) millions + 200 000.
//
// LA ZONE NE SE DÉDUIT PAS DE LA LATITUDE, et c'est l'apport de CERTIF sur ce
// point. REDPAR l'arrondit — z = round(lat) —, et PAINT a démontré que cette
// règle est FAUSSE dans la bande de recouvrement : Boue, à 49,93°, est servie
// en CC49 et non CC50, avec 889 km d'écart à la clef. Comme les zones se
// recouvrent d'un degré et que c'est la DGFiP qui tranche feuille par feuille,
// aucune règle géographique ne peut le deviner.
//
// D'où zoneDepuisY() : on LIT la zone sur l'emprise que le service a renvoyée,
// au lieu de la déduire. La question ne se pose plus.

const A = 6378137.0;
const APLAT = 1 / 298.257222101;
const E2 = 2 * APLAT - APLAT * APLAT;
const E = Math.sqrt(E2);

const enRad = (d) => (d * Math.PI) / 180;

const tIsometrique = (phi) => {
  const s = Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2)
    / ((1 - E * s) / (1 + E * s)) ** (E / 2);
};

const mParallele = (phi) => Math.cos(phi) / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);

/** Constante en Y d'une zone : (zone − 41) millions + 200 000. */
export const originY = (zone) => (zone - 41) * 1000000 + 200000;

/**
 * La zone, lue sur une ordonnée conique conforme.
 *
 * Les origines Y sont séparées d'un million pile et les coordonnées utiles
 * restent dans le million qui suit l'origine : Saint-Omer à 9 283 388 est en
 * CC50, Boue à 8 313 570 en CC49.
 */
export function zoneDepuisY(y) {
  const zone = Math.floor((Number(y) - 200000) / 1000000) + 41;
  return zone >= 42 && zone <= 50 ? zone : null;
}

/**
 * WGS84 → conique conforme, dans une zone IMPOSÉE.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} zone  42 à 50 — lue sur l'emprise du service, pas devinée.
 */
export function versConiqueConforme(lat, lon, zone) {
  if (!(zone >= 42 && zone <= 50)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const phi0 = enRad(zone);
  const phi1 = enRad(zone - 0.75);
  const phi2 = enRad(zone + 0.75);
  const lam0 = enRad(3);
  const X0 = 1700000;
  const Y0 = originY(zone);

  const phi = enRad(lat);
  const lam = enRad(lon);
  const m1 = mParallele(phi1);
  const m2 = mParallele(phi2);
  const t1 = tIsometrique(phi1);
  const t2 = tIsometrique(phi2);
  const t0 = tIsometrique(phi0);
  const t = tIsometrique(phi);

  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const Fc = m1 / (n * t1 ** n);
  const r0 = A * Fc * t0 ** n;
  const r = A * Fc * t ** n;
  const theta = n * (lam - lam0);

  return { zone, X: X0 + r * Math.sin(theta), Y: Y0 + r0 - r * Math.cos(theta) };
}
