// CERTIF — le plan de situation par PAINT
//
// PAINT expose une route unique, /api/extrait, qui pilote le Service de
// Consultation du Plan Cadastral de la DGFiP et rend l'EXTRAIT DE PLAN
// CADASTRAL OFFICIEL en PDF. C'est une meilleure pièce que la carte de tuiles
// que CERTIF sait fabriquer lui-même : c'est le document que les services
// d'urbanisme lisent tous les jours, avec son cartouche, sa mention d'échelle
// et son origine.
//
// ON APPELLE, ON N'ABSORBE PAS. C'est le parti que MARTEAU a établi et que le
// notaire a rappelé : PAINT reste seul maître de sa mécanique — jeton CSRF,
// variantes de nom de commune, garde-fou de zone conique. Recopier ces trois
// cents lignes ici, c'est se condamner à les corriger deux fois le jour où la
// DGFiP change son formulaire.
//
// LE PIÈGE, ET IL EST DOCUMENTÉ DANS PAINT LUI-MÊME : « le service sert
// SILENCIEUSEMENT une valeur de repli quand un paramètre ne lui plaît pas —
// une demande à 1/10000 revient à 1/1000 sans un mot ». L'en-tête X-Paint-
// Echelle rend l'échelle DEMANDÉE, pas celle servie. CERTIF ne peut donc pas
// savoir, depuis ici, si le plan qu'il reçoit est à l'échelle qu'il a demandée.
// D'où l'échelle de repli explicite ci-dessous, et le fait qu'on rapporte
// toujours ce qui a été demandé — jamais qu'on affirme ce qui a été servi.

// Emprise de la page, en mètres de PAPIER, relevée dans PAINT (MAP_SIZES,
// centièmes de millimètre). Multipliée par le dénominateur d'échelle, elle
// donne l'emprise au sol.
const PAGE = { largeur: 0.1955, hauteur: 0.2110 }; // A4 portrait

/**
 * Les échelles que l'on ose demander au service.
 *
 * Prudence délibérée : le repli du SCPC étant muet, on s'en tient à des
 * valeurs usuelles du plan cadastral. Le jour où l'étude aura vérifié
 * lesquelles sont réellement honorées — les essais de PAINT du 29 juillet
 * l'ont fait pour la rotation, pas pour l'échelle —, cette liste pourra
 * s'étendre par CERTIF_PLAN_ECHELLES.
 *
 * 1/1000 en est ABSENT à dessein, bien que ce soit la valeur par défaut du
 * service : une page A4 au 1/1000 couvre 195 × 211 mètres. C'est un plan de
 * masse. R*410-1 demande de situer le terrain DANS la commune, ce qu'une
 * carte de deux cents mètres de côté ne fait pas.
 */
export const ECHELLES = (process.env.CERTIF_PLAN_ECHELLES || '2000,5000')
  .split(',').map((n) => parseInt(n.trim(), 10)).filter(Number.isFinite);

export const adresse = () =>
  (process.env.CERTIF_PAINT || 'https://paint-blue.vercel.app').replace(/\/+$/, '');

/**
 * L'échelle la plus serrée où tout le terrain tient dans la page, avec du
 * voisinage autour.
 *
 * `marge` = 2,5 : le terrain occupe au plus 40 % de la page. C'est la même
 * règle que pour la carte de tuiles — situer le terrain DANS la commune
 * suppose qu'on voie autre chose que lui.
 */
export function echellePour({ largeur, hauteur }, marge = 2.5) {
  for (const echelle of ECHELLES) {
    if (largeur * marge <= PAGE.largeur * echelle && hauteur * marge <= PAGE.hauteur * echelle) {
      return echelle;
    }
  }
  return ECHELLES[ECHELLES.length - 1];
}

/** Emprise au sol de la page, en mètres, à une échelle donnée. */
export const empriseSol = (echelle) => ({
  largeur: PAGE.largeur * echelle,
  hauteur: PAGE.hauteur * echelle,
});

/**
 * Demande l'extrait à PAINT.
 *
 * @param {object} parcelle  { prefixe, section, numero }
 * @param {string} codeInsee le code de la commune AU CADASTRE — donc celui du
 *   chef-lieu pour une commune associée, le préfixe portant l'ancienne commune.
 * @returns {Promise<{ok:true, octets:Buffer, entetes:object}|{ok:false, motif:string}>}
 */
export async function extrait({ parcelle, codeInsee, echelle, delai = 26000 }) {
  const parametres = new URLSearchParams({
    commune: codeInsee,
    prefixe: String(parcelle.prefixe || '000').padStart(3, '0').slice(-3),
    section: String(parcelle.section || '').toUpperCase().padStart(2, '0').slice(-2),
    parcelle: String(parcelle.numero || '').replace(/\D/g, '').padStart(4, '0').slice(-4),
    echelle: String(echelle),
    taille: 'A4',
    orientation: 'portrait',
  });

  const url = `${adresse()}/api/extrait?${parametres}`;
  const minuteur = AbortSignal.timeout ? AbortSignal.timeout(delai) : undefined;

  let r;
  try {
    r = await fetch(url, {
      headers: { 'User-Agent': 'CERTIF/1.0 (FIDAL Notaires)' },
      signal: minuteur,
    });
  } catch (e) {
    return { ok: false, motif: `PAINT injoignable : ${e.message}` };
  }

  if (!r.ok) {
    // PAINT rend ses erreurs en JSON, avec un message utile — « parcelle
    // introuvable pour ces références », « étape « recherche » : délai
    // dépassé ». On le remonte tel quel : c'est lui qui sait.
    let message = `HTTP ${r.status}`;
    try { message = (await r.json())?.message || message; } catch { /* pas du JSON */ }
    return { ok: false, motif: `PAINT ${r.status} — ${message}` };
  }

  const type = r.headers.get('content-type') || '';
  if (!type.includes('pdf')) return { ok: false, motif: `PAINT a rendu ${type || 'un type inconnu'}` };

  return {
    ok: true,
    octets: Buffer.from(await r.arrayBuffer()),
    entetes: {
      // Ce que PAINT dit avoir DEMANDÉ. Pas ce que la DGFiP a servi : la
      // distinction est le piège documenté plus haut, et il ne faut pas
      // l'effacer en renommant ce champ « echelle ».
      echelleDemandee: r.headers.get('X-Paint-Echelle'),
      page: r.headers.get('X-Paint-Page'),
      pageMetres: r.headers.get('X-Paint-Page-M'),
      centre: r.headers.get('X-Paint-Centre'),
      bbox: r.headers.get('X-Paint-Bbox'),
    },
  };
}
