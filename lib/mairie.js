// CERTIF — l'adresse de la mairie, depuis l'annuaire de l'État
//
// Source : l'Annuaire de l'administration — base de données locales, publié
// par la DILA sur api-lannuaire.service-public.gouv.fr. Ouvert, sans clef, et
// tenu à jour par les collectivités elles-mêmes. C'est le même annuaire que
// celui repéré pour MATRICE, filtré sur le pivot « mairie ».
//
// LE DOMAINE A CHANGÉ le 1er octobre 2025 : service-public.fr est devenu
// service-public.gouv.fr, l'ancien n'étant annoncé accessible que jusqu'au
// 30 avril 2026. Vérifié le 20/08/2026 : l'ancien répondait encore — mais la
// DILA peut couper sans préavis, et le champ url_service_public des fiches
// pointe déjà vers le nouveau. Migré ce jour, sans attendre la coupure.
//
// LA RÈGLE EST CELLE DE MATRICE : on ne devine jamais.
//
// Une commune dont l'annuaire ne rend rien ressort SANS adresse, à charge
// pour le notaire de la saisir. Une adresse approchée sur un pli recommandé,
// c'est un mois de délai perdu et un certificat qui n'arrive pas.
//
// Deux issues distinctes, et il ne faut surtout pas les confondre :
//   • l'annuaire répond « aucune mairie pour ce code »  → introuvable
//   • l'annuaire ne répond pas                          → indisponible
// La première est un fait sur la commune ; la seconde est un incident de
// réseau. Les traiter pareil ferait dépendre chaque envoi de la disponibilité
// d'un service tiers.

const API = 'https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1'
  + '/catalog/datasets/api-lannuaire-administration/records';

/**
 * L'annuaire range l'adresse dans une chaîne JSON, et une même mairie en
 * porte souvent plusieurs — l'adresse postale (boîte postale, cedex) et
 * l'adresse physique. Pour un recommandé, c'est la postale qui prime : c'est
 * elle que La Poste dessert.
 */
function meilleureAdresse(brut) {
  let liste;
  try { liste = typeof brut === 'string' ? JSON.parse(brut) : brut; }
  catch { return null; }
  if (!Array.isArray(liste) || liste.length === 0) return null;

  const postale = liste.find((a) => /postale/i.test(a?.type_adresse || ''));
  const a = postale || liste[0];
  if (!a) return null;

  return {
    adresse: [a.numero_voie, a.service_distribution].filter(Boolean).join(' — ') || null,
    complement: [a.complement1, a.complement2].filter(Boolean).join(', ') || null,
    codePostal: a.code_postal || null,
    commune: a.nom_commune || null,
    type: a.type_adresse || null,
  };
}

/**
 * @param {string} codeInsee
 * @returns {Promise<{etat:'trouvee'|'introuvable'|'indisponible', mairie?:object, motif?:string}>}
 */
export async function chercherMairie(codeInsee) {
  if (!/^(?:\d{5}|2[AB]\d{3})$/i.test(String(codeInsee || ''))) {
    return { etat: 'introuvable', motif: 'code INSEE mal formé' };
  }

  const url = `${API}?where=${encodeURIComponent(
    `code_insee_commune="${codeInsee}" and pivot like "mairie"`)}&limit=5`;

  let reponse;
  try {
    reponse = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CERTIF/1.0 (FIDAL Notaires)' },
    });
  } catch (e) {
    return { etat: 'indisponible', motif: `annuaire injoignable : ${e.message}` };
  }
  if (!reponse.ok) {
    return { etat: 'indisponible', motif: `annuaire indisponible (${reponse.status})` };
  }

  let corps;
  try { corps = await reponse.json(); }
  catch { return { etat: 'indisponible', motif: 'réponse illisible' }; }

  const enregistrements = corps?.results || [];
  if (enregistrements.length === 0) {
    return { etat: 'introuvable', motif: `aucune mairie au code INSEE ${codeInsee}` };
  }

  // Plusieurs fiches peuvent revenir pour un même code. On préfère celle dont
  // le nom ne porte aucune qualification — annexe, déléguée, de quartier —
  // et, s'il n'y en a pas, on prend la première.
  //
  // CE QUE CE REPLI SIGNIFIE, vérifié sur Lomme (59355) le 20/08/2026 :
  // l'annuaire connaît les communes associées SOUS LEUR PROPRE CODE, avec une
  // seule fiche, nommée « Mairie déléguée ». Pour 59355 on retient donc bien
  // la mairie déléguée de Lomme — par le repli, pas par le filtre — et c'est
  // le bon guichet : elle a son service urbanisme (urbanisme@mairie-lomme.fr)
  // et la ville de Lille elle-même renvoie Lomme à son propre guichet.
  // L'ancien commentaire prétendait retenir « la mairie du chef-lieu » :
  // c'était l'inverse de ce qui se passe, et de ce qui est utile.
  const principale = enregistrements.find(
    (e) => !/annexe|d[ée]l[ée]gu|quartier|arrondissement/i.test(e?.nom || '')) || enregistrements[0];

  const adresse = meilleureAdresse(principale.adresse);
  return {
    etat: 'trouvee',
    mairie: {
      nom: principale.nom || null,
      ...(adresse || {}),
      courriel: principale.adresse_courriel || null,
      telephone: premier(principale.telephone),
      siteInternet: premier(principale.site_internet, 'valeur'),
      // Ce qui a servi à trouver, pour que l'écran puisse le montrer et que le
      // notaire vérifie d'un coup d'œil qu'on parle bien de sa commune.
      source: 'annuaire de l’administration (DILA)',
      identifiant: principale.id || null,
    },
    autres: enregistrements.length - 1,
  };
}

/** Les champs telephone et site_internet sont eux aussi des chaînes JSON. */
function premier(brut, clef = 'valeur') {
  try {
    const liste = typeof brut === 'string' ? JSON.parse(brut) : brut;
    if (!Array.isArray(liste) || !liste.length) return null;
    return liste[0]?.[clef] || liste[0]?.valeur || null;
  } catch { return null; }
}
