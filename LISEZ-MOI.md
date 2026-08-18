# CERTIF — demandes de certificat d'urbanisme d'information

Le frère de MATRICE, pour le CU du a) de l'article L. 410-1. Un écran de
saisie, un bouton qui produit **un seul PDF** prêt à imprimer, un second qui
dépose dans Outlook un **brouillon** portant ce PDF et les consignes d'envoi.

## Ce que produit le bouton

    page 1        lettre d'accompagnement, sur le papier à en-tête de l'étude
    exemplaire 1  Cerfa 13410*13 (p. 1 à 3) · annexe s'il y a lieu · plan
    exemplaire 2  idem, à l'identique

Une lettre pour deux exemplaires : c'est un pli, pas deux envois. R*410-2 exige
deux exemplaires pour un certificat d'information, ce que l'imprimé rappelle
lui-même en page 3.

Les **consignes d'impression et d'affranchissement ne sont pas dans le PDF** :
elles vivent dans le corps du courriel. Une feuille de consignes internes posée
en tête du document, c'est une feuille qu'on oublie de retirer avant de fermer
l'enveloppe.

## Le plan de situation

Seule pièce exigée à l'appui de la demande (R*410-1). Il est joint à chaque
exemplaire, après le Cerfa, et vient de **deux sources**. `CERTIF_PLAN_VOIE`
règle l'ordre — `carte` par défaut, `paint`, ou `paint-seul`.

1. **La carte fabriquée par CERTIF** — fond PLAN IGN v2 de la Géoplateforme,
   contour de la parcelle en carmin, échelle graphique, flèche du nord. Elle est
   **déterministe** : CERTIF compose lui-même la carte, il sait donc à quel
   point du papier correspond chaque coordonnée, et le contour tombe juste par
   construction. C'est la seule des deux qui **colore la parcelle**.
2. **PAINT** — `GET paint-blue.vercel.app/api/extrait`, l'extrait de plan
   cadastral officiel de la DGFiP. Meilleure pièce sur le fond, mais **sa
   parcelle n'est pas colorée** et elle ne peut pas l'être depuis une fonction
   serverless : la colorisation de PAINT vit dans son navigateur et repose sur
   un géoréférencement par OCR des étiquettes de coordonnées en marge, que son
   propre code décrit comme « une fermeture insoudable ».

Trois choses héritées, notées dans le code :

- **Le repli d'échelle du SCPC est muet, et REDPAR l'a mesuré** : une demande à
  1/10000 est servie à 1/1000, sans un mot. Les échelles honorées sont 1000,
  1250, 1500, 2000, 2500, 4000 et 5000 ; CERTIF n'en retient que le haut
  (`CERTIF_PLAN_ECHELLES`, défaut 2000 à 5000).
- **Le préfixe**, encore. Le PCI range les parcelles de Lomme sous Lille avec le
  préfixe 355 ; interroger avec 59355 ne rend rien. CERTIF essaie les
  combinaisons dans un ordre raisonné et dit laquelle a répondu.
- **Aucune des deux voies n'est silencieuse** : celle qui a servi remonte à
  l'écran, et l'avertissement dit quand la parcelle n'est pas colorée.

Diagnostic : `POST /api/plan?journal=1` rend tout le cheminement.
`?sansPaint=1` force la carte, et le bouton « Pourquoi le plan manque » de
l'écran fait la même chose en un clic.

## Déploiement

### Fichiers à déposer dans `data/`

| Fichier | Origine |
|---|---|
| `cerfa_13410-13.pdf` | https://www.formulaires.service-public.gouv.fr/gf/cerfa_13410.do |
| `entete-haut.png`, `entete-bas.png` | produits par `outils/preparer-entete.py` |
| `polices/segoeui.ttf`, `segoeuib.ttf`, `segoeuii.ttf`, `seguisb.ttf` | `C:\Windows\Fonts` |
| `signature/` | recopié de MATRICE — signature Outlook et ses images |

Le PDF du papier à en-tête (`trame courrier.pdf` du Drive) **n'est pas déployé** :
c'est un courrier réel, portant un nom de collaborateur et une référence
d'affaire cliente. Seules les deux bandes découpées le sont.

### Variables d'environnement (Vercel)

    CERTIF_OFFICE_NOM                 FIDAL Notaires
    CERTIF_OFFICE_ADRESSE             3 place de la Madeleine
    CERTIF_OFFICE_CP                  75008
    CERTIF_OFFICE_COMMUNE             Paris
    CERTIF_OFFICE_SIGNATAIRE          Jean-François DUMETZ
    CERTIF_OFFICE_QUALITE             Notaire associé
    CERTIF_OFFICE_FORME               SELAS
    CERTIF_OFFICE_SIRET               33102277200023
    CERTIF_OFFICE_COURRIEL            accueil@fidal.notaires.fr
    CERTIF_OFFICE_TELEPHONE           01 44 51 01 23
    CERTIF_OFFICE_SIGNATAIRE_COURRIEL jean-francois.dumetz@fidal.notaires.fr

    AZURE_TENANT_ID                   (les mêmes que MATRICE)
    AZURE_CLIENT_ID
    AZURE_CLIENT_SECRET
    CERTIF_SIGNATURE_SCELLEE          (le même bloc que MATRICE, recopié)
    CERTIF_BOITE_SERVICE              (facultatif, régime application)
    CERTIF_MOT_DE_PASSE               (facultatif, mode recette)

Chaque variable `CERTIF_*` retombe sur son équivalent `MATRICE_*` si elle est
absente : même étude, même annuaire, et deux saisies de la même valeur, c'est
l'occasion qu'elles divergent.

### Entra

CERTIF **réutilise l'inscription d'application de MATRICE**. Une seule chose à
faire dans le portail : ajouter l'adresse de CERTIF aux **URI de redirection
SPA** de l'inscription existante. Une seconde inscription voudrait dire un
second secret à faire tourner et un second consentement à obtenir.

## Les essais

    node essais/bout-en-bout.mjs        la chaîne complète, refus compris
    node essais/geo.mjs                 projection, échelle, tuiles
    node essais/plan.mjs                la mise en page du plan, sources simulées
    node essais/apercu.js               un PDF d'exemple à regarder
    node essais/glyphes-couverture.mjs  ce que les polices dessinent vraiment

Aucun ne demande le réseau ni de serveur. Ce qui ne peut pas s'éprouver hors
ligne — l'appel à PAINT, le cadastre, les tuiles — se vérifie par
`/api/plan?journal=1`, qui rend le motif plutôt que de le laisser deviner.

## Ce qui a été constaté, et pas supposé

- Les polices de base du format PDF **ne dessinent pas l'exposant deux** :
  « 1 061 m² » s'imprimait « 1 061 m ». Avec Segoe UI incorporée, tout passe
  sauf la césure conditionnelle. Vérifié en dessinant chaque caractère seul et
  en comptant l'encre.
- Un rectangle blanc posé sur du texte **ne le supprime pas** : `pdftotext`
  ressortait le nom d'un client d'un autre dossier sous la lettre. D'où les
  bandes en images.
- Deux champs de l'en-tête du Cerfa sont posés **par-dessus** le cartouche
  imprimé : à l'aplatissement, le numéro sortait dédoublé.
- Les noms des 86 champs du Cerfa ont été **énumérés sur le fichier**, jamais
  devinés.
