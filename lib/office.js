// CERTIF — identité de l'office
//
// Aucune valeur par défaut, et c'est délibéré. Un essai de MATRICE avait fait
// partir un PDF portant une adresse inventée, parce qu'un défaut « de test »
// traînait dans le code. Ici, une variable absente n'est pas remplacée : elle
// est signalée, et la génération s'arrête. Mieux vaut un bouton qui refuse de
// fonctionner qu'un courrier au nom d'une étude qui n'existe pas.
//
// CERTIF est un projet Vercel distinct de MATRICE. Les variables lui sont
// propres, mais on accepte les noms MATRICE_OFFICE_* en repli : c'est la même
// étude, et faire ressaisir la même adresse dans deux projets, c'est créer
// l'occasion qu'ils divergent.

const val = (quoi) =>
  (process.env[`CERTIF_OFFICE_${quoi}`] || process.env[`MATRICE_OFFICE_${quoi}`] || '').trim();

const REQUIS = {
  nom: 'NOM',
  adresse: 'ADRESSE',
  codePostal: 'CP',
  commune: 'COMMUNE',
  signataire: 'SIGNATAIRE',
};

export function office() {
  return {
    nom: val('NOM'),
    adresse: val('ADRESSE'),
    codePostal: val('CP'),
    commune: val('COMMUNE'),
    // Le signataire de la lettre. MATRICE n'en avait pas besoin — le Cerfa
    // 11565 n'a qu'un cadre « demandeur », qui est l'office. Une lettre, elle,
    // se signe par quelqu'un.
    signataire: val('SIGNATAIRE'),
    qualite: val('QUALITE') || null,
    // L'adresse du rédacteur, pour le bloc « Dossier suivi par » du papier à
    // en-tête. Distincte de la boîte de l'étude : la première dit à qui
    // répondre, la seconde est celle portée sur le Cerfa.
    signataireCourriel: val('SIGNATAIRE_COURRIEL') || null,
    telephone: val('TELEPHONE') || null,
    courriel: val('COURRIEL') || null,
  };
}

/**
 * Le demandeur porté sur le Cerfa, c'est l'étude.
 *
 * L'imprimé le dit en tête du cadre 2 : « Le demandeur sera le titulaire du
 * certificat et destinataire de la décision. » C'est précisément ce qu'on
 * veut — le certificat revient à l'étude, sous sa référence, sans transiter
 * par le client. Un certificat d'urbanisme se délivre à quiconque le demande :
 * point n'est besoin d'être propriétaire, ni de justifier d'un mandat.
 *
 * L'étude se déclare donc en 2.2, personne morale. Le SIRET, la forme sociale
 * et le représentant viennent de variables dédiées : ce sont des mentions
 * d'état civil de la société, et les inventer serait exactement la faute déjà
 * commise une fois avec une adresse.
 */
export function demandeurDepuisOffice(o = office()) {
  const [prenom, ...nom] = (o.signataire || '').split(/\s+/);
  return {
    denomination: val('DENOMINATION') || o.nom,
    raisonSociale: val('RAISON') || null,
    siret: val('SIRET') || null,
    formeSociale: val('FORME') || null,
    representantNom: val('REPRESENTANT_NOM') || (nom.length ? nom.join(' ') : null),
    representantPrenom: val('REPRESENTANT_PRENOM') || (nom.length ? prenom : null),
    adresse: o.adresse,
    codePostal: o.codePostal,
    commune: o.commune,
    telephone: o.telephone,
    courriel: o.courriel,
  };
}

/** Les variables à renseigner avant que le bouton puisse produire quoi que ce soit. */
export function officeManquant() {
  const o = office();
  return Object.entries(REQUIS)
    .filter(([clef]) => !o[clef])
    .map(([, suffixe]) => `CERTIF_OFFICE_${suffixe}`);
}

export function officeComplet() {
  return officeManquant().length === 0;
}
