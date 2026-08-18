// CERTIF — la géométrie des parcelles, depuis le cadastre
//
// Source : le module cadastre de l'API Carto de l'IGN, adossé au Plan
// cadastral informatisé (PCI Express), mis à jour deux fois l'an. Ouvert, sans
// clef — la clef générique « parcellaire » est appliquée côté IGN.
//
// LE PIÈGE EST LE PRÉFIXE, et c'est le même que celui qui a mordu MATRICE.
//
// Le PCI ne connaît que les communes ACTUELLES. Les parcelles de Lomme y
// figurent sous la commune de Lille — code 59350 — avec un préfixe 355 qui
// désigne l'ancienne commune absorbée. Interroger le PCI avec 59355, le code
// INSEE propre de Lomme, ne rend rien : ce code existe au Code officiel
// géographique, pas au cadastre.
//
// On essaie donc plusieurs combinaisons, dans un ordre raisonné, et on DIT
// laquelle a répondu. Une résolution qui réussit sans qu'on sache comment est
// une résolution qu'on ne saura pas réparer.

const API = 'https://apicarto.ign.fr/api/cadastre/parcelle';

const deuxCaracteres = (s) => String(s || '').toUpperCase().padStart(2, '0').slice(-2);
const quatreChiffres = (s) => String(s || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
const troisChiffres = (s) => String(s || '').replace(/\D/g, '').padStart(3, '0').slice(-3);

const patienter = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * UN SEUL COUP DE RETARD EST PARDONNÉ. L'API Carto rend par intermittence des
 * 500 et des 502 — le service est gratuit, adossé à une base qui se recharge,
 * et une seconde tentative aboutit le plus souvent. Sans ce rattrapage, un
 * hoquet de trois secondes fait sortir tout un dossier sans son plan de
 * situation, et l'étude ne s'en aperçoit qu'au moment d'affranchir.
 *
 * Une seule reprise, et une seule : au-delà, ce n'est plus un hoquet, et
 * insister ferait attendre le notaire devant un écran figé.
 */
async function interroger(parametres) {
  const url = `${API}?${new URLSearchParams(parametres)}`;
  let r;
  let dernier = null;
  for (let essai = 0; essai < 2; essai += 1) {
    if (essai) await patienter(700);
    try {
      r = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'CERTIF/1.0 (FIDAL Notaires)' },
      });
    } catch (e) {
      dernier = { ok: false, panne: true, motif: `cadastre injoignable : ${e.message}` };
      r = null;
      continue;
    }
    // 5xx : le service va mal, mais peut-être seulement l'instant d'après.
    if (r.status >= 500) {
      dernier = { ok: false, panne: true, motif: `cadastre indisponible (${r.status}, deux tentatives)` };
      r = null;
      continue;
    }
    dernier = null;
    break;
  }
  if (!r) return dernier;
  // 400 et 404 disent « pas de résultat pour ces paramètres » : on essaie la
  // combinaison suivante. Tout autre code dit que le service va mal — insister
  // avec d'autres paramètres n'y changerait rien, et multiplierait par quatre
  // le temps d'attente avant de rendre la main.
  if (r.status === 404 || r.status === 400) return { ok: true, traits: [] };
  if (!r.ok) return { ok: false, panne: true, motif: `cadastre indisponible (${r.status})` };

  let corps;
  try { corps = await r.json(); }
  catch { return { ok: false, motif: 'réponse du cadastre illisible' }; }

  return { ok: true, traits: Array.isArray(corps?.features) ? corps.features : [] };
}

/**
 * Les combinaisons tentées pour une parcelle, dans l'ordre.
 *
 * D'abord la commune de rattachement avec le préfixe — c'est la forme juste
 * pour une commune associée ou déléguée. Puis la commune elle-même, avec et
 * sans préfixe, pour le cas ordinaire et pour les communes dont le PCI porte
 * encore le code propre.
 */
function tentatives(parcelle, commune) {
  const section = deuxCaracteres(parcelle.section);
  const numero = quatreChiffres(parcelle.numero);
  const prefixe = parcelle.prefixe ? troisChiffres(parcelle.prefixe) : null;
  const essais = [];

  if (prefixe && prefixe !== '000' && commune.chefLieu && commune.chefLieu !== commune.code) {
    essais.push({ code_insee: commune.chefLieu, com_abs: prefixe, section, numero });
  }
  if (prefixe && prefixe !== '000') {
    essais.push({ code_insee: commune.code, com_abs: prefixe, section, numero });
  }
  essais.push({ code_insee: commune.code, section, numero });
  if (commune.chefLieu && commune.chefLieu !== commune.code) {
    essais.push({ code_insee: commune.chefLieu, section, numero });
  }
  return essais;
}

/** Les anneaux d'un objet GeoJSON, quel que soit son type. */
function anneauxDe(geometrie) {
  if (!geometrie) return [];
  if (geometrie.type === 'Polygon') return geometrie.coordinates;
  if (geometrie.type === 'MultiPolygon') return geometrie.coordinates.flat();
  return [];
}

/**
 * @returns {Promise<{parcelles:Array, anneaux:Array, journal:Array, motif?:string}>}
 *   `journal` retrace ce qui a été tenté et ce qui a répondu — c'est ce que la
 *   route de diagnostic affiche quand une parcelle reste introuvable.
 */
export async function geometriesParcelles(parcelles, commune) {
  const journal = [];
  const trouvees = [];
  const anneaux = [];
  let incident = null;

  for (const parcelle of parcelles) {
    const designation = `${parcelle.prefixe || '000'} ${deuxCaracteres(parcelle.section)} ${quatreChiffres(parcelle.numero)}`;
    let resolue = false;

    for (const essai of tentatives(parcelle, commune)) {
      const r = await interroger(essai);
      if (!r.ok) {
        // Une indisponibilité n'est pas une absence : on la retient, et on
        // n'en conclut pas que la parcelle n'existe pas. On cesse aussi
        // d'essayer les autres combinaisons — c'est le service qui répond mal,
        // pas les paramètres qui sont faux.
        incident = incident || r.motif;
        journal.push({ parcelle: designation, essai, resultat: r.motif });
        if (r.panne) break;
        continue;
      }
      journal.push({ parcelle: designation, essai, resultat: `${r.traits.length} objet(s)` });
      if (r.traits.length === 0) continue;

      const trait = r.traits[0];
      const siens = anneauxDe(trait.geometry);
      if (siens.length === 0) continue;

      trouvees.push({
        designation,
        // La parcelle telle que le notaire l'a saisie, et SES anneaux à elle.
        // Les garder séparés est nécessaire pour choisir sur laquelle centrer
        // l'extrait quand le terrain en compte plusieurs ; le tableau `anneaux`
        // agrégé ne sert qu'à calculer l'emprise d'ensemble.
        source: parcelle,
        anneaux: siens,
        contenance: trait.properties?.contenance ?? null,
        codeInsee: trait.properties?.code_insee ?? essai.code_insee,
        prefixe: trait.properties?.com_abs ?? essai.com_abs ?? '000',
      });
      anneaux.push(...siens);
      resolue = true;
      break;
    }

    if (!resolue) journal.push({ parcelle: designation, resultat: 'introuvable' });
  }

  return {
    parcelles: trouvees,
    anneaux,
    journal,
    motif: anneaux.length === 0
      ? (incident || 'aucune parcelle retrouvée au cadastre')
      : undefined,
  };
}
