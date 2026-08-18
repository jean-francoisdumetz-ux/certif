// CERTIF — épreuve des interrogations du cadastre, sans cadastre
//
// L'API Carto n'est pas joignable depuis un essai hors ligne, et il n'est pas
// question d'envoyer quarante requêtes à un service public pour vérifier une
// boucle. On remplace donc `fetch` par un service simulé qui compte ce qu'on lui
// demande — et c'est même mieux qu'un vrai appel : on mesure la SIMULTANÉITÉ,
// ce qu'aucune observation du service réel ne montrerait.
//
// CE QUE CET ESSAI PROTÈGE :
//   • l'ordre du journal, qui doit rester celui de la saisie même si les
//     réponses arrivent dans le désordre — un journal entremêlé ne se lit plus ;
//   • le plafond de quatre requêtes de front, parce qu'on se sert sur un service
//     gratuit et qu'une rafale y récolte surtout des 5xx ;
//   • l'ordre des combinaisons, chef-lieu et préfixe d'abord, qui est ce qui
//     permet de retrouver les parcelles de Lomme rangées sous Lille.
//
//   node essais/cadastre.mjs

import { geometriesParcelles, FRONT } from '../lib/cadastre.js';

let echecs = 0;
const verifier = (intitule, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'} ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
};

/**
 * Un cadastre simulé.
 *
 * @param {object} o
 *   connait   (parametres) => booléen : la combinaison rend-elle une parcelle ?
 *   delai     millisecondes de latence par appel
 */
function simuler({ connait, delai = 20 }) {
  const appels = [];
  let enCours = 0;
  let pointe = 0;

  globalThis.fetch = async (url) => {
    const parametres = Object.fromEntries(new URL(url).searchParams);
    appels.push(parametres);
    enCours += 1;
    pointe = Math.max(pointe, enCours);
    await new Promise((r) => { setTimeout(r, delai); });
    enCours -= 1;

    const trouve = connait(parametres);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        features: trouve
          ? [{
            geometry: { type: 'Polygon', coordinates: [[[3, 50], [3.001, 50], [3.001, 50.001], [3, 50]]] },
            properties: { contenance: 1000, code_insee: parametres.code_insee, com_abs: parametres.com_abs },
          }]
          : [],
      }),
    };
  };

  return { appels, pointe: () => pointe };
}

const jeu = (n) => Array.from({ length: n }, (_, i) => ({
  prefixe: null, section: 'AB', numero: String(i + 1),
}));

console.log('\n— l’ordre du journal —');
{
  // Les réponses arrivent dans le désordre : la parcelle 1 met dix fois plus de
  // temps que les autres. Le journal doit rester dans l'ordre de la saisie.
  let premier = true;
  globalThis.fetch = async (url) => {
    const p = Object.fromEntries(new URL(url).searchParams);
    const lente = premier && p.numero === '0001';
    if (lente) premier = false;
    await new Promise((r) => { setTimeout(r, lente ? 120 : 5); });
    return {
      ok: true, status: 200,
      json: async () => ({
        features: [{
          geometry: { type: 'Polygon', coordinates: [[[3, 50], [3.001, 50], [3.001, 50.001], [3, 50]]] },
          properties: { contenance: 1000 },
        }],
      }),
    };
  };
  const r = await geometriesParcelles(jeu(6), { code: '59009' });
  verifier('six parcelles retrouvées', r.parcelles.length === 6, `${r.parcelles.length}`);
  verifier('journal dans l’ordre de la saisie',
    r.journal.map((l) => l.parcelle).join(',')
    === '000 AB 0001,000 AB 0002,000 AB 0003,000 AB 0004,000 AB 0005,000 AB 0006',
    r.journal.map((l) => l.parcelle).join(','));
  verifier('les contours suivent la saisie',
    r.parcelles.map((p) => p.source.numero).join(',') === '1,2,3,4,5,6');
}

console.log('\n— quatre de front, pas davantage —');
{
  const s = simuler({ connait: () => true, delai: 25 });
  const t0 = Date.now();
  const r = await geometriesParcelles(jeu(20), { code: '59009' });
  const ms = Date.now() - t0;
  verifier('vingt parcelles retrouvées', r.parcelles.length === 20);
  verifier('un seul appel par parcelle', s.appels.length === 20, `${s.appels.length}`);
  verifier(`jamais plus de ${FRONT} appels simultanés`, s.pointe() <= FRONT, `pointe ${s.pointe()}`);
  verifier('mais bien plus d’un à la fois', s.pointe() > 1, `pointe ${s.pointe()}`);
  // Vingt appels de 25 ms en file feraient 500 ms ; à quatre de front, 125.
  verifier('l’attente est divisée', ms < 300, `${ms} ms`);
}

console.log('\n— les combinaisons, dans l’ordre —');
{
  // Le cas de Lomme : le PCI range ses parcelles sous Lille, avec le préfixe.
  // Seule la première combinaison — chef-lieu + préfixe — doit répondre, et elle
  // doit être essayée EN PREMIER, sans quoi on interroge trois fois pour rien.
  const s = simuler({
    connait: (p) => p.code_insee === '59350' && p.com_abs === '355',
    delai: 5,
  });
  const r = await geometriesParcelles(
    [{ prefixe: '355', section: 'AB', numero: '12' }],
    { code: '59355', nom: 'Lomme', chefLieu: '59350' },
  );
  verifier('la parcelle est retrouvée', r.parcelles.length === 1);
  verifier('du premier coup', s.appels.length === 1, `${s.appels.length} appel(s)`);
  verifier('sur le chef-lieu et le préfixe',
    s.appels[0].code_insee === '59350' && s.appels[0].com_abs === '355',
    JSON.stringify(s.appels[0]));
}

console.log('\n— une parcelle inconnue n’arrête pas les autres —');
{
  const s = simuler({ connait: (p) => p.numero !== '0003', delai: 5 });
  const r = await geometriesParcelles(jeu(5), { code: '59009' });
  verifier('quatre sur cinq', r.parcelles.length === 4, `${r.parcelles.length}`);
  verifier('la troisième est dite introuvable',
    r.journal.some((l) => l.parcelle === '000 AB 0003' && l.resultat === 'introuvable'));
  verifier('et le motif d’ensemble reste vide', r.motif === undefined);
}

console.log(`\n${echecs === 0 ? 'tout passe' : `${echecs} échec(s)`}`);
process.exit(echecs === 0 ? 0 : 1);
