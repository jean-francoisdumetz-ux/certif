// CERTIF — dépôt du brouillon Outlook, et repli .eml
//
// Le message que dépose CERTIF est INTERNE À L'ÉTUDE. Il porte le PDF prêt à
// imprimer et les consignes d'envoi, et il s'adresse à qui va l'imprimer et
// l'affranchir — pas à la mairie. La mairie, elle, reçoit du papier : un pli
// recommandé par demande, jamais un courriel. C'est la différence avec MATRICE,
// dont le message part au service des impôts fonciers.
//
// D'où le choix de mettre les consignes dans le corps du message et non dans le
// PDF (voir lib/consignes.js) : une feuille de consignes internes glissée en
// tête du document est une feuille qu'on oublie de retirer avant de fermer
// l'enveloppe.
//
// DEUX RÉGIMES D'AUTHENTIFICATION, ET IL NE FAUT PAS LES CONFONDRE :
//
//   • L'ENVOI part de l'écran, avec un collaborateur identifié. Il utilise SON
//     jeton délégué, pour que le brouillon apparaisse dans SA boîte et que la
//     piste d'audit porte son nom. Passer l'envoi en régime application ferait
//     disparaître l'auteur — exactement ce que la piste d'audit doit retenir.
//
//   • LE RÉGIME APPLICATION (client credentials, CERTIF_BOITE_SERVICE) reste
//     câblé mais inemployé : CERTIF n'a pas de cron. Il servira le jour où un
//     traitement tournera sans personne devant l'écran — le suivi des délais
//     d'un mois, par exemple. À ce moment-là il faudra un consentement
//     administrateur, restreint par une application access policy à la seule
//     boîte de service.
//
// REPLI : si Graph est indisponible ou non configuré, on rend un .eml conforme,
// que l'utilisateur ouvre dans Outlook. Le consentement administrateur étant
// refusé par la politique du tenant, c'est aujourd'hui la voie normale — un
// double-clic par envoi. On ne perd jamais un envoi parce qu'un jeton a expiré.
//
// DEUX FORMES DE CORPS COEXISTENT :
//   • texte seul — pour un message qui n'a pas à être habillé ;
//   • HTML + images en ligne — pour celui qui porte la signature de l'office.
//     Les deux voies, Graph et .eml, doivent rendre EXACTEMENT la même chose,
//     sinon la signature se décompose dans le repli et personne ne s'en aperçoit
//     avant que le courriel soit parti.
//
// Ce module vient de MATRICE et lui reste identique dans son code. Une
// correction apportée ici doit être portée là-bas, et réciproquement : rien ne
// le signale automatiquement.
const GRAPH = 'https://graph.microsoft.com/v1.0';

// ---------------------------------------------------------------- jeton
let cacheJeton = null; // { valeur, expireLe }

/** Jeton applicatif (client credentials). Mis en cache jusqu'à 60 s de sa fin. */
async function jetonApplication() {
  const { AZURE_TENANT_ID: tenant, AZURE_CLIENT_ID: client, AZURE_CLIENT_SECRET: secret } = process.env;
  if (!tenant || !client || !secret) return null;

  if (cacheJeton && Date.now() < cacheJeton.expireLe - 60_000) return cacheJeton.valeur;

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!r.ok) throw new Error(`jeton refusé (${r.status}) : ${await r.text()}`);

  const j = await r.json();
  cacheJeton = { valeur: j.access_token, expireLe: Date.now() + j.expires_in * 1000 };
  return cacheJeton.valeur;
}

/**
 * Échange « on-behalf-of ».
 *
 * Le navigateur obtient un jeton dont l'audience est NOTRE API — c'est ce que
 * vérifie lib/verrou.js. Ce jeton n'est pas valable pour Microsoft Graph, qui
 * répondrait 401 : sans cet échange, CERTIF basculerait silencieusement sur le
 * repli .eml en donnant l'illusion qu'Entra est branché.
 *
 * Le serveur troque donc le jeton de l'utilisateur contre un jeton Graph portant
 * la même identité. Le navigateur ne détient à aucun moment un jeton donnant
 * accès à une boîte aux lettres — c'est tout l'intérêt de ne pas lui en confier.
 *
 * https://learn.microsoft.com/entra/identity-platform/v2-oauth2-on-behalf-of-flow
 */
