import { Shield, ArrowLeft } from 'lucide-react';
import { type Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Politique de confidentialité | FitCircle',
  description: 'Politique de confidentialité de FitCircle : comment nous recueillons, utilisons et protégeons vos renseignements',
  alternates: { languages: { en: '/privacy' } },
};

// Traduction de la version anglaise 1.3. Mettre à jour en même temps que app/privacy/page.tsx.
const LAST_UPDATED = '6 novembre 2026';
const POLICY_VERSION = '1.3';


function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm text-left text-slate-300 border border-slate-700">
        <thead className="bg-slate-800/70 text-white">
          <tr>
            {head.map((h) => (
              <th key={h} className="p-3 font-semibold border-b border-slate-700">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800 align-top">
              {row.map((cell, j) => (
                <td key={j} className="p-3">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const mail = (
  <a href="mailto:privacy@fitcircle.ai" className="text-cyan-400 hover:underline">privacy@fitcircle.ai</a>
);
const h2 = 'text-2xl font-bold text-white mb-4';
const h3 = 'text-xl font-semibold text-white mb-3 mt-6';
const list = 'text-slate-300 space-y-2 list-disc list-inside';
const p = 'text-slate-300 leading-relaxed';

function Processor({ name, purpose, children }: { name: string; purpose: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/50 p-4 rounded-lg">
      <h4 className="text-lg font-semibold text-white mb-2">
        {name} <span className="text-slate-400 font-normal">({purpose})</span>
      </h4>
      <p className="text-slate-300 text-sm">{children}</p>
    </div>
  );
}

export default function PolitiqueConfidentialitePage() {
  return (
    <div lang="fr" className="min-h-screen bg-canvas bg-hero-glow">
      <div className="max-w-4xl mx-auto p-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à FitCircle
        </Link>

        <div role="note" className="mb-8 rounded-xl border border-amber-400/50 bg-amber-400/10 p-4 text-amber-100">
          <p className="font-semibold">Traduction automatique — en attente de révision humaine</p>
          <p className="text-sm mt-1" lang="en">Machine translation pending human review.</p>
          <p className="text-sm mt-2">
            En cas de divergence, la{' '}
            <Link href="/privacy" className="text-cyan-400 hover:underline" lang="en">version anglaise</Link>{' '}
            fait foi, sauf si la loi applicable en dispose autrement.
          </p>
        </div>

        <div className="mb-12">
          <h1 className="text-5xl font-bold text-white mb-4 flex items-center gap-4">
            <Shield className="h-12 w-12 text-purple-400" />
            Politique de confidentialité
          </h1>
          <p className="text-slate-400 text-lg">Dernière mise à jour : {LAST_UPDATED}</p>
          <p className="text-slate-400 text-sm mt-2">Version {POLICY_VERSION}</p>
          <p className="text-slate-400 text-sm mt-2">
            <Link href="/privacy" className="text-cyan-400 hover:underline" lang="en">English version</Link>
            {' · '}
            <Link href="/consumer-health-privacy" className="text-cyan-400 hover:underline">
              Politique sur les données de santé des consommateurs (en anglais)
            </Link>
            {' · '}
            <Link href="/privacy-choices" className="text-cyan-400 hover:underline">
              Vos choix en matière de confidentialité (en anglais)
            </Link>
          </p>
        </div>

        <div className="prose prose-invert prose-slate max-w-none">
          <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-8 space-y-8">
            <section>
              <h2 className={h2}>1. Introduction et qui nous sommes</h2>
              <p className={p}>
                La présente politique explique comment nous recueillons, utilisons, conservons, communiquons et
                protégeons vos renseignements lorsque vous utilisez le site Web FitCircle et les applications
                mobiles FitCircle pour iOS et Android (ensemble, le « Service »).
              </p>
              <p className={`${p} mt-4`}>
                <strong className="text-white">Responsable du traitement :</strong> Inov8r Labs Inc. (« FitCircle »,
                « nous »), société de la Colombie-Britannique (British Columbia; numéro de société BC1310005) dont le
                siège social est situé au 485 - 6400 Roberts Street, Burnaby (Colombie-Britannique) V5G 4C9, Canada, est
                l&apos;organisation responsable de vos renseignements personnels.
                <br />
                <strong className="text-white">Contact :</strong> {mail}
              </p>
              <p className={`${p} mt-4`}>
                <strong className="text-white">Où le Service est offert.</strong> Les applications mobiles et le
                site Web sont offerts aux États-Unis, au Canada, en Inde et à Singapour.
                Le site Web n&apos;accepte pas de nouvelles inscriptions provenant de l&apos;Union européenne ou de
                l&apos;Espace économique européen; les utilisateurs existants peuvent toujours se connecter, exporter
                leurs données et supprimer leur compte.
              </p>
              <p className={`${p} mt-4`}>
                <strong className="text-white">Âge minimum.</strong> Vous devez avoir 18 ans ou plus pour utiliser
                FitCircle. Nous vérifions votre âge à l&apos;inscription (voir la section 14).
              </p>
            </section>

            <section>
              <h2 className={h2}>2. Renseignements que nous recueillons</h2>
              <h3 className="text-xl font-semibold text-white mb-3">2.1 Renseignements de compte</h3>
              <ul className={list}>
                <li>Adresse courriel (obligatoire pour créer un compte)</li>
                <li>Nom d&apos;affichage, nom d&apos;utilisateur et détails de profil facultatifs (biographie, photo, genre, taille)</li>
                <li>Année ou date de naissance (pour confirmer que vous avez 18 ans ou plus)</li>
                <li>
                  Si vous vous connectez avec Apple ou Google : l&apos;identifiant, le nom et l&apos;adresse courriel
                  que le fournisseur nous transmet. Avec « Se connecter avec Apple », vous pouvez masquer votre
                  adresse courriel.
                </li>
                <li>Préférences de compte (système d&apos;unités, fuseau horaire, notifications)</li>
                <li>Vos choix de consentement (données de santé, IA, analytique, courriels de marketing) et leur date</li>
              </ul>

              <h3 className={h3}>2.2 Données de santé et de condition physique</h3>
              <p className="text-slate-300 mb-2">Selon ce que vous choisissez d&apos;enregistrer ou de connecter :</p>
              <ul className={list}>
                <li>Poids, mensurations et valeurs de composition corporelle</li>
                <li>Nombre de pas, entraînements et autres activités physiques</li>
                <li>Journaux d&apos;aliments, d&apos;eau et de suppléments, y compris calories et macronutriments</li>
                <li>Évaluations de l&apos;humeur et du niveau d&apos;énergie</li>
                <li>Objectifs, séries, participation et progrès dans les défis</li>
              </ul>
              <p className={`${p} mt-4`}>
                Avant que l&apos;application ou le site Web ne vous demande des données de santé, nous vous demandons
                un consentement explicite et distinct pour les traiter, et nous enregistrons ce consentement sur
                notre serveur. Vous pouvez le retirer en tout temps dans Paramètres → Confidentialité (voir la
                section 10).
              </p>

              <h3 className={h3}>2.3 Apple Santé et Health Connect</h3>
              <p className={p}>
                Avec votre permission, l&apos;application iOS lit les pas, les entraînements, le poids et les
                mensurations dans Apple Santé, et peut y écrire les repas, le poids et les mensurations que vous
                enregistrez dans FitCircle. L&apos;application Android peut lire des données semblables dans Health
                Connect. La connexion est facultative et vous pouvez retirer cette permission en tout temps dans
                les réglages de votre appareil. Ces données servent uniquement aux fonctions de santé et de
                condition physique de FitCircle.{' '}
                <strong className="text-white">
                  Elles ne sont jamais utilisées pour la publicité ou le marketing, jamais vendues et jamais
                  communiquées à des courtiers en données.
                </strong>
              </p>

              <h3 className={h3}>2.4 Photos, voix et messages</h3>
              <ul className={list}>
                <li>Photos que vous prenez ou choisissez : repas, rapports de composition corporelle, photos de clavardage</li>
                <li>
                  Saisie vocale : la parole est transcrite par le service de reconnaissance vocale de votre
                  appareil (Apple sur iOS; le fournisseur configuré sur Android). FitCircle reçoit la transcription,
                  pas l&apos;enregistrement audio. Vous pouvez plutôt taper vos repas.
                </li>
                <li>Messages et réactions que vous publiez dans les clavardages FitCircle</li>
                <li>Messages que vous envoyez à l&apos;assistant Fitzy</li>
                <li>
                  <strong className="text-white">Mémoire de Fitzy :</strong> de courts faits que vous partagez avec
                  Fitzy (par exemple un aliment que vous évitez ou un objectif) et que Fitzy conserve pour ne pas
                  avoir à les redemander. Vous pouvez les consulter et les supprimer dans les paramètres de Fitzy.
                </li>
              </ul>

              <h3 className={h3}>2.5 Données techniques et d&apos;utilisation</h3>
              <ul className={list}>
                <li>Adresse IP (sécurité, limitation du débit, registres de consentement, emplacement approximatif pour l&apos;analytique)</li>
                <li>Renseignements sur l&apos;appareil et l&apos;application (modèle, système d&apos;exploitation, version, langue)</li>
                <li>Identifiants d&apos;appareil, y compris un jeton de notification si vous autorisez les notifications</li>
                <li>Identifiants publicitaires, selon les réglages de votre appareil et vos choix de consentement (voir la section 6)</li>
                <li>Données d&apos;utilisation (écrans consultés, fonctions utilisées) et diagnostics de plantage et de performance</li>
                <li>Sur le site Web : type de navigateur et identifiants de témoins (cookies)</li>
                <li>Historique d&apos;achats FitCircle Pro (nous ne recevons jamais les détails de votre carte)</li>
              </ul>
            </section>

            <section>
              <h2 className={h2}>3. Utilisation de vos renseignements et fondements juridiques</h2>
              <p className={p}>
                Le tableau ci-dessous indique chaque finalité, les données utilisées et le fondement juridique
                invoqué. Les renvois aux articles visent le RGPD; si le RGPD ne s&apos;applique pas à vous, lisez la
                dernière colonne comme une simple description des raisons pour lesquelles nous utilisons chaque
                type de données.
              </p>
              <Table
                head={['Finalité', 'Données utilisées', 'Fondement juridique']}
                rows={[
                  [
                    'Fournir le Service : compte, journaux, séries, tendances, FitCircles, clavardage, défis, notifications activées, courriels de service essentiels',
                    'Compte, utilisation, messages, photos',
                    'Exécution de notre contrat avec vous (art. 6(1)(b))',
                  ],
                  [
                    'Traiter vos données de santé pour afficher vos progrès et les statistiques de vos cercles',
                    'Données de santé (sections 2.2, 2.3)',
                    'Votre consentement explicite (art. 9(2)(a)), donné séparément et enregistré sur notre serveur',
                  ],
                  [
                    'Fonctions d’IA : estimations nutritionnelles, lecture des rapports de composition corporelle, réponses et objectif quotidien de Fitzy, mesure de la précision de l’IA',
                    'Voir la section 4',
                    'Votre consentement (art. 6(1)(a) et, pour les données de santé, art. 9(2)(a))',
                  ],
                  [
                    'Publicités dans les applications gratuites et mesure de nos propres campagnes',
                    'Identifiants publicitaires et d’appareil, événements limités (section 6)',
                    'Votre consentement lorsque la loi l’exige; ailleurs, intérêts légitimes avec droit de refus',
                  ],
                  [
                    'Analytique de produit et diagnostics',
                    'Données d’utilisation et d’appareil; jamais de valeurs de santé',
                    'Intérêts légitimes (art. 6(1)(f)); consentement sur le site Web (témoins)',
                  ],
                  [
                    'Sécurité, prévention des abus et de la fraude, application de nos Conditions',
                    'Compte, adresse IP, appareil, contenu signalé',
                    'Intérêts légitimes à protéger le Service et ses utilisateurs',
                  ],
                  ['Conserver les registres d’achats et fiscaux', 'Historique d’achats', 'Obligation légale (art. 6(1)(c))'],
                  [
                    'Courriels de marketing',
                    'Adresse courriel, nom',
                    'Votre consentement ou, pour les clients existants, le consentement implicite lorsque la loi le permet. Chaque courriel de marketing contient un lien de désabonnement.',
                  ],
                  [
                    'Conserver la preuve de vos consentements',
                    'Registres de consentement (type, version, date, adresse IP, plateforme)',
                    'Obligation légale et intérêts légitimes à démontrer la conformité',
                  ],
                ]}
              />
            </section>

            <section>
              <h2 className={h2}>4. Fonctions d&apos;intelligence artificielle</h2>
              <p className={p}>
                Certaines fonctions utilisent des modèles d&apos;IA exploités par des tiers.{' '}
                <strong className="text-white">
                  Nous envoyons des données aux fournisseurs d&apos;IA seulement après que vous avez autorisé le
                  traitement par l&apos;IA dans l&apos;application ou sur le site Web. Votre choix est enregistré sur
                  notre serveur, qui le vérifie avant chaque requête d&apos;IA.
                </strong>{' '}
                Une fois l&apos;autorisation donnée, nous envoyons ce qui suit aux modèles d&apos;
                <strong className="text-white">Anthropic</strong> et de{' '}
                <strong className="text-white">Google</strong> (Gemini), par l&apos;entremise de la passerelle IA de
                Vercel :
              </p>
              <ul className={`${list} mt-4`}>
                <li>Photos de repas et toute note ajoutée, pour estimer les calories et macronutriments</li>
                <li>Le texte de votre saisie vocale, pour en faire une entrée alimentaire</li>
                <li>Photos de rapports de composition corporelle, pour en lire les valeurs</li>
                <li>
                  Vos messages à Fitzy, avec un résumé de vos entraînements récents, de la tendance de votre poids,
                  de vos mensurations, de vos journaux alimentaires et de la mémoire de Fitzy
                </li>
              </ul>
              <p className={`${p} mt-4`}>
                Nous n&apos;incluons ni votre nom ni votre adresse courriel. Un identifiant de compte aléatoire est
                joint pour appliquer les limites d&apos;utilisation et prévenir les abus.
              </p>
              <p className={`${p} mt-4`}>
                <strong className="text-white">Mesure de la précision de l&apos;IA.</strong> Nous conservons
                l&apos;estimation de l&apos;IA et les corrections que vous y apportez, tant que votre compte est actif, afin de mesurer
                et d&apos;améliorer la précision. Les photos ne sont pas conservées à cette fin. Cela se produit
                seulement si vous avez autorisé le traitement par l&apos;IA.
              </p>
              <p className={`${p} mt-4`}>
                <strong className="text-white">Conservation par les fournisseurs.</strong> Chaque requête d&apos;IA
                passe par Vercel AI Gateway avec la conservation zéro des données activée : elle n&apos;est acheminée
                que vers des points de terminaison qui ne conservent pas votre contenu et ne l&apos;utilisent pas pour
                entraîner leurs modèles. Les modèles de Google fonctionnent sur Google Cloud Vertex AI.
              </p>
              <p className={`${p} mt-4`}>
                Vous pouvez retirer cette autorisation en tout temps dans Paramètres → Confidentialité (site Web)
                ou Paramètres → Partage de données avec l&apos;IA (applications). Les résultats de l&apos;IA sont des
                estimations et ne constituent pas un avis médical ou diététique.
              </p>
            </section>

            <section>
              <h2 className={h2}>5. Ce que les autres utilisateurs peuvent voir</h2>
              <p className={p}>
                Les membres des FitCircles auxquels vous participez peuvent voir votre nom d&apos;affichage, votre nom
                d&apos;utilisateur, votre photo de profil, vos présences, votre série, vos progrès dans les défis et
                vos messages. Les repas que vous enregistrez sont privés par défaut. Vous pouvez choisir de
                partager un repas, ou activer « Partager mes nouveaux repas avec mes cercles », et modifier ce que voit
                chaque FitCircle, dans l&apos;application.
                Les personnes hors de vos FitCircles ne peuvent pas voir vos journaux.
              </p>
            </section>

            <section>
              <h2 className={h2}>6. Publicité et suivi</h2>
              <p className={p}>
                Les publicités de la version gratuite des applications mobiles sont diffusées par Google AdMob.
                FitCircle Pro les supprime. Le site Web n&apos;affiche aucune publicité.
              </p>
              <ul className={`${list} mt-4`}>
                <li>
                  Sur iOS, l&apos;application demande votre permission avant tout suivi (App Tracking Transparency).
                  Vous pouvez modifier ce choix dans Réglages → Confidentialité et sécurité → Suivi.
                </li>
                <li>
                  Sur Android, vous pouvez réinitialiser ou supprimer votre identifiant publicitaire dans les
                  réglages et revoir vos choix dans « Confidentialité et choix publicitaires » de FitCircle.
                </li>
                <li>
                  Partout où la loi l&apos;exige, l&apos;application demande votre consentement
                  publicitaire avant toute demande d&apos;annonce.
                </li>
                <li>
                  <strong className="text-white">Mesure de nos propres annonces.</strong> Nous utilisons Google
                  (Firebase Analytics et Google Ads), Apple Search Ads et, sur iOS seulement, Meta pour savoir quelles
                  annonces mènent à des installations et des abonnements. Ces partenaires peuvent recevoir
                  l&apos;identifiant publicitaire, des renseignements sur l&apos;appareil, votre adresse IP et un petit
                  ensemble d&apos;événements (ouverture, inscription, membre actif, création ou adhésion à un
                  FitCircle, essai gratuit, achats).
                </li>
                <li>
                  La mesure Meta ne fonctionne que sur iOS, et seulement si vous autorisez le suivi.
                </li>
                <li>
                  <strong className="text-white">
                    Nous n&apos;utilisons ni ne communiquons jamais vos données de santé, journaux alimentaires,
                    photos ou messages à des fins publicitaires.
                  </strong>{' '}
                  Nous ne vendons pas vos renseignements personnels.
                </li>
              </ul>
            </section>

            <section>
              <h2 className={h2}>7. Avec qui nous communiquons des renseignements</h2>
              <p className="text-slate-300 mb-4">
                Nous ne communiquons des renseignements qu&apos;aux fournisseurs ci-dessous, chacun pour la finalité
                indiquée et en vertu d&apos;un contrat qui limite leur utilisation, ainsi qu&apos;aux autres
                utilisateurs comme décrit à la section 5. Nous n&apos;utilisons ni OpenAI ni PostHog.
              </p>
              <div className="space-y-4">
                <Processor name="Supabase" purpose="base de données, authentification, stockage">
                  Héberge votre compte, vos journaux, photos et messages sur Amazon Web Services, région us-east-2
                  (Ohio, États-Unis).
                </Processor>
                <Processor name="Vercel" purpose="hébergement et passerelle IA">
                  Héberge notre application aux États-Unis et achemine les requêtes d&apos;IA vers Anthropic et Google.
                </Processor>
                <Processor name="Anthropic" purpose="modèles d’IA">
                  Traite le contenu décrit à la section 4, seulement si vous avez autorisé l&apos;IA.
                </Processor>
                <Processor name="Google" purpose="modèles d’IA, publicité, mesure publicitaire, connexion, achats, notifications, voix">
                  Gemini (seulement si vous avez autorisé l&apos;IA), AdMob, Firebase Analytics, Google Ads, Google
                  Sign-In, Firebase Cloud Messaging, Google Play et, le cas échéant, la reconnaissance vocale Android.
                </Processor>
                <Processor name="Apple" purpose="connexion, achats, notifications, voix, mesure publicitaire">
                  Se connecter avec Apple, achats App Store, notifications iOS, transcription vocale et Apple Search Ads.
                </Processor>
                <Processor name="Meta" purpose="mesure publicitaire, iOS seulement">
                  Seulement sur iOS, et seulement si vous autorisez le suivi. Ne reçoit jamais de
                  données de santé, d&apos;alimentation ou de condition physique.
                </Processor>
                <Processor name="RevenueCat" purpose="gestion des abonnements">
                  Valide les achats FitCircle Pro. Reçoit un identifiant de compte et les registres d&apos;achats.
                </Processor>
                <Processor name="Stripe" purpose="paiements sur le site Web">
                  Traite les achats faits sur notre site Web. Nous ne recevons jamais les détails complets de votre carte.
                </Processor>
                <Processor name="Amplitude" purpose="analytique de produit">
                  Enregistre les fonctions utilisées. Ne reçoit jamais de valeurs de santé. Sur le site Web, actif
                  seulement si vous consentez aux témoins d&apos;analytique.
                </Processor>
                <Processor name="Sentry" purpose="rapports d’erreurs">
                  Reçoit les rapports de plantage et diagnostics. Les données d&apos;erreur expirent après 90 jours.
                </Processor>
                <Processor name="Resend" purpose="envoi de courriels">
                  Envoie les courriels de compte, de service et de marketing. Reçoit votre adresse courriel, votre
                  nom et le contenu du courriel.
                </Processor>
              </div>
              <p className={`${p} mt-6`}>
                Nous pouvons aussi communiquer des renseignements lorsque la loi l&apos;exige, ou pour protéger les
                droits et la sécurité de nos utilisateurs et du Service.
              </p>
            </section>

            <section>
              <h2 className={h2}>8. Transferts internationaux</h2>
              <p className={p}>
                Nous sommes établis au Canada. La plupart de nos fournisseurs traitent les données aux États-Unis :
                notre base de données est hébergée par Supabase sur Amazon Web Services (us-east-2, Ohio), notre
                application par Vercel, et nos autres fournisseurs (Anthropic, Google, Amplitude, Sentry, RevenueCat,
                Stripe et Resend) sont énumérés à la section 7. Vos renseignements sont donc transférés du Canada vers
                les États-Unis et y sont conservés, où ils peuvent être accessibles aux tribunaux et aux autorités en
                vertu des lois américaines.
              </p>
              <ul className={`${list} mt-4`}>
                <li>
                  <strong className="text-white">Canada et Québec :</strong> nous demeurons responsables des
                  renseignements transférés à des fournisseurs hors du Canada et les protégeons par des ententes
                  écrites. Avant de communiquer des renseignements à l&apos;extérieur du Québec, nous évaluons aussi
                  leur sensibilité, la finalité et les mesures de protection.
                </li>
                <li>
                  <strong className="text-white">Inde et Singapour :</strong> nous ne transférons des données
                  qu&apos;à des fournisseurs liés par des contrats exigeant une protection comparable à la loi locale.
                </li>
              </ul>
            </section>

            <section>
              <h2 className={h2}>9. Témoins (site Web)</h2>
              <ul className={list}>
                <li><code className="text-cyan-400">sb-access-token</code>, <code className="text-cyan-400">sb-refresh-token</code> — authentification (essentiels)</li>
                <li><code className="text-cyan-400">fc_consent</code> — vos préférences de témoins (essentiel)</li>
                <li><code className="text-cyan-400">amplitude_*</code> — analytique et relecture de session (avec consentement)</li>
              </ul>
              <p className="text-slate-400 text-sm mt-4">
                Nous respectons le signal Global Privacy Control (GPC). Gérez vos préférences dans vos{' '}
                <Link href="/settings/privacy" className="text-cyan-400 hover:underline">paramètres de confidentialité</Link>.
              </p>
            </section>

            <section>
              <h2 className={h2}>10. Vos choix et vos droits</h2>
              <h3 className="text-xl font-semibold text-white mb-3">10.1 Comment exercer vos droits</h3>
              <ul className={list}>
                <li>
                  <strong className="text-white">Exporter vos données :</strong> dans les applications (Profil →
                  Paramètres → Exporter les données) ou sur le site Web (Paramètres → Confidentialité).
                  L&apos;exportation est gratuite pour tous et comprend toutes vos données, y compris vos photos au
                  moyen de liens de téléchargement temporaires.
                </li>
                <li>
                  <strong className="text-white">Supprimer votre compte :</strong> dans les applications, sur le
                  site Web, ou voir{' '}
                  <Link href="/privacy/delete-account" className="text-cyan-400 hover:underline">comment supprimer votre compte</Link>{' '}
                  (en anglais).
                </li>
                <li>
                  <strong className="text-white">Consentements santé et IA :</strong> Paramètres → Confidentialité.
                </li>
                <li><strong className="text-white">Mémoire de Fitzy :</strong> paramètres de Fitzy.</li>
                <li><strong className="text-white">Courriels de marketing :</strong> lien de désabonnement dans chaque courriel.</li>
                <li>
                  <strong className="text-white">Publicité :</strong>{' '}
                  <Link href="/privacy-choices" className="text-cyan-400 hover:underline">Vos choix en matière de confidentialité</Link>.
                </li>
                <li><strong className="text-white">Toute autre demande :</strong> écrivez à {mail}.</li>
              </ul>
              <p className={`${p} mt-4`}>
                <strong className="text-white">Délais de réponse :</strong> 45 jours pour les demandes relatives aux données de santé
                des consommateurs de l&apos;État de Washington et 30 jours ailleurs, sauf si la loi locale prévoit
                plus long.
              </p>

              <h3 className={h3}>10.2 Droits en vertu des lois des États américains</h3>
              <p className="text-slate-300">
                Selon votre État, vous pouvez avoir le droit de savoir quels renseignements nous recueillons, d&apos;y
                accéder, de les corriger, de les supprimer, d&apos;en obtenir une copie portable et de refuser leur
                « vente », leur « partage » ou la publicité ciblée. Nous ne vendons pas de renseignements personnels.
                Vous pouvez faire appel d&apos;un refus à {mail}, puis communiquer avec le procureur général de votre
                État. Les résidents de Washington et du Nevada peuvent consulter notre{' '}
                <Link href="/consumer-health-privacy" className="text-cyan-400 hover:underline">
                  politique sur les données de santé des consommateurs
                </Link>.
              </p>

              <h3 className={h3}>10.3 Canada (y compris la Colombie-Britannique et le Québec)</h3>
              <p className="text-slate-300">
                En tant que société de la Colombie-Britannique, nous respectons la Loi sur la protection des
                renseignements personnels et les documents électroniques (LPRPDE) et la Personal Information
                Protection Act (PIPA) de la Colombie-Britannique. Les résidents du Québec sont aussi protégés par la
                Loi 25. Vous pouvez accéder à vos renseignements et les faire rectifier, retirer votre consentement,
                obtenir vos renseignements dans un format technologique structuré et couramment utilisé, et vous
                informer sur leur utilisation, leur communication et leur transfert hors du Canada. Vous pouvez
                déposer une plainte auprès du Commissariat à la protection de la vie privée du Canada (priv.gc.ca),
                du Commissariat à l&apos;information et à la protection de la vie privée de la Colombie-Britannique
                (Office of the Information and Privacy Commissioner for British Columbia, oipc.bc.ca) ou, au Québec,
                de la Commission d&apos;accès à l&apos;information du Québec (cai.gouv.qc.ca).
              </p>
              <p className="text-slate-300 mt-2">
                <strong className="text-white">Personne responsable de la protection des renseignements personnels
                (Québec) :</strong> Aniruddh Bajirao, directeur et cofondateur, {mail}
              </p>

              <h3 className={h3}>10.4 Inde</h3>
              <p className="text-slate-300">
                En vertu de l&apos;Information Technology Act, 2000 et des règles SPDI de 2011, nous recueillons les
                renseignements personnels sensibles (y compris les données de santé) uniquement avec votre
                consentement, et vous pouvez les consulter, les corriger et retirer votre consentement. À mesure que
                le Digital Personal Data Protection Act, 2023 et ses règles entrent en vigueur, vous bénéficierez
                aussi des droits qu&apos;il accorde.
              </p>
              <p className="text-slate-300 mt-2">
                <strong className="text-white">Agent de règlement des griefs (Grievance Officer) :</strong>{' '}
                Aniruddh Bajirao, directeur et cofondateur, Inov8r Labs Inc., {mail}. Nous réglerons votre
                grief dans un délai d&apos;un mois.
              </p>

              <h3 className={h3}>10.5 Singapour</h3>
              <p className="text-slate-300">
                En vertu du Personal Data Protection Act 2012, vous pouvez demander l&apos;accès à vos données et leur
                correction, et retirer votre consentement. Vous pouvez déposer une plainte auprès de la Personal
                Data Protection Commission (pdpc.gov.sg).
              </p>
              <p className="text-slate-300 mt-2">
                <strong className="text-white">Délégué à la protection des données :</strong>{' '}
                Aniruddh Bajirao, directeur et cofondateur, {mail}
              </p>
            </section>

            <section>
              <h2 className={h2}>11. Conservation des données</h2>
              <p className={p}>
                Nous conservons les données seulement le temps nécessaire aux fins décrites ci-dessus.
              </p>
              <Table
                head={['Données', 'Durée de conservation']}
                rows={[
                  ['Votre compte et votre contenu (profil, journaux, repas, photos, messages avec Fitzy, mémoire de Fitzy, échantillons de précision de l’IA)', 'Tant que votre compte est actif. Supprimés dans les 30 jours suivant la suppression de votre compte. Vous pouvez aussi supprimer des entrées et la mémoire de Fitzy en tout temps.'],
                  ['Comptes inactifs', 'Après 3 ans sans utilisation de FitCircle, nous supprimons votre compte après un préavis de 30 jours par courriel.'],
                  ['Messages de clavardage FitCircle', 'Tant que le FitCircle existe, ou jusqu’à la suppression de votre compte'],
                  ['Adresses IP dans les registres de sécurité et de consentement', 'Jusqu’à 3 ans'],
                  ['Registres de consentement (preuve)', 'Durée de vie du compte plus 6 ans'],
                  ['Registres d’achats et fiscaux', 'Selon la loi (généralement 7 ans)'],
                  ['Sauvegardes de la base de données', 'Jusqu’à 30 jours'],
                  ['Données d’erreur', 'Jusqu’à 90 jours'],
                  ['Statistiques agrégées et dépersonnalisées', 'Peuvent être conservées indéfiniment'],
                ]}
              />
              <h3 className={h3}>11.1 Lorsque vous supprimez votre compte</h3>
              <p className={p}>
                Nous supprimons votre compte, vos journaux, photos et messages dans un délai de 30 jours; ils
                disparaissent de nos sauvegardes à l&apos;expiration de la période ci-dessus. Nous demandons aussi à
                nos fournisseurs de supprimer vos données : demande de suppression à Amplitude et RevenueCat,
                suppression de votre fiche client Stripe (Stripe conserve les factures exigées par la loi fiscale) et
                retrait de vos coordonnées chez Resend. Les données Sentry expirent dans un délai de 90 jours. Nous
                conservons des affectations d&apos;expériences dépersonnalisées et les registres exigés par la loi.
              </p>
              <p className={`${p} mt-4`}>
                La suppression de votre compte n&apos;annule pas un abonnement acheté sur l&apos;App Store ou Google
                Play; gérez-le dans les réglages de votre compte de la boutique.
              </p>
            </section>

            <section>
              <h2 className={h2}>12. Sécurité des données</h2>
              <ul className={list}>
                <li>Chiffrement des données en transit (HTTPS/TLS) et au repos</li>
                <li>Politiques de sécurité au niveau des lignes (RLS) dans la base de données</li>
                <li>Mises à jour de sécurité régulières et accès limité du personnel</li>
              </ul>
              <p className={`${p} mt-4`}>
                En cas d&apos;incident de confidentialité touchant vos renseignements, nous vous aviserons, ainsi que
                les autorités compétentes, comme l&apos;exige la loi.
              </p>
            </section>

            <section>
              <h2 className={h2}>13. Communications de marketing</h2>
              <p className={p}>
                Nous envoyons des courriels de marketing seulement avec votre consentement ou lorsque la loi le
                permet pour les clients existants. Chaque courriel de marketing comprend notre adresse postale et un
                lien de désabonnement.
              </p>
            </section>

            <section>
              <h2 className={h2}>14. Âge minimum</h2>
              <p className={p}>
                FitCircle est réservé aux personnes de 18 ans ou plus, et nous le vérifions à l&apos;inscription. Si
                nous apprenons qu&apos;un compte appartient à une personne de moins de 18 ans, nous le fermerons et
                supprimerons ses données.
              </p>
            </section>

            <section>
              <h2 className={h2}>15. Modifications</h2>
              <p className={p}>
                Nous pouvons mettre à jour la présente politique. Nous vous redemanderons votre consentement si une
                modification touche un élément auquel vous avez consenti, et nous vous aviserons par courriel, par
                la bannière de témoins ou dans l&apos;application.
              </p>
            </section>

            <section>
              <h2 className={h2}>16. Nous joindre</h2>
              <div className="bg-slate-800/50 p-4 rounded-lg space-y-2 text-white">
                <p>
                  <strong>Responsable :</strong> Inov8r Labs Inc. (numéro de société BC1310005),{' '}
                  485 - 6400 Roberts Street, Burnaby (Colombie-Britannique) V5G 4C9, Canada
                </p>
                <p><strong>Courriel :</strong> {mail}</p>
                <p><strong>Agent de règlement des griefs (Inde) :</strong> Aniruddh Bajirao, directeur et cofondateur, {mail}</p>
                <p>
                  <strong>Personne responsable de la protection des renseignements personnels (Québec) :</strong>{' '}
                  Aniruddh Bajirao, directeur et cofondateur, {mail}
                </p>
                <p><strong>Délégué à la protection des données (Singapour) :</strong> Aniruddh Bajirao, directeur et cofondateur, {mail}</p>
              </div>
              <h3 className={h3}>Plaintes</h3>
              <p className={p}>
                Communiquez d&apos;abord avec nous. Vous pouvez aussi vous adresser au Commissariat à la
                protection de la vie privée du Canada, au Commissariat à l&apos;information et à la protection de la
                vie privée de la Colombie-Britannique, à la Commission d&apos;accès à l&apos;information du Québec, à
                la Personal Data Protection Commission
                (Singapour), au Data Protection Board of India, ou au procureur général de votre État (États-Unis).
              </p>
            </section>

            <section className="border-t border-slate-700 pt-8">
              <h2 className={h2}>17. Retrait du consentement</h2>
              <p className={p}>
                Vous pouvez retirer tout consentement en tout temps, sans incidence sur la licéité du traitement
                effectué avant ce retrait, au moyen des paramètres décrits à la section 10.1 ou de vos{' '}
                <Link href="/settings/privacy" className="text-cyan-400 hover:underline">paramètres de confidentialité</Link>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
