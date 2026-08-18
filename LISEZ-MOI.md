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

## Ce qu'il ne fait pas encore

**Le plan de situation.** C'est la seule pièce exigée à l'appui de la demande
(R*410-1). CERTIF le signale à l'écran et le courriel demande à l'assistante de
le joindre. La fabrication sera branchée sur PAINT, qui a déjà le géoréférenceur
et le fond tuilé — à une échelle près : un plan de situation situe le terrain
dans la commune, là où PAINT travaille à l'échelle de la parcelle.

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
    node essais/apercu.js               un PDF d'exemple à regarder
    node essais/glyphes-couverture.mjs  ce que les polices dessinent vraiment

Aucun ne demande le réseau ni de serveur.

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
