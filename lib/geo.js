// CERTIF — la géométrie du plan de situation
//
// Tout ce qui se calcule sans réseau est ici, et rien d'autre : projection,
// emprise, choix de l'échelle, énumération des tuiles. Ces fonctions se
// testent sur des valeurs connues (essais/geo.mjs), ce qui laisse aux modules
// d'à côté la seule part qu'on ne peut pas éprouver hors ligne — les deux
// appels HTTP.
//
// Projection : Web Mercator sphérique (EPSG:3857), celle des tuiles de la
// Géoplateforme. Elle déforme les surfaces mais conserve les angles et les
// formes locales, ce qui est exactement ce qu'on demande à un plan de
// situation : reconnaître le terrain, pas mesurer sa contenance.

export const RAYON = 6378137;                    // demi-grand axe WGS84, en mètres
export const TOUR = 2 * Math.PI * RAYON;         // circonférence à l'équateur
export const TUILE = 256;                        // côté d'une tuile, en pixels
export const METRE_PAR_POINT = 0.0254 / 72;      // un point PDF, en mètres

/** WGS84 → Web Mercator, en mètres. */
export function versMercator(lon, lat) {
  const borne = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    x: (lon * Math.PI) / 180 * RAYON,
    y: Math.log(Math.tan(Math.PI / 4 + (borne * Math.PI) / 360)) * RAYON,
  };
}

/** Résolution d'un niveau de zoom, en mètres par pixel à l'équateur. */
export const resolution = (z) => TOUR / (TUILE * 2 ** z);

/**
 * Le facteur d'échelle du Mercator : un mètre au sol vaut 1/cos(lat) mètre
 * projeté. À 50° de latitude, une carte qui paraît couvrir 1 500 mètres n'en
 * couvre que 964. L'oublier, c'est annoncer une échelle fausse sur une pièce
 * qui part à une mairie.
 */
export const deformation = (lat) => 1 / Math.cos((lat * Math.PI) / 180);

/** Emprise d'un jeu d'anneaux GeoJSON, en degrés. */
export function emprise(anneaux) {
  let ouest = Infinity; let est = -Infinity;
  let sud = Infinity; let nord = -Infinity;
  for (const anneau of anneaux) {
    for (const [lon, lat] of anneau) {
      if (lon < ouest) ouest = lon;
      if (lon > est) est = lon;
      if (lat < sud) sud = lat;
      if (lat > nord) nord = lat;
    }
  }
  if (!Number.isFinite(ouest)) return null;
  return { ouest, est, sud, nord, lon: (ouest + est) / 2, lat: (sud + nord) / 2 };
}

/**
 * Les échelles admises, du plus serré au plus large.
 *
 * On en choisit une plutôt que de calculer une échelle quelconque : « 1/10 000 »
 * se lit et se vérifie à la règle, « 1/9 143 » ne se vérifie pas.
 *
 * LA SÉRIE REDESCEND À 1/1 000, sur instruction de l'étude. Elle s'arrêtait à
 * 1/5 000 tant que le fond était un plan de ville : à cette échelle on situe le
 * terrain dans la commune, ce que demande R*410-1. Mais sur un fond CADASTRAL,
 * 1/5 000 rend les numéros de parcelle illisibles et la parcelle elle-même
 * grosse comme une tête d'épingle — ce que le premier essai a montré. Un
 * extrait cadastral se lit entre 1/1 000 et 1/2 000.
 *
 * Le compromis est assumé et il est du ressort du notaire : la pièce montre
 * mieux LA parcelle, et moins bien où elle se trouve dans la commune.
 */
export const ECHELLES = (process.env.CERTIF_CARTE_ECHELLES || '1000,2000,5000,10000,25000')
  .split(',').map((n) => parseInt(n.trim(), 10)).filter(Number.isFinite);

/**
 * Choisit l'échelle qui situe le terrain sans le noyer.
 *
 * Deux exigences opposées : R*410-1 veut qu'on « localise le terrain dans la
 * commune », donc du contexte ; mais un terrain réduit à un point ne se
 * localise pas non plus. On retient donc la plus serrée des échelles qui
 * laisse le terrain occuper au plus une fraction du cadre — le reste étant du
 * voisinage — et on impose une largeur minimale au sol pour qu'une parcelle
 * minuscule ne fasse pas descendre la carte au niveau du jardin.
 *
 * @param {object} bornes    emprise en degrés
 * @param {object} cadre     { largeur, hauteur } du cadre, en points PDF
 * @param {number} [occupation] fraction du cadre que le terrain peut occuper
 */
