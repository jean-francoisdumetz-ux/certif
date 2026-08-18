// CERTIF — la géométrie du plan, éprouvée sur des valeurs connues.
//
// C'est la part du plan de situation qui se vérifie sans réseau. Les deux
// appels HTTP — cadastre et fond de plan — ne peuvent l'être qu'en ligne ;
// tout le reste est ici.
//
//   node essais/geo.mjs
import {
  versMercator, resolution, deformation, emprise, choisirEchelle, choisirZoom,
  tuilesDuCadre, versCadre, echelleGraphique, TOUR, TUILE, METRE_PAR_POINT,
} from '../lib/geo.js';

let echecs = 0;
const dire = (intitule, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'} ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
};
const proche = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

console.log('\n— projection —');
const zero = versMercator(0, 0);
// Pas d'égalité stricte : tan(pi/4) vaut 0,9999999999999999 en flottant, et
// son logarithme un demi-milliardième de mètre. Exiger zéro exact, c'est
// exiger que l'arithmétique flottante soit exacte.
dire('origine sur le méridien de Greenwich à l’équateur',
  proche(zero.x, 0, 1e-6) && proche(zero.y, 0, 1e-6),
  `x=${zero.x} y=${zero.y}`);

// Repère connu : la longitude 180° tombe à la moitié de la circonférence.
dire('180° = demi-tour du monde', proche(versMercator(180, 0).x, TOUR / 2, 1),
  `${versMercator(180, 0).x.toFixed(0)} m pour ${(TOUR / 2).toFixed(0)}`);

// Lille : 3,0573° E, 50,6292° N. En Mercator, y doit valoir environ 6 552 km.
const lille = versMercator(3.0573, 50.6292);
dire('Lille projetée', proche(lille.x, 340_300, 2000) && proche(lille.y, 6_552_000, 5000),
  `x=${lille.x.toFixed(0)} y=${lille.y.toFixed(0)}`);

dire('symétrie nord-sud', proche(versMercator(0, 45).y, -versMercator(0, -45).y, 1e-6));

console.log('\n— résolution et déformation —');
dire('zoom 0 : une seule tuile pour le monde', proche(resolution(0) * TUILE, TOUR, 1e-6));
dire('chaque niveau divise par deux', proche(resolution(10), resolution(9) / 2, 1e-9));
// À 60° de latitude, le facteur vaut exactement 2 : cos(60°) = 0,5.
dire('déformation à 60° = 2', proche(deformation(60), 2, 1e-9));
// 1 / cos(50,6292°) = 1,5765 — recalculé, ma première valeur était fausse.
dire('déformation à 50,6° ≈ 1,5765', proche(deformation(50.6292), 1.5765, 0.001),
  deformation(50.6292).toFixed(4));

console.log('\n— emprise —');
const anneau = [[[3.00, 50.60], [3.01, 50.60], [3.01, 50.61], [3.00, 50.61], [3.00, 50.60]]];
const b = emprise(anneau);
dire('bornes', b.ouest === 3.00 && b.est === 3.01 && b.sud === 50.60 && b.nord === 50.61);
dire('centre', proche(b.lon, 3.005, 1e-9) && proche(b.lat, 50.605, 1e-9));
dire('emprise vide', emprise([[]]) === null);

console.log('\n— choix de l’échelle —');
const cadre = { largeur: 465, hauteur: 470 };
// Une parcelle de 30 m de côté : la plus serrée des échelles suffit.
const petite = emprise([[[3.0000, 50.6000], [3.00042, 50.6000], [3.00042, 50.60027], [3.0000, 50.60027]]]);
// Même minuscule, une parcelle ne descend pas sous 1/5 000 : en dessous, ce
// n'est plus un plan de situation.
dire('petite parcelle → 1/5 000', choisirEchelle(petite, cadre) === 5000,
  `1/${choisirEchelle(petite, cadre)}`);