async function jetonGraphPourUtilisateur(jetonUtilisateur) {
  const { AZURE_TENANT_ID: tenant, AZURE_CLIENT_ID: client, AZURE_CLIENT_SECRET: secret } = process.env;
  if (!tenant || !client || !secret) {
    throw new Error('échange on-behalf-of impossible : AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET');
  }

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: client,
      client_secret: secret,
      assertion: jetonUtilisateur,
      scope: 'https://graph.microsoft.com/Mail.ReadWrite',
      requested_token_use: 'on_behalf_of',
    }),
  });

  if (!r.ok) {
    // Le corps d'erreur d'Entra porte un code AADSTS parlant (consentement
    // manquant, secret expiré, audience inattendue). On le remonte tronqué :
    // c'est ce qui permet de diagnostiquer sans ouvrir les journaux.
    throw new Error(`échange refusé (${r.status}) : ${(await r.text()).slice(0, 300)}`);
  }
  return (await r.json()).access_token;
}

// --------------------------------------------------------------- .eml
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const plier = (s, n = 76) => (s.match(new RegExp(`.{1,${n}}`, 'g')) || []).join('\r\n');
const octets = (p) => (typeof p.contenuBase64 === 'string' ? p.contenuBase64 : p.contenu.toString('base64'));

/** En-tête non-ASCII : encodage MIME « encoded-word » (RFC 2047). */
function enteteEncodee(txt) {
  return /^[\x20-\x7E]*$/.test(txt) ? txt : `=?UTF-8?B?${b64(txt)}?=`;
}

function hachage(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}

const partieTexte = (corps) => [
  'Content-Type: text/plain; charset="UTF-8"',
  'Content-Transfer-Encoding: base64',
  '',
  plier(b64(corps)),
];

const partieHtml = (html) => [
  'Content-Type: text/html; charset="UTF-8"',
  'Content-Transfer-Encoding: base64',
  '',
  plier(b64(html)),
];

/** Image affichée dans le corps : elle porte un Content-ID, pas un nom de pièce jointe. */
const partieImage = (img) => [
  `Content-Type: ${img.type || 'image/png'}; name="${img.nom}"`,
  'Content-Transfer-Encoding: base64',
  `Content-ID: <${img.cid}>`,
  `Content-Disposition: inline; filename="${img.nom}"`,
  '',
  plier(octets(img)),
];

const partiePiece = (p) => [
  `Content-Type: ${p.type || 'application/octet-stream'}; name="${p.nom}"`,
  'Content-Transfer-Encoding: base64',
  `Content-Disposition: attachment; filename="${p.nom}"`,
  '',
  plier(octets(p)),
];

/**
 * Construit un message .eml conforme (RFC 5322 / 2045 / 2387).
 * Corps en UTF-8 base64 : le quoted-printable est illisible dès qu'il y a
 * des accents, et un rappel qu'on n'arrive pas à lire ne sert à rien.
 *
 * Structure rendue quand il y a du HTML, des images et des pièces jointes :
 *
 *   multipart/mixed
 *     multipart/alternative
 *       text/plain                 ← le client qui ne sait pas lire le HTML
 *       multipart/related          ← le HTML et SES images, pas des pièces jointes
 *         text/html
 *         image/png × n
 *     application/pdf × n
 */