export function choisirEchelle(bornes, cadre, occupation = 0.5) {
  const a = versMercator(bornes.ouest, bornes.sud);
  const b = versMercator(bornes.est, bornes.nord);
  const k = deformation(bornes.lat);

  // Dimensions du terrain au sol, en mètres — donc déformation retirée.
  const largeurTerrain = Math.abs(b.x - a.x) / k;
  const hauteurTerrain = Math.abs(b.y - a.y) / k;

  for (const denominateur of ECHELLES) {
    // Ce que le cadre couvre au sol à cette échelle.
    const largeurSol = cadre.largeur * METRE_PAR_POINT * denominateur;
    const hauteurSol = cadre.hauteur * METRE_PAR_POINT * denominateur;
    if (largeurTerrain <= largeurSol * occupation && hauteurTerrain <= hauteurSol * occupation) {
      return denominateur;
    }
  }
  return ECHELLES[ECHELLES.length - 1];
}

/**
 * Le niveau de zoom dont les tuiles sont au moins aussi fines que le papier.
 *
 * On ne descend jamais en dessous : agrandir une tuile trop grossière donne
 * une carte floue sur un document qui sera imprimé. On plafonne en revanche,
 * parce que chaque niveau supplémentaire quadruple le nombre de tuiles à
 * charger pour un gain que l'œil ne voit plus sur du papier.
 */
export function choisirZoom(echelle, lat, { min = 10, max = 19 } = {}) {
  // Mètres au sol par point de papier, ramenés en mètres projetés.
  const metresParPoint = echelle * METRE_PAR_POINT * deformation(lat);
  // Il faut resolution(z) <= metresParPoint pour que la tuile soit plus fine
  // que le papier — donc z >= log2(TOUR / (TUILE * metresParPoint)).
  const z = Math.ceil(Math.log2(TOUR / (TUILE * metresParPoint)));
  return Math.max(min, Math.min(max, z));
}

/**
 * Les tuiles qui recouvrent le cadre, et où les poser.
 *
 * Rend les coordonnées en points PDF, l'origine étant le coin bas-gauche du
 * cadre — la convention du PDF, pour n'avoir aucune conversion à faire au
 * moment de dessiner.
 */
export function tuilesDuCadre({ centre, echelle, zoom, cadre }) {
  const res = resolution(zoom);                       // mètres projetés par pixel
  const c = versMercator(centre.lon, centre.lat);

  // Un point de papier vaut tant de mètres projetés…
  const metresParPoint = echelle * METRE_PAR_POINT * deformation(centre.lat);
  // …donc une tuile de 256 pixels s'imprime sur tant de points.
  const cotePoints = (TUILE * res) / metresParPoint;

  // Emprise du cadre en mètres projetés.
  const demiLargeur = (cadre.largeur / 2) * metresParPoint;
  const demiHauteur = (cadre.hauteur / 2) * metresParPoint;
  const gauche = c.x - demiLargeur;
  const haut = c.y + demiHauteur;

  // Indices de tuiles : l'origine du plan de tuilage est en haut à gauche.
  const origine = TOUR / 2;
  const colonne = (x) => Math.floor((x + origine) / (TUILE * res));
  const rangee = (y) => Math.floor((origine - y) / (TUILE * res));

  const colDebut = colonne(gauche);
  const colFin = colonne(c.x + demiLargeur);
  const rangDebut = rangee(haut);
  const rangFin = rangee(c.y - demiHauteur);

  const maximum = 2 ** zoom;
  const tuiles = [];
  for (let col = colDebut; col <= colFin; col += 1) {
    for (let rang = rangDebut; rang <= rangFin; rang += 1) {
      if (col < 0 || rang < 0 || col >= maximum || rang >= maximum) continue;
      // Coin haut-gauche de la tuile, en mètres projetés.
      const tx = col * TUILE * res - origine;
      const ty = origine - rang * TUILE * res;
      tuiles.push({
        col,
        rang,
        x: (tx - gauche) / metresParPoint,
        // En PDF, y croît vers le haut : on mesure depuis le bas du cadre.
        y: cadre.hauteur - (haut - ty) / metresParPoint - cotePoints,
        cote: cotePoints,
      });
    }
  }
  return { tuiles, cotePoints, metresParPoint };
}

/** Projette un point WGS84 en points PDF, dans le repère du cadre. */
export function versCadre(lon, lat, { centre, echelle, cadre }) {
  const p = versMercator(lon, lat);
  const c = versMercator(centre.lon, centre.lat);
  const metresParPoint = echelle * METRE_PAR_POINT * deformation(centre.lat);
  return {
    x: cadre.largeur / 2 + (p.x - c.x) / metresParPoint,
    y: cadre.hauteur / 2 + (p.y - c.y) / metresParPoint,
  };
}

/**
 * L'échelle graphique : une longueur ronde au sol, et sa longueur sur le papier.
 *
 * Elle vaut mieux que la seule mention « 1/10 000 » : une photocopie réduite
 * fausse le rapport annoncé, jamais la règle dessinée.
 */
export function echelleGraphique(echelle, largeurMax) {
  const rondes = [50, 100, 200, 250, 500, 1000, 2000, 5000];
  let retenue = rondes[0];
  for (const metres of rondes) {
    if (metres / (echelle * METRE_PAR_POINT) <= largeurMax) retenue = metres;
  }
  return { metres: retenue, points: retenue / (echelle * METRE_PAR_POINT) };
}