// Un ensemble de 2 km de large : il faut s'élever.
const vaste = emprise([[[3.00, 50.60], [3.0283, 50.60], [3.0283, 50.61], [3.00, 50.61]]]);
const e = choisirEchelle(vaste, cadre);
dire('ensemble de 2 km → 1/25 000', e === 25000, `1/${e}`);

// Le cadre à 1/2 000 couvre 465 pt × 0,3528 mm × 2 000 ≈ 328 m.
dire('1/5 000 couvre ≈ 820 m de large',
  proche(cadre.largeur * METRE_PAR_POINT * 5000, 820, 4),
  `${(cadre.largeur * METRE_PAR_POINT * 5000).toFixed(0)} m`);

console.log('\n— zoom —');
// On ne prédit pas le niveau : on vérifie l'invariant qui compte — la tuile
// est plus fine que le papier, sans l'être inutilement (moins d'un facteur 2).
for (const ech of [5000, 10000, 25000]) {
  const z = choisirZoom(ech, 50.6292);
  const finesse = resolution(z);
  const papier = ech * METRE_PAR_POINT * deformation(50.6292);
  dire(`1/${ech} → zoom ${z}, tuile plus fine que le papier`,
    finesse <= papier && finesse * 2 > papier,
    `${finesse.toFixed(2)} m/px pour ${papier.toFixed(2)} m/pt`);
}

console.log('\n— tuiles —');
const centre = { lon: 3.0573, lat: 50.6292 };
const echelle = 10000;
const zoom = choisirZoom(echelle, centre.lat);
const { tuiles, cotePoints } = tuilesDuCadre({ centre, echelle, zoom, cadre });
dire('des tuiles, et pas trop', tuiles.length > 0 && tuiles.length <= 60, `${tuiles.length} tuiles`);
dire('elles recouvrent le cadre',
  Math.min(...tuiles.map((t) => t.x)) <= 0
  && Math.max(...tuiles.map((t) => t.x + t.cote)) >= cadre.largeur
  && Math.min(...tuiles.map((t) => t.y)) <= 0
  && Math.max(...tuiles.map((t) => t.y + t.cote)) >= cadre.hauteur);
dire('côté cohérent avec la résolution',
  proche(cotePoints, TUILE * resolution(zoom) / (echelle * METRE_PAR_POINT * deformation(centre.lat)), 1e-6),
  `${cotePoints.toFixed(1)} pt`);
dire('indices entiers et dans les bornes',
  tuiles.every((t) => Number.isInteger(t.col) && Number.isInteger(t.rang)
    && t.col >= 0 && t.rang >= 0 && t.col < 2 ** zoom && t.rang < 2 ** zoom));

console.log('\n— report d’un point dans le cadre —');
const c = versCadre(centre.lon, centre.lat, { centre, echelle, cadre });
dire('le centre tombe au centre', proche(c.x, cadre.largeur / 2, 1e-9) && proche(c.y, cadre.hauteur / 2, 1e-9));
const nord = versCadre(centre.lon, centre.lat + 0.01, { centre, echelle, cadre });
dire('le nord est vers le haut', nord.y > c.y);
const est = versCadre(centre.lon + 0.01, centre.lat, { centre, echelle, cadre });
dire('l’est est vers la droite', est.x > c.x);

// 0,01° de latitude vaut environ 1 112 m au sol ; à 1/10 000 cela fait 111 mm,
// soit 315 points — que la déformation ne doit PAS gonfler, puisqu'elle est
// retirée des deux côtés.
dire('un dixième de degré reporté juste', proche(nord.y - c.y, 315, 6),
  `${(nord.y - c.y).toFixed(0)} pt`);

console.log('\n— échelle graphique —');
const g = echelleGraphique(10000, 140);
dire('longueur ronde qui tient dans la place', g.points <= 140 && g.metres >= 100,
  `${g.metres} m sur ${g.points.toFixed(0)} pt`);
dire('rapport juste', proche(g.metres / (10000 * METRE_PAR_POINT), g.points, 1e-6));

console.log(`\n${echecs === 0 ? 'tout passe' : `${echecs} échec(s)`}`);
process.exit(echecs === 0 ? 0 : 1);
