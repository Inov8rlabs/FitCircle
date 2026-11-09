import { ArrowLeft } from 'lucide-react';
import { type Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: "Conditions d'utilisation | FitCircle",
  description: "Conditions d'utilisation de FitCircle",
  alternates: { languages: { en: '/terms' } },
};

// Traduction de la version anglaise 1.3. Mettre à jour en même temps que app/terms/page.tsx.
const EFFECTIVE_DATE = '6 novembre 2026';
const TERMS_VERSION = '1.3';

const h2 = 'text-2xl font-semibold mb-4';
const h3 = 'text-xl font-semibold mb-3 mt-6';
const ul = 'list-disc pl-6 space-y-2';

export default function ConditionsPage() {
  return (
    <div lang="fr" className="min-h-screen bg-canvas">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button variant="ghost" size="sm" className="mb-6" asChild>
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour à l&apos;accueil
          </Link>
        </Button>

        <h1 className="text-4xl font-bold mb-8">Conditions d&apos;utilisation</h1>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <div role="note" className="not-prose mb-6 rounded-xl border border-amber-400/50 bg-amber-400/10 p-4 text-amber-100">
            <p className="font-semibold">Traduction automatique — en attente de révision humaine</p>
            <p className="text-sm mt-1" lang="en">Machine translation pending human review.</p>
            <p className="text-sm mt-2">
              En cas de divergence, la{' '}
              <Link href="/terms" className="underline" lang="en">version anglaise</Link> fait foi, sauf si la loi
              applicable en dispose autrement.
            </p>
          </div>
          <p className="text-muted-foreground mb-2">Date d&apos;entrée en vigueur : {EFFECTIVE_DATE}</p>
          <p className="text-muted-foreground mb-6 text-sm">
            Version {TERMS_VERSION} ·{' '}
            <Link href="/terms" className="text-primary hover:underline" lang="en">English version</Link>
          </p>

          <section className="mb-8">
            <h2 className={h2}>1. Acceptation des conditions</h2>
            <p className="mb-4">
              En accédant à FitCircle ou en l&apos;utilisant (le « Service », « nous »), vous acceptez d&apos;être lié
              par les présentes Conditions d&apos;utilisation (les « Conditions »). Si vous n&apos;êtes pas
              d&apos;accord avec une partie de ces Conditions, vous ne pouvez pas accéder au Service.
            </p>
            <p>
              Les présentes Conditions constituent une entente juridiquement contraignante entre vous et Inov8r Labs
              Inc. (« FitCircle »), société de la Colombie-Britannique (British Columbia; numéro de société
              BC1310005) dont le siège social est situé au{' '}
              485 - 6400 Roberts Street,
              Burnaby (Colombie-Britannique) V5G 4C9, Canada.
              En créant un compte, en participant à des défis ou en utilisant une fonction du Service, vous
              reconnaissez avoir lu, compris et accepté les présentes Conditions.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>2. Description du Service</h2>
            <p className="mb-4">
              FitCircle est une plateforme sociale de suivi de la condition physique et de la nutrition qui aide les
              utilisateurs à adopter de saines habitudes avec leurs amis. Le Service offre :
            </p>
            <ul className={ul}>
              <li>Des défis amicaux fondés sur l&apos;activité et les saines habitudes</li>
              <li>La consignation des aliments, de l&apos;eau et des entraînements, y compris des estimations nutritionnelles assistées par IA</li>
              <li>Le suivi quotidien des progrès (poids, pas, humeur, énergie)</li>
              <li>Des fonctions sociales, dont les FitCircles (groupes d&apos;amis aux objectifs communs)</li>
              <li>Des classements, des systèmes de réussites et de la ludification</li>
              <li>L&apos;analyse des progrès et la visualisation des tendances</li>
              <li>Des présences photo pour la responsabilisation</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className={h2}>3. Admissibilité</h2>
            <p className="mb-4">Pour utiliser FitCircle, vous devez :</p>
            <ul className={ul}>
              <li>Avoir au moins 18 ans (nous vérifions votre âge à l&apos;inscription)</li>
              <li>Avoir la capacité juridique de conclure un contrat</li>
              <li>Ne pas être interdit d&apos;utiliser le Service en vertu des lois applicables</li>
              <li>Résider dans un territoire où le Service est offert</li>
            </ul>
            <p className="mt-4">
              Le Service est offert aux États-Unis, au Canada, en Inde et à Singapour. Le site Web
              n&apos;accepte pas de nouvelles inscriptions provenant de l&apos;Union européenne ou de l&apos;Espace
              économique européen.
            </p>
            <p className="mt-4">
              En utilisant le Service, vous déclarez et garantissez que vous remplissez toutes les conditions
              d&apos;admissibilité.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>4. Comptes d&apos;utilisateur</h2>
            <p className="mb-4">Pour utiliser FitCircle, vous devez créer un compte. Vous acceptez de :</p>
            <ul className={ul}>
              <li>Fournir des renseignements exacts, à jour et complets lors de l&apos;inscription</li>
              <li>Tenir à jour les renseignements de votre compte</li>
              <li>Préserver la sécurité et la confidentialité de votre mot de passe</li>
              <li>Nous aviser immédiatement de toute utilisation non autorisée de votre compte</li>
              <li>Être responsable de toutes les activités effectuées dans votre compte</li>
              <li>Ne communiquer vos identifiants à personne</li>
              <li>Ne pas créer plusieurs comptes pour manipuler des défis ou contourner des restrictions</li>
            </ul>
            <p className="mt-4">
              Vous êtes seul responsable de toute perte ou de tout dommage découlant d&apos;un manquement à la
              sécurité de votre compte. FitCircle se réserve le droit de suspendre ou de résilier les comptes qui
              enfreignent les présentes Conditions.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>5. Défis et compétitions</h2>
            <h3 className={h3}>5.1 Participation aux défis</h3>
            <p className="mb-4">Lorsque vous vous joignez à un défi, vous acceptez de :</p>
            <ul className={ul}>
              <li>Respecter les règles et exigences propres à ce défi</li>
              <li>Fournir des données exactes et véridiques pour toutes vos présences et soumissions</li>
              <li>Effectuer les présences requises dans les délais prévus</li>
              <li>Accepter les décisions du créateur du défi quant à l&apos;interprétation des règles</li>
            </ul>
            <h3 className={h3}>5.2 Aucun argent en jeu</h3>
            <p className="mb-4">
              Les défis FitCircle servent uniquement à la motivation et à la responsabilisation. Se joindre à un défi
              est gratuit. Les défis ne comportent aucuns frais d&apos;inscription, paris ou enjeux monétaires, et
              n&apos;attribuent ni argent ni prix ayant une valeur monétaire. Les positions au classement, séries,
              badges et réussites semblables n&apos;ont aucune valeur monétaire et ne peuvent être échangés contre de
              l&apos;argent, des biens ou des services.
            </p>
            <h3 className={h3}>5.3 Franc-jeu et intégrité</h3>
            <p className="mb-4">FitCircle repose sur la confiance et la responsabilisation. Vous ne devez pas :</p>
            <ul className={ul}>
              <li>Falsifier votre poids, vos pas ou d&apos;autres données de santé</li>
              <li>Soumettre des photos manipulées ou frauduleuses</li>
              <li>Utiliser les données ou les photos d&apos;une autre personne</li>
              <li>Vous entendre avec d&apos;autres participants pour manipuler les résultats</li>
              <li>Recourir à tout moyen artificiel pour obtenir un avantage injuste</li>
            </ul>
            <p className="mt-4">
              Les infractions peuvent entraîner la disqualification, le retrait des défis et des FitCircles, ainsi
              que la suspension ou la résiliation du compte. FitCircle se réserve le droit d&apos;enquêter sur les
              infractions soupçonnées et de rendre des décisions finales en matière de franc-jeu.
            </p>
            <h3 className={h3}>5.4 Annulation d&apos;un défi</h3>
            <p className="mb-4">FitCircle se réserve le droit d&apos;annuler un défi si :</p>
            <ul className={ul}>
              <li>Le nombre minimal de participants n&apos;est pas atteint</li>
              <li>Des problèmes techniques empêchent une compétition équitable</li>
              <li>Des manquements au franc-jeu sont détectés</li>
              <li>La loi ou la réglementation l&apos;exige</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className={h2}>6. Exactitude des données et responsabilité de l&apos;utilisateur</h2>
            <p className="mb-4">Vous êtes seul responsable de l&apos;exactitude des données que vous soumettez, notamment :</p>
            <ul className={ul}>
              <li>Les mesures de poids</li>
              <li>Le nombre de pas</li>
              <li>Les photos et images de progrès</li>
              <li>Les renseignements personnels sur la santé</li>
              <li>Toute autre donnée saisie dans le Service</li>
            </ul>
            <p className="mt-4">
              FitCircle ne vérifie pas l&apos;exactitude des données soumises. Vous reconnaissez que les autres
              participants se fient à la véracité de vos soumissions et que la falsification de données enfreint
              les présentes Conditions et la confiance de la communauté.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>7. Contenu des utilisateurs</h2>
            <p className="mb-4">
              Vous conservez la propriété de tout contenu que vous publiez sur FitCircle, y compris vos photos,
              commentaires et renseignements de profil (le « Contenu utilisateur »). En publiant du Contenu
              utilisateur, vous accordez toutefois à FitCircle une licence mondiale, non exclusive, libre de
              redevances et transférable lui permettant d&apos;utiliser, de reproduire, de distribuer, d&apos;adapter,
              d&apos;afficher et d&apos;exécuter ce contenu dans le cadre du Service et des activités de FitCircle.
            </p>
            <p className="mb-4">Vous déclarez et garantissez que :</p>
            <ul className={ul}>
              <li>Vous possédez les droits nécessaires sur tout Contenu utilisateur que vous publiez</li>
              <li>Votre Contenu utilisateur ne viole aucun droit de tiers</li>
              <li>Votre Contenu utilisateur respecte les présentes Conditions et les lois applicables</li>
            </ul>
            <p className="mt-4">
              FitCircle se réserve le droit de retirer tout Contenu utilisateur qui enfreint les présentes
              Conditions ou que nous jugeons inapproprié, offensant ou préjudiciable.
            </p>
            <h3 className={h3}>7.1 Normes de la communauté</h3>
            <p className="mb-4">
              FitCircle ne tolère aucun contenu répréhensible ni aucun utilisateur abusif. Le contenu haineux,
              harcelant, menaçant, sexuellement explicite ou violent, ou qui fait la promotion de l&apos;automutilation,
              des troubles alimentaires ou d&apos;activités illégales est interdit partout dans le Service, y compris
              dans les messages, les photos, les noms et biographies de profil et les noms de FitCircles ou de défis.
            </p>
            <ul className={ul}>
              <li>Vous pouvez signaler tout message, toute photo ou tout utilisateur depuis l&apos;application</li>
              <li>Vous pouvez bloquer tout utilisateur, ce qui masque son contenu</li>
              <li>Nous examinons les signalements dans un délai de 24 heures</li>
              <li>Nous retirons le contenu contrevenant et suspendons ou retirons les utilisateurs qui l&apos;ont publié</li>
            </ul>
            <p className="mt-4">
              Pour signaler directement une préoccupation, écrivez à{' '}
              <a href="mailto:support@fitcircle.ai" className="text-primary hover:underline">support@fitcircle.ai</a>.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>8. Utilisations interdites</h2>
            <p className="mb-4">Vous ne pouvez pas utiliser FitCircle pour :</p>
            <ul className={ul}>
              <li>Enfreindre les lois ou règlements applicables</li>
              <li>Harceler, maltraiter, menacer ou intimider d&apos;autres utilisateurs</li>
              <li>Publier des renseignements faux, trompeurs ou frauduleux</li>
              <li>Usurper l&apos;identité d&apos;une personne ou d&apos;une entité</li>
              <li>Tenter d&apos;accéder sans autorisation au Service ou aux comptes d&apos;autres utilisateurs</li>
              <li>Nuire au fonctionnement du Service ou le perturber</li>
              <li>Utiliser des scripts automatisés, des robots ou des outils de moissonnage</li>
              <li>Recueillir des renseignements sur les utilisateurs sans leur consentement</li>
              <li>Publier du contenu obscène, diffamatoire ou haineux</li>
              <li>Faire la promotion d&apos;activités ou de substances illégales</li>
              <li>Porter atteinte à des droits de propriété intellectuelle</li>
              <li>Transmettre des virus, des logiciels malveillants ou tout autre code nuisible</li>
              <li>Créer plusieurs comptes pour manipuler des défis ou déjouer le système</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className={h2}>9. Avertissement relatif à la santé</h2>
            <p className="font-semibold text-lg mb-3">IMPORTANT : À LIRE ATTENTIVEMENT</p>
            <p className="mb-4">
              FitCircle n&apos;est PAS un instrument médical, un fournisseur de soins de santé ni un substitut à un
              avis, un diagnostic ou un traitement médical professionnel. Le Service est conçu uniquement à des fins
              générales de condition physique et de bien-être.
            </p>
            <p className="mb-4"><strong>Consultez un professionnel de la santé qualifié avant :</strong></p>
            <ul className={ul}>
              <li>De commencer un programme de perte de poids ou un défi de condition physique</li>
              <li>D&apos;apporter des changements importants à votre alimentation ou à votre routine d&apos;exercice</li>
              <li>De participer à des défis si vous avez des problèmes de santé préexistants</li>
              <li>D&apos;utiliser FitCircle si vous êtes enceinte, si vous allaitez ou si vous souffrez d&apos;un trouble alimentaire</li>
            </ul>
            <p className="mt-4 mb-4"><strong>FitCircle décline expressément toute responsabilité à l&apos;égard :</strong></p>
            <ul className={ul}>
              <li>Des résultats sur la santé découlant de votre utilisation du Service</li>
              <li>Des blessures ou complications de santé découlant de la participation à des défis</li>
              <li>De l&apos;exactitude ou de l&apos;exhaustivité des renseignements sur la santé présentés dans le Service</li>
              <li>Des conseils, recommandations ou suggestions d&apos;autres utilisateurs</li>
              <li>Des valeurs nutritionnelles, des scores et des réponses produits par les fonctions d&apos;intelligence artificielle</li>
            </ul>
            <p className="mt-4 mb-4">
              Les valeurs de calories, de macronutriments et de composition corporelle produites par les fonctions
              d&apos;IA de FitCircle sont des estimations et peuvent être inexactes. Les réponses de l&apos;assistant
              Fitzy sont générées par intelligence artificielle, fournies à titre d&apos;information générale sur le
              bien-être et ne constituent pas un avis médical ou diététique.
            </p>
            <p className="mt-4">
              <strong>
                Si vous ressentez des effets indésirables sur votre santé en utilisant FitCircle, cessez
                immédiatement de l&apos;utiliser et consultez un professionnel de la santé.
              </strong>
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>10. Confidentialité et protection des données</h2>
            <p className="mb-4">
              Votre utilisation du Service est régie par notre{' '}
              <Link href="/fr/privacy" className="text-primary hover:underline">Politique de confidentialité</Link>, qui
              explique comment nous recueillons, utilisons et protégeons vos renseignements personnels.
              L&apos;acceptation des présentes Conditions ne constitue pas un consentement au traitement de vos
              données de santé ni à l&apos;utilisation des fonctions d&apos;IA : nous demandons ces consentements
              séparément dans l&apos;application et sur le site Web, et vous pouvez les retirer en tout temps dans
              Paramètres → Confidentialité.
            </p>
            <p>
              Les données de santé et de condition physique que vous partagez peuvent être visibles par les autres
              participants de vos défis et FitCircles, selon vos paramètres de confidentialité et la nature des défis
              auxquels vous participez.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>11. Paiements et facturation</h2>
            <h3 className={h3}>11.1 Modes de paiement</h3>
            <p className="mb-4">
              FitCircle est gratuit. Un paiement n&apos;est requis que pour les achats facultatifs de FitCircle Pro.
              En effectuant un achat, vous autorisez le processeur de paiement concerné à débiter votre mode de
              paiement du prix affiché au moment de l&apos;achat.
            </p>
            <h3 className={h3}>11.2 Abonnements</h3>
            <p className="mb-4">FitCircle peut offrir des abonnements à frais récurrents :</p>
            <ul className={ul}>
              <li>Les frais d&apos;abonnement sont facturés à l&apos;avance sur une base mensuelle ou annuelle</li>
              <li>Les abonnements se renouvellent automatiquement, sauf annulation</li>
              <li>Vous pouvez annuler votre abonnement en tout temps dans les paramètres de votre compte</li>
              <li>L&apos;annulation prend effet à la fin de la période de facturation en cours</li>
              <li>Aucun remboursement n&apos;est accordé pour les périodes partielles</li>
              <li>Nous vous aviserons au moins 30 jours à l&apos;avance de toute modification de prix</li>
            </ul>
            <h3 className={h3}>11.3 Politique de remboursement</h3>
            <p className="mb-4">
              Les frais ne sont pas remboursables, sauf si la loi applicable ou la politique de remboursement de la
              boutique où vous avez effectué l&apos;achat l&apos;exige.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>12. Propriété intellectuelle</h2>
            <p className="mb-4">
              Le Service ainsi que son contenu original, ses fonctions et sa conception appartiennent à FitCircle et
              sont protégés par les lois internationales sur le droit d&apos;auteur, les marques de commerce, les
              brevets, les secrets commerciaux et la propriété intellectuelle.
            </p>
            <p className="mb-4">Vous ne pouvez pas :</p>
            <ul className={ul}>
              <li>Copier, modifier ou créer des œuvres dérivées du Service</li>
              <li>Faire de l&apos;ingénierie inverse ou décompiler toute partie du Service</li>
              <li>Retirer ou modifier les avis de droit d&apos;auteur, de marque ou de propriété</li>
              <li>Utiliser le nom, le logo ou les marques de FitCircle sans autorisation écrite</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className={h2}>13. Services de tiers</h2>
            <p className="mb-4">
              FitCircle peut s&apos;intégrer à des services de tiers (comme des moniteurs d&apos;activité, des
              processeurs de paiement ou des réseaux sociaux). Votre utilisation de ces services est régie par
              leurs propres conditions et politiques de confidentialité. FitCircle n&apos;est pas responsable des
              pratiques de ces tiers.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>14. Exclusions de garanties</h2>
            <p className="mb-4 uppercase font-semibold">
              LE SERVICE EST FOURNI « TEL QUEL » ET « SELON LA DISPONIBILITÉ », SANS GARANTIE D&apos;AUCUNE SORTE,
              EXPRESSE OU IMPLICITE.
            </p>
            <p className="mb-4">FitCircle exclut toute garantie, notamment :</p>
            <ul className={ul}>
              <li>Les garanties de qualité marchande, d&apos;adaptation à un usage particulier et d&apos;absence de contrefaçon</li>
              <li>Les garanties quant à l&apos;exactitude, à la fiabilité ou à l&apos;exhaustivité du contenu</li>
              <li>Les garanties que le Service sera ininterrompu, sécurisé ou exempt d&apos;erreurs</li>
              <li>Les garanties quant aux résultats obtenus en utilisant le Service</li>
            </ul>
            <p className="mt-4">
              Vous utilisez FitCircle à vos propres risques. Nous ne garantissons aucun résultat particulier de la
              participation aux défis.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>15. Limitation de responsabilité</h2>
            <p className="mb-4 uppercase font-semibold">DANS TOUTE LA MESURE PERMISE PAR LA LOI :</p>
            <p className="mb-4">
              FitCircle, ses dirigeants, administrateurs, employés et mandataires ne sont pas responsables des
              dommages indirects, accessoires, spéciaux, consécutifs ou punitifs, notamment :
            </p>
            <ul className={ul}>
              <li>La perte de profits, de revenus, de données ou d&apos;usage</li>
              <li>Les blessures corporelles ou dommages matériels</li>
              <li>Les complications de santé ou frais médicaux</li>
              <li>La détresse émotionnelle</li>
              <li>La perte d&apos;occasions d&apos;affaires</li>
              <li>Le coût de services de remplacement</li>
            </ul>
            <p className="mt-4 mb-4">
              Cette limitation s&apos;applique quel que soit le fondement juridique (contrat, responsabilité civile,
              négligence ou autre), même si FitCircle a été informée de la possibilité de tels dommages.
            </p>
            <p className="mb-4">
              EN AUCUN CAS LA RESPONSABILITÉ TOTALE DE FITCIRCLE ENVERS VOUS POUR L&apos;ENSEMBLE DES RÉCLAMATIONS NE
              DÉPASSERA LE PLUS ÉLEVÉ DES MONTANTS SUIVANTS : (A) LE MONTANT QUE VOUS AVEZ PAYÉ À FITCIRCLE AU COURS
              DES 12 MOIS PRÉCÉDANT LA RÉCLAMATION OU (B) 100 $ US.
            </p>
            <p className="mt-4">
              Certains territoires ne permettent pas certaines limitations de responsabilité; ces limitations
              pourraient donc ne pas s&apos;appliquer à vous.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>16. Indemnisation</h2>
            <p className="mb-4">
              Vous acceptez d&apos;indemniser, de défendre et de tenir à couvert FitCircle ainsi que ses dirigeants,
              administrateurs, employés et mandataires contre toute réclamation, responsabilité, perte, tout dommage,
              coût ou frais (y compris des honoraires d&apos;avocat raisonnables) découlant :
            </p>
            <ul className={ul}>
              <li>De votre utilisation du Service</li>
              <li>De votre violation des présentes Conditions</li>
              <li>De votre Contenu utilisateur</li>
              <li>De votre violation des droits d&apos;une autre personne ou entité</li>
              <li>De votre participation à des défis</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className={h2}>17. Résiliation du compte</h2>
            <h3 className={h3}>17.1 Résiliation par vous</h3>
            <p className="mb-4">Vous pouvez résilier votre compte en tout temps dans les paramètres. Après la résiliation :</p>
            <ul className={ul}>
              <li>Vous perdrez l&apos;accès au Service</li>
              <li>Vos données pourront être supprimées (sous réserve des obligations légales de conservation)</li>
              <li>Vous serez retiré de tous les défis et FitCircles actifs</li>
              <li>Aucun remboursement des frais d&apos;abonnement ne sera accordé, sauf si la loi l&apos;exige</li>
            </ul>
            <h3 className={h3}>17.2 Résiliation par FitCircle</h3>
            <p className="mb-4">FitCircle peut suspendre ou résilier votre compte en tout temps, avec ou sans préavis, en cas de :</p>
            <ul className={ul}>
              <li>Violation des présentes Conditions</li>
              <li>Comportement frauduleux ou trompeur</li>
              <li>Conduite préjudiciable envers d&apos;autres utilisateurs</li>
              <li>Non-paiement des frais</li>
              <li>Longues périodes d&apos;inactivité</li>
              <li>Toute autre raison jugée nécessaire pour protéger le Service ou ses utilisateurs</li>
            </ul>
            <p className="mt-4">
              En cas de résiliation pour violation, vous pourriez perdre l&apos;accès aux avantages restants de votre
              abonnement.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>18. Règlement des différends</h2>
            <h3 className={h3}>18.1 Règlement à l&apos;amiable</h3>
            <p className="mb-4">
              En cas de différend avec FitCircle, vous acceptez de nous écrire d&apos;abord à support@fitcircle.ai afin
              de tenter de le régler à l&apos;amiable. Nous agirons de bonne foi pour régler les différends.
            </p>
            <h3 className={h3}>18.2 Convention d&apos;arbitrage</h3>
            <p className="mb-4">
              À défaut de règlement à l&apos;amiable, vous acceptez que tout différend découlant des présentes
              Conditions ou du Service soit réglé par arbitrage exécutoire plutôt que devant les tribunaux, sauf les
              réclamations admissibles à la division des petites créances.
            </p>
            <p className="mb-4">
              L&apos;arbitrage sera mené par un arbitre unique siégeant à Vancouver (Colombie-Britannique), en vertu
              de l&apos;Arbitration Act de la Colombie-Britannique. La décision de l&apos;arbitre sera définitive et
              exécutoire.
            </p>
            <h3 className={h3}>18.3 Renonciation aux recours collectifs</h3>
            <p className="mb-4">
              VOUS ACCEPTEZ QUE LES DIFFÉRENDS SOIENT RÉGLÉS UNIQUEMENT SUR UNE BASE INDIVIDUELLE. Vous renoncez à
              participer à un recours collectif ou à un arbitrage collectif contre FitCircle.
            </p>
            <h3 className={h3}>18.4 Lois impératives sur la protection du consommateur</h3>
            <p className="mb-4">
              Les articles 18.2 et 18.3 s&apos;appliquent uniquement dans la mesure permise par les lois sur la
              protection du consommateur qui vous sont applicables. Si ces lois ne vous permettent pas de consentir
              à l&apos;arbitrage ou de renoncer aux recours collectifs (par exemple les lois sur la protection du
              consommateur du Québec, de l&apos;Ontario et d&apos;autres provinces), ces articles ne
              s&apos;appliquent pas à vous, et rien dans les présentes Conditions ne limite les droits que ces lois
              vous accordent.
            </p>
            {/* Counsel review: Quebec CPA s.11.1, Ontario CPA s.7-8 and other provincial consumer law may limit 18.2/18.3 and 19. */}
          </section>

          <section className="mb-8">
            <h2 className={h2}>19. Droit applicable et compétence</h2>
            <p className="mb-4">
              Les présentes Conditions sont régies par les lois de la province de la Colombie-Britannique et les
              lois fédérales du Canada qui s&apos;y appliquent, sans égard aux règles de conflit de lois.
            </p>
            <p className="mb-4">
              Toute action en justice (autre qu&apos;un arbitrage) doit être intentée devant les tribunaux de la
              Colombie-Britannique siégeant à Vancouver, et vous consentez à la compétence de ces tribunaux.
            </p>
            <p>
              Le présent article ne vous prive pas de la protection des lois impératives de votre lieu de résidence
              ni du droit que ces lois vous accordent d&apos;intenter une action devant les tribunaux de votre région.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>20. Modification des Conditions</h2>
            <p className="mb-4">
              Nous nous réservons le droit de modifier les présentes Conditions en tout temps. En cas de
              modification importante, nous vous en aviserons :
            </p>
            <ul className={ul}>
              <li>En publiant les Conditions mises à jour dans le Service</li>
              <li>En envoyant un courriel à l&apos;adresse associée à votre compte</li>
              <li>En affichant un avis bien visible dans le Service</li>
            </ul>
            <p className="mt-4">
              Votre utilisation continue du Service après la publication des modifications constitue votre
              acceptation des Conditions modifiées. Si vous n&apos;acceptez pas les modifications, vous devez cesser
              d&apos;utiliser le Service et pouvez résilier votre compte.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>21. Divisibilité</h2>
            <p>
              Si une disposition des présentes Conditions est jugée inapplicable ou invalide, elle sera limitée ou
              supprimée dans la mesure minimale nécessaire, et les autres dispositions demeureront pleinement en
              vigueur.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>22. Intégralité de l&apos;entente</h2>
            <p>
              Les présentes Conditions, avec notre Politique de confidentialité et les autres politiques qui y sont
              mentionnées, constituent l&apos;entente intégrale entre vous et FitCircle concernant le Service et
              remplacent toute entente antérieure, écrite ou verbale.
            </p>
          </section>

          <section className="mb-8">
            <h2 className={h2}>23. Coordonnées</h2>
            <p className="mb-4">Pour toute question au sujet des présentes Conditions, écrivez-nous :</p>
            <p className="mt-2">
              <strong>Courriel :</strong>{' '}
              <a href="mailto:support@fitcircle.ai" className="text-primary hover:underline">support@fitcircle.ai</a>
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Nous répondons habituellement dans un délai de 2 à 3 jours ouvrables.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t">
          <p className="text-sm text-muted-foreground text-center">© 2026 Inov8r Labs Inc. Tous droits réservés.</p>
        </div>
      </div>
    </div>
  );
}