export function construireEml({ objet, corps, corpsHtml, imagesEnLigne = [], destinataires = [], expediteur, pieces = [] }) {
  const graine = Math.abs(hachage(objet + (corpsHtml || corps || ''))).toString(36);
  const MIX = `----certif-mix-${graine}`;
  const ALT = `----certif-alt-${graine}`;
  const REL = `----certif-rel-${graine}`;

  const entetes = [
    `Date: ${new Date().toUTCString()}`,
    expediteur ? `From: ${expediteur}` : null,
    destinataires.length ? `To: ${destinataires.join(', ')}` : null,
    `Subject: ${enteteEncodee(objet)}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  // Le corps, seul ou alternatif, éventuellement lié à ses images.
  let corpsParties;
  let corpsEntete;

  if (corpsHtml && imagesEnLigne.length) {
    corpsEntete = `Content-Type: multipart/alternative; boundary="${ALT}"`;
    corpsParties = [
      `--${ALT}`, ...partieTexte(corps || ''),
      `--${ALT}`, `Content-Type: multipart/related; type="text/html"; boundary="${REL}"`, '',
      `--${REL}`, ...partieHtml(corpsHtml),
      ...imagesEnLigne.flatMap((i) => [`--${REL}`, ...partieImage(i)]),
      `--${REL}--`,
      `--${ALT}--`,
    ];
  } else if (corpsHtml) {
    corpsEntete = `Content-Type: multipart/alternative; boundary="${ALT}"`;
    corpsParties = [
      `--${ALT}`, ...partieTexte(corps || ''),
      `--${ALT}`, ...partieHtml(corpsHtml),
      `--${ALT}--`,
    ];
  } else {
    corpsEntete = null;
    corpsParties = partieTexte(corps || '');
  }

  // Sans pièce jointe, le corps est le message.
  if (pieces.length === 0) {
    return [...entetes, ...(corpsEntete ? [corpsEntete] : []), '', ...corpsParties, ''].join('\r\n');
  }

  const parties = [
    `--${MIX}`,
    ...(corpsEntete ? [corpsEntete, ''] : []),
    ...corpsParties,
    ...pieces.flatMap((p) => [`--${MIX}`, ...partiePiece(p)]),
    `--${MIX}--`,
    '',
  ];

  return [...entetes, `Content-Type: multipart/mixed; boundary="${MIX}"`, '', ...parties].join('\r\n');
}

// ------------------------------------------------------------- Graph
function versGraph({ objet, corps, corpsHtml, imagesEnLigne = [], destinataires, pieces }) {
  const piece = (p, enLigne) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: p.nom,
    contentType: p.type || 'application/octet-stream',
    contentBytes: octets(p),
    ...(enLigne ? { isInline: true, contentId: p.cid } : {}),
  });

  return {
    subject: objet,
    body: corpsHtml ? { contentType: 'HTML', content: corpsHtml } : { contentType: 'Text', content: corps },
    toRecipients: destinataires.map((a) => ({ emailAddress: { address: a.trim() } })),
    attachments: [
      ...imagesEnLigne.map((i) => piece(i, true)),
      ...pieces.map((p) => piece(p, false)),
    ],
  };
}

/**
 * Dépose un brouillon. Ne l'envoie jamais : c'est le principe posé au mémo —
 * la machine propose, l'humain valide. Le collaborateur relit et clique.
 *
 * @param {object}   o
 * @param {string}   o.objet
 * @param {string}   o.corps           version texte (obligatoire : c'est le repli de tous les replis)
 * @param {string}   [o.corpsHtml]     version HTML, signature comprise
 * @param {Array}    [o.imagesEnLigne] [{cid, nom, type, contenu}] images du corps HTML
 * @param {string[]} o.destinataires
 * @param {Array}    [o.pieces]        [{nom, type, contenu|contenuBase64}]
 * @param {string}   [o.jetonDelegue]  jeton de l'utilisateur ; sinon régime application
 * @returns {Promise<{voie:'graph'|'eml', id?:string, webLink?:string, eml?:string, motif?:string}>}
 */
export async function deposerBrouillon({
  objet, corps, corpsHtml, imagesEnLigne = [], destinataires = [], pieces = [], jetonDelegue,
}) {
  if (!objet || !corps) throw new Error('objet et corps obligatoires');

  const msg = { objet, corps, corpsHtml, imagesEnLigne, destinataires, pieces };
  const boite = process.env.CERTIF_BOITE_SERVICE || process.env.MATRICE_BOITE_SERVICE; // UPN de la boîte, régime application
  let jeton = null;
  let cible = '/me/messages';

  if (jetonDelegue) {
    // Le jeton reçu vaut pour NOTRE API, pas pour Graph : il faut l'échanger.
    try {
      jeton = await jetonGraphPourUtilisateur(jetonDelegue);
    } catch (e) {
      return repli(msg, e.message);
    }
  }

  if (!jeton) {
    try {
      jeton = await jetonApplication();
    } catch (e) {
      return repli(msg, `jeton indisponible : ${e.message}`);
    }
    if (!jeton || !boite) {
      return repli(msg, 'Graph non configuré (AZURE_* ou CERTIF_BOITE_SERVICE manquants)');
    }
    cible = `/users/${encodeURIComponent(boite)}/messages`;
  }

  try {
    const r = await fetch(GRAPH + cible, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(versGraph(msg)),
    });
    if (!r.ok) {
      return repli(msg, `Graph ${r.status} : ${(await r.text()).slice(0, 300)}`);
    }
    const m = await r.json();
    return { voie: 'graph', id: m.id, webLink: m.webLink };
  } catch (e) {
    return repli(msg, `Graph injoignable : ${e.message}`);
  }
}

function repli(msg, motif) {
  // Un repli n'est pas un échec, mais il ne doit pas passer inaperçu :
  // si tous les brouillons partent en .eml pendant trois semaines, il faut
  // que quelqu'un s'en aperçoive autrement qu'en le remarquant à l'œil.
  console.warn('[CERTIF] repli .eml —', motif);
  return { voie: 'eml', eml: construireEml(msg), motif };
}
