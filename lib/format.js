// CERTIF — mise en forme des données d'une demande
//
// Rien ici ne touche au PDF : ce sont des chaînes, et elles se testent sans
// rien dessiner. C'est voulu — la désignation cadastrale est le seul endroit
// où une erreur de forme se retrouve telle quelle dans un acte.

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function dateLongue(d = new Date()) {
  const j = d.getDate();
  return `${j === 1 ? '1er' : j} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

export function dateCourte(d = new Date()) {
  return [d.getDate(), d.getMonth() + 1, d.getFullYear()]
    .map((n, i) => (i < 2 ? String(n).padStart(2, '0') : n)).join('/');
}

/**
 * Une parcelle : { prefixe?, section, numero, contenance? }
 *
 * Le PRÉFIXE n'est pas décoratif. Il vaut « 000 » dans le cas ordinaire, mais
 * il porte le code de la commune absorbée quand la parcelle relève d'une
 * commune associée ou déléguée — c'est exactement le cas de LOMME, rattachée à
 * Lille. L'omettre change de parcelle sans prévenir : la section AB 12 de
 * Lomme n'est pas la section AB 12 de Lille. On l'affiche donc dès qu'il n'est
 * pas nul, et on ne le fabrique jamais soi-même.
 */
export function designerParcelle(p) {
  const prefixe = p.prefixe && p.prefixe !== '000' ? `préfixe ${p.prefixe}, ` : '';
  const section = String(p.section || '').toUpperCase();
  const numero = String(p.numero || '').replace(/^0+(?=\d)/, '');
  return `${prefixe}section ${section} n° ${numero}`;
}

/**
 * « préfixe 355, section AB n° 12 et 13, et section AC n° 4 »
 *
 * On regroupe par préfixe et par section plutôt que de répéter la formule
 * complète à chaque parcelle. Ce n'est pas de la coquetterie : c'est la forme
 * qu'un notaire lit dans une désignation, et une énumération qui répète
 * « section AB » quatre fois se relit mal — donc se vérifie mal.
 */
export function designerParcelles(parcelles = []) {
  if (!parcelles.length) return '';

  const groupes = [];
  for (const p of parcelles) {
    const prefixe = p.prefixe && p.prefixe !== '000' ? String(p.prefixe) : '';
    const section = String(p.section || '').toUpperCase();
    const numero = String(p.numero || '').replace(/^0+(?=\d)/, '');
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.prefixe === prefixe && dernier.section === section) dernier.numeros.push(numero);
    else groupes.push({ prefixe, section, numeros: [numero] });
  }

  const morceaux = groupes.map((g) => {
    const numeros = g.numeros.length === 1
      ? `n° ${g.numeros[0]}`
      : `n° ${g.numeros.slice(0, -1).join(', ')} et ${g.numeros[g.numeros.length - 1]}`;
    return `${g.prefixe ? `préfixe ${g.prefixe}, ` : ''}section ${g.section} ${numeros}`;
  });

  if (morceaux.length === 1) return morceaux[0];
  return `${morceaux.slice(0, -1).join(', ')}, et ${morceaux[morceaux.length - 1]}`;
}

/** Somme des contenances, en m², quand elles sont toutes connues. */
export function contenanceTotale(parcelles = []) {
  if (!parcelles.length || parcelles.some((p) => p.contenance === undefined || p.contenance === null)) return null;
  return parcelles.reduce((s, p) => s + Number(p.contenance || 0), 0);
}

/**
 * 12345 → « 12 345 m² »
 *
 * L'exposant est revenu avec Segoe UI, dont la couverture a été vérifiée à
 * l'image. Si les fontes de l'étude manquaient, net() le remplacerait par un
 * 2 ordinaire — « 12 345 m2 » : d'un aspect fautif, mais d'un sens juste. Avec
 * les polices de base, l'exposant disparaissait purement et simplement, et la
 * contenance se lisait en mètres linéaires.
 */
export function metresCarres(n) {
  if (n === null || n === undefined) return null;
  const chiffres = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${chiffres} m²`;
}

/**
 * 51 → « 0 ha 00 a 51 ca »
 *
 * La contenance cadastrale s'exprime en hectares, ares et centiares — un
 * centiare valant un mètre carré. C'est la forme employée par REDPAR et par
 * PAINT, et surtout celle des extraits de matrice et des désignations d'acte.
 * Les ares et les centiares se cadrent sur deux chiffres, les hectares non :
 * « 0 ha 00 a 51 ca », « 12 ha 04 a 07 ca ».
 */
export function hectaresAresCentiares(m2) {
  if (m2 === null || m2 === undefined) return null;
  const total = Math.round(m2);
  const ha = Math.floor(total / 10000);
  const a = Math.floor((total % 10000) / 100);
  const ca = total % 100;
  return `${ha} ha ${String(a).padStart(2, '0')} a ${String(ca).padStart(2, '0')} ca`;
}

/** Adresse postale sur plusieurs lignes, sans ligne vide. */
export function adressePostale({ destinataire, nom, adresse, complement, codePostal, commune }) {
  return [destinataire, nom, complement, adresse, [codePostal, (commune || '').toUpperCase()].filter(Boolean).join(' ')]
    .filter((l) => l && String(l).trim())
    .join('\n');
}
