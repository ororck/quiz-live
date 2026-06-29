"""
seed_flashcards.py
==================

Peuple la table `flashcards` du mode Revision avec le deck AZ-900 complet,
via l'API (comme seed_db.py pour les questions du quiz). A lancer serveur demarre.

    python seed_flashcards.py                      # cible http://localhost:8000
    BASE_URL=https://quiz-live-test... python seed_flashcards.py

Principes de construction du deck (sources : Wozniak / 20 rules, praticiens Anki) :
  - Un seul fait par carte (minimum information principle). Pas d'enumeration > 4 items.
  - Recto = question precise -> rappel actif. Reponse courte, repondable en quelques secondes.
  - Contenu en anglais (vocabulaire de l'exam). Bloc secondaire francais :
        * notion   -> `analogy`  = analogie de comprehension
        * scenario -> `analogy`  = raisonnement ("Pourquoi"), libelle par le front selon card_type
  - Calibrage par POIDS D'EXAM, pas par longueur des notes :
        architecture 35-40%, governance 30-35%, concepts 25-30%.

Taxonomie (alignee sur l'outline officiel Microsoft, skills measured 14/01/2026) :
  concepts      : cloud-computing | cloud-benefits | service-types
  architecture  : core-components | compute-networking | storage | identity-security
  governance    : cost-management | governance-compliance | resource-management | monitoring
"""

import json
import os
import urllib.request
import urllib.error

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY", "")

# Nom du header d'authent admin : doit etre le MEME que pour POST /bank/questions
# (regle-le ici si seed_db.py utilise un autre nom).
ADMIN_HEADER = "X-Api-Key"


# =============================================================================
#  CONCEPTS  (~28% du deck)
# =============================================================================

CARDS = [

    # ---- concepts / cloud-computing ----------------------------------------
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What is cloud computing, in one sentence?",
        "back": "Delivering computing services (compute, storage, networking) over the internet on a pay-as-you-go basis.",
        "analogy": "Comme l'electricite : tu branches et tu paies ce que tu consommes, sans gerer la centrale.",
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What does the consumption-based (pay-as-you-go) pricing model mean?",
        "back": "You pay only for the resources you use, with no upfront infrastructure cost, and stop paying once you release them.",
        "analogy": "Un compteur d'eau : tu paies les litres ouverts, rien quand le robinet est ferme.",
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "Under the shared responsibility model, what stays the customer's responsibility, whatever the service type?",
        "back": "Data, devices (endpoints), and accounts / identities. These never transfer to the provider.",
        "analogy": "Tes papiers et tes cles : meme dans un logement loue tout equipe, c'est a toi de les garder.",
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "Under the shared responsibility model, what is always the cloud provider's responsibility?",
        "back": "The physical layer: datacenters, physical hosts, and the physical network.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "How does responsibility shift across IaaS, PaaS, and SaaS?",
        "back": "The more managed the service (IaaS -> PaaS -> SaaS), the more the provider handles and the less the customer manages.",
        "analogy": "Location nue -> meublee -> hotel : plus c'est gere, moins tu t'occupes du quotidien.",
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What characterizes the public cloud deployment model?",
        "back": "Resources run on the provider's shared hardware, accessible to many customers, with no local hardware to manage.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What characterizes the private cloud deployment model?",
        "back": "A cloud environment dedicated to a single organization, which keeps full responsibility for buying and maintaining the hardware.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What is a hybrid cloud?",
        "back": "A combination of public and private cloud, letting you run each workload in the most appropriate location.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "scenario",
        "front": "A hospital must keep patient records in its own datacenter for legal reasons, but wants to host its public website in the cloud and scale it on demand. Which deployment model fits?",
        "back": "Hybrid cloud.",
        "analogy": "Le sensible reste en prive (contrainte legale), le public passe en cloud pour la scalabilite : c'est exactement le role de l'hybride.",
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What is cloud-bursting?",
        "back": "Running normally on private/on-premises capacity and temporarily using public cloud resources when demand exceeds your own.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What is serverless computing?",
        "back": "Running code without provisioning or managing any server; the platform allocates resources and scales automatically.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What is the difference between CapEx and OpEx?",
        "back": "CapEx is an upfront spend on physical infrastructure; OpEx is paying for services as you consume them, with no upfront cost.",
        "analogy": "Acheter une voiture (CapEx) versus prendre un VTC a la course (OpEx).",
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "Which expenditure model does the cloud's pay-as-you-go billing represent?",
        "back": "Operational expenditure (OpEx): you pay as you consume, with no upfront investment.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What are economies of scale, as a benefit of the cloud?",
        "back": "Operating at huge scale lets a provider buy and run infrastructure cheaper per unit, and pass those savings to customers.",
        "analogy": None,
    },

    # ---- concepts / cloud-benefits -----------------------------------------
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "What does high availability mean as a cloud benefit?",
        "back": "The system stays functional and accessible a high percentage of the time, minimizing downtime.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "What is the difference between vertical and horizontal scaling?",
        "back": "Vertical scaling adds power to an existing machine (bigger); horizontal scaling adds more machines (more of them).",
        "analogy": "Vertical = un camion plus gros. Horizontal = plus de camions.",
    },
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "What is elasticity in the cloud?",
        "back": "The system automatically adds and removes resources to match current demand, so you only pay for what the load needs.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "What is fault tolerance, as a reliability benefit?",
        "back": "Redundancy is built in so that if one component fails, a backup takes over without impacting the customer.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "What does predictability cover as a cloud benefit?",
        "back": "Both performance predictability (stable, scalable performance) and cost predictability (forecasting spend from per-resource pricing).",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "Why is security and governance a benefit of the cloud?",
        "back": "Providers offer broad built-in security controls and policy tools that most organizations couldn't achieve on their own.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "What does manageability in the cloud refer to?",
        "back": "Less time on infrastructure: the provider handles patching, hardware, and upkeep, and you manage resources via portal, CLI, or templates.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "scenario",
        "front": "A shopping site is overwhelmed every evening at peak hours but idle overnight. You want to add capacity automatically only when traffic rises. Which capability is this?",
        "back": "Elasticity (automatic scaling).",
        "analogy": "Ajout/retrait automatique de ressources selon la demande, en payant seulement les heures de pointe : c'est la definition de l'elasticite.",
    },

    # ---- concepts / service-types ------------------------------------------
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "What is Infrastructure as a Service (IaaS)?",
        "back": "Renting raw infrastructure (VMs, storage, networking) over the internet; it gives the most control to the customer.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "What is Platform as a Service (PaaS)?",
        "back": "A ready environment to build, test, and deploy apps without managing the underlying OS or infrastructure.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "What is Software as a Service (SaaS)?",
        "back": "Ready-to-use software hosted and fully managed by the provider, typically on subscription (e.g. Microsoft 365).",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "Order IaaS, PaaS, and SaaS from most to least customer control.",
        "back": "IaaS (most control) -> PaaS -> SaaS (least control, most abstraction).",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "In IaaS, who manages the operating system?",
        "back": "The customer. In IaaS you are responsible for the OS, data, and applications.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "scenario",
        "front": "A team wants to deploy a web app and database without installing or patching any operating system or web server. Which service type should they choose?",
        "back": "Platform as a Service (PaaS).",
        "analogy": "PaaS fournit l'environnement d'execution sans gestion de l'OS ni du serveur : exactement ce qu'ils demandent.",
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "scenario",
        "front": "A company needs full control over the OS to run custom legacy software with specific hosting configuration. Which service type fits best?",
        "back": "Infrastructure as a Service (IaaS).",
        "analogy": "Controle total sur l'OS et la config = IaaS, le modele qui laisse le plus de maitrise au client.",
    },


    # =========================================================================
    #  ARCHITECTURE  (~38% du deck)
    # =========================================================================

    # ---- architecture / core-components ------------------------------------
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What is an Azure region?",
        "back": "A set of one or more datacenters, nearby and connected by a low-latency network, that you deploy resources into.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What is a region pair?",
        "back": "Each region is paired with another in the same geography, used for replication and automatic failover.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "Roughly how far apart are the two regions in a region pair?",
        "back": "At least about 300 miles (~500 km), to reduce the chance a single disaster hits both.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "How does Azure roll out planned updates across a region pair?",
        "back": "One region at a time, so the paired region keeps running and downtime risk is minimized.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What is an availability zone?",
        "back": "A physically separate datacenter within a region, with independent power, cooling, and networking.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What do availability zones protect a workload against?",
        "back": "The failure of a single datacenter within a region: if one zone goes down, the others keep working.",
        "analogy": "Trois batiments separes sur le campus : un incendie dans l'un n'arrete pas les autres.",
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "scenario",
        "front": "An app must stay available even if one datacenter in its region suffers a power outage, but you don't need cross-region protection. What should you deploy across?",
        "back": "Multiple availability zones within the region.",
        "analogy": "Les zones sont des datacenters physiquement separes dans la meme region : elles couvrent la panne d'un datacenter sans aller jusqu'au multi-region.",
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "Can you choose the specific datacenter your resource is deployed to?",
        "back": "No. You pick a region (and sometimes an availability zone), but not a specific datacenter.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What is an Azure geography?",
        "back": "A market area (often a country) that contains one or more regions and enforces specific data-residency and compliance rules.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What is a sovereign region in Azure?",
        "back": "An isolated instance of Azure for special compliance needs, such as Azure Government or the China regions.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What is an Azure resource group?",
        "back": "A logical container that holds related Azure resources and is the scope for shared lifecycle, RBAC, and tags.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "How many resource groups can a single resource belong to?",
        "back": "Exactly one. Every resource lives in one and only one resource group.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What happens to the resources inside a resource group when you delete it?",
        "back": "They are all deleted with it.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What is an Azure management group?",
        "back": "A container above subscriptions that lets you apply policies and RBAC to many subscriptions at once, inherited downward.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "core-components", "card_type": "notion",
        "front": "What is the Azure governance hierarchy, from top to bottom?",
        "back": "Management groups -> subscriptions -> resource groups -> resources.",
        "analogy": None,
    },

    # ---- architecture / compute-networking ---------------------------------
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "Order the three main compute types from most to least management overhead.",
        "back": "Virtual machines (most) -> containers -> functions/serverless (least).",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is an Azure virtual machine, and which service type is it?",
        "back": "A software-emulated computer with its own OS that you fully control; it is IaaS.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What are Azure Virtual Machine Scale Sets?",
        "back": "A group of identical, load-balanced VMs whose count scales up or down automatically with demand.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is an availability set, and what does it protect against?",
        "back": "A logical grouping of VMs across fault and update domains, protecting an app during hardware failures and planned maintenance within a datacenter.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is a fault domain in an availability set?",
        "back": "A group of VMs sharing the same physical power and network (a server rack), so a rack failure affects only that domain.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is Azure Virtual Desktop?",
        "back": "A service that delivers virtualized Windows desktops and apps from Azure to users' devices.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "How do containers differ from virtual machines?",
        "back": "Containers share the host OS kernel instead of bundling a full guest OS, so they are lighter and start in seconds.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is Azure Kubernetes Service (AKS)?",
        "back": "A managed orchestration service that automates deploying, scaling, and managing large numbers of containers.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is Azure Functions?",
        "back": "A serverless compute service that runs small pieces of code on a trigger, billing only for execution time.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "scenario",
        "front": "You need to run a small piece of code that sends a confirmation email each time an order is placed, paying nothing when idle. Which compute option fits?",
        "back": "Azure Functions (serverless).",
        "analogy": "Code declenche par un evenement, facture seulement a l'execution : c'est le coeur du serverless.",
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What are the three main application hosting options in Azure?",
        "back": "Web apps (App Service), containers, and virtual machines.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is an Azure virtual network (VNet), and what is its scope?",
        "back": "A logically isolated private network in Azure; it is scoped to a single region.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is VNet peering?",
        "back": "Connecting two virtual networks so resources in them can communicate privately as if on one network.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What does a VPN Gateway provide?",
        "back": "A secure connection between an Azure virtual network and an on-premises network over the public internet.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What does Azure ExpressRoute provide?",
        "back": "A private, dedicated, high-bandwidth connection to Azure that does not traverse the public internet.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "scenario",
        "front": "A bank wants a connection to Azure with predictable bandwidth and no traffic over the public internet. Which service should they use?",
        "back": "Azure ExpressRoute.",
        "analogy": "ExpressRoute = lien prive dedie hors internet public ; le VPN Gateway, lui, passe par internet.",
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What does a network security group (NSG) do?",
        "back": "It allows or denies inbound and outbound traffic to Azure resources, acting like a basic cloud firewall.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What is the difference between a public and a private endpoint?",
        "back": "A public endpoint is reachable over the internet; a private endpoint exposes a service only inside your virtual network via a private IP.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "notion",
        "front": "What does Azure DNS provide?",
        "back": "Hosting for DNS domains on Azure infrastructure, mapping friendly names to IP addresses with fast, highly available resolution.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "compute-networking", "card_type": "scenario",
        "front": "A site has copies in several regions, and you want to send each user to the nearest responsive one at the DNS level. Which service do you use?",
        "back": "Azure Traffic Manager.",
        "analogy": "Traffic Manager route au niveau DNS entre regions ; le Load Balancer, lui, repartit le trafic a l'interieur d'une seule region.",
    },

    # ---- architecture / storage --------------------------------------------
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "What is Azure Blob Storage best suited for?",
        "back": "Large amounts of unstructured data such as images, video, backups, and logs.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "What is Azure File Storage, and which protocol does it use?",
        "back": "Fully managed cloud file shares, accessible over the standard SMB protocol and mountable by many machines at once.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "What is Azure Queue Storage used for?",
        "back": "Storing and reliably passing messages between application components so they can scale independently (asynchronous decoupling).",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "What are the three Azure Blob access tiers?",
        "back": "Hot (frequent access), Cool (infrequent, >= 30 days), and Archive (rarely accessed, >= 180 days).",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "scenario",
        "front": "You must store legal records that are almost never read but must be kept for years at the lowest cost. Which blob access tier should you choose?",
        "back": "The Archive tier.",
        "analogy": "Acces tres rare et conservation longue avec latence toleree : c'est exactement le profil du tier Archive.",
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "What does locally redundant storage (LRS) protect against?",
        "back": "Hardware failures within a single datacenter; it keeps multiple copies in one datacenter only.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "What does geo-redundant storage (GRS) add over LRS?",
        "back": "It also replicates the data to the paired region, so it survives a full regional outage.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "scenario",
        "front": "Your critical data sits in a single region, and compliance demands it survive the complete loss of that region. What is the minimum redundancy option?",
        "back": "Geo-redundant storage (GRS).",
        "analogy": "GRS replique vers la region appairee a 300+ miles ; LRS et ZRS restent dans une seule region.",
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "Is data in Azure Storage encrypted at rest by default?",
        "back": "Yes. Storage Service Encryption encrypts data before writing and decrypts on read, transparently to the user.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "Which tool moves large volumes of files to Azure Storage from the command line?",
        "back": "AzCopy.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "What is Azure Data Box used for?",
        "back": "Physically shipping very large datasets to Azure on an appliance when transferring over the network would be too slow.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "storage", "card_type": "notion",
        "front": "What does Azure Migrate help with?",
        "back": "Assessing and migrating on-premises servers, databases, and apps to Azure from a central hub.",
        "analogy": None,
    },

    # ---- architecture / identity-security ----------------------------------
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is Microsoft Entra ID?",
        "back": "Azure's cloud-based identity and access management service (formerly Azure Active Directory).",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is the difference between authentication and authorization?",
        "back": "Authentication (AuthN) verifies who you are; authorization (AuthZ) decides what you are allowed to do.",
        "analogy": "AuthN = montrer sa carte d'identite a l'entree. AuthZ = quelles portes ton badge ouvre une fois entre.",
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is single sign-on (SSO)?",
        "back": "Using one identity and one set of credentials to access many applications.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is multifactor authentication (MFA)?",
        "back": "Requiring two or more independent verification factors to sign in.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What are the three categories of authentication factors?",
        "back": "Something you know, something you have, and something you are.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is passwordless authentication?",
        "back": "Signing in without a password, using factors like a security key, an authenticator app, or biometrics.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What do Conditional Access policies do?",
        "back": "They allow, block, or add requirements (like MFA) at sign-in based on signals such as user, device, location, or risk.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "scenario",
        "front": "You want to force an extra verification step only when a user signs in from an unfamiliar location, not every time. Which Entra feature do you use?",
        "back": "Conditional Access.",
        "analogy": "L'acces conditionnel applique des exigences (comme la MFA) selon le contexte du sign-in, pas de facon systematique.",
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What are external identities (B2B) in Entra ID?",
        "back": "A way to let guest users and external partners access your resources with their own identities.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is Azure role-based access control (RBAC)?",
        "back": "Fine-grained access management that grants identities only the permissions they need, via role assignments at a scope.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "How do RBAC role assignments behave across the resource hierarchy?",
        "back": "They are inherited downward: a role assigned at a higher scope (e.g. subscription) applies to all child scopes.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "scenario",
        "front": "A new hire should be able to read everything in one resource group but change nothing. Which built-in RBAC role do you assign, and at which scope?",
        "back": "The Reader role, assigned at that resource group.",
        "analogy": "RBAC = le minimum de droits necessaires ; Reader donne la lecture seule, et le scope resource group limite la portee.",
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is the Zero Trust security model?",
        "back": "Never trust by default and always verify: every request is authenticated and authorized regardless of network location.",
        "analogy": None,
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is the defense-in-depth model?",
        "back": "Layering multiple independent security controls so that if one layer is breached, the next still protects the assets.",
        "analogy": "Un chateau fort : douves, murailles, herse, gardes. Franchir une couche ne donne pas tout.",
    },
    {
        "category": "architecture", "theme": "identity-security", "card_type": "notion",
        "front": "What is Microsoft Defender for Cloud?",
        "back": "A service that continuously assesses your security posture, gives recommendations, and provides threat protection across Azure and hybrid resources.",
        "analogy": None,
    },


    # =========================================================================
    #  GOVERNANCE  (~34% du deck)
    # =========================================================================

    # ---- governance / cost-management --------------------------------------
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "Name three factors that affect the cost of an Azure resource.",
        "back": "Resource type, region/location, and outbound bandwidth (egress).",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "Which direction of data transfer is generally free in Azure?",
        "back": "Inbound (data into Azure). Outbound transfers are charged based on billing zones.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "What is the Azure pricing calculator?",
        "back": "A free web tool that estimates the cost of services before you deploy them.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "What does Azure Cost Management let you do?",
        "back": "Analyze spending, set budgets, and schedule cost reports for resources you've already deployed.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "What does the Azure TCO calculator compare?",
        "back": "The estimated cost of running workloads on-premises versus in Azure (total cost of ownership).",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "scenario",
        "front": "Before committing to the cloud, management wants a figure comparing the cost of their current on-premises servers against running them in Azure. Which tool gives this?",
        "back": "The Azure TCO (Total Cost of Ownership) calculator.",
        "analogy": "Le TCO calculator est concu pour le comparatif on-premises vs Azure ; le pricing calculator estime seulement des services Azure.",
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "What is the main purpose of tags on Azure resources?",
        "back": "Adding name/value metadata to organize resources and, notably, group and report on costs.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "How do reserved instances reduce cost?",
        "back": "Committing to a one- or three-year term for predictable workloads, saving a large percentage versus pay-as-you-go.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "scenario",
        "front": "A database VM runs 24/7 with stable usage all year. Which approach cuts its cost the most versus pay-as-you-go?",
        "back": "Purchase a reserved instance (1- or 3-year reservation).",
        "analogy": "Charge stable et previsible = cas type des reserved instances, qui echangent un engagement contre une forte remise.",
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "What is right-sizing a virtual machine?",
        "back": "Resizing an under-utilized VM to a smaller, cheaper size that still meets its actual workload.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "If you deallocate (stop) a VM, what do you still pay for?",
        "back": "Its persistent disks (storage). You stop paying for the compute, but the disks remain in your subscription.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "What does Azure Hybrid Benefit let you do?",
        "back": "Reuse existing on-premises Windows Server or SQL Server licenses on Azure to lower VM/database costs.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "notion",
        "front": "What are Azure usage meters?",
        "back": "Per-resource counters that track consumption and generate the usage records used to calculate your bill.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "cost-management", "card_type": "scenario",
        "front": "Dev/test VMs are only used during working hours but run all night. What's the simplest way to cut their cost?",
        "back": "Deallocate (auto-shutdown) them outside working hours.",
        "analogy": "Eteindre hors usage arrete la facturation compute ; on garde juste le cout de stockage des disques.",
    },

    # ---- governance / governance-compliance --------------------------------
    {
        "category": "governance", "theme": "governance-compliance", "card_type": "notion",
        "front": "What is the purpose of Microsoft Purview?",
        "back": "Governing and protecting data across an estate: discovery, classification, and compliance management.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "governance-compliance", "card_type": "notion",
        "front": "What does Azure Policy do?",
        "back": "Enforces rules on resource properties (like allowed types or locations) to keep your environment compliant with standards.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "governance-compliance", "card_type": "notion",
        "front": "Does Azure Policy remove existing non-compliant resources?",
        "back": "No. It can deny new non-compliant resources and flag existing ones, but it does not delete them.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "governance-compliance", "card_type": "notion",
        "front": "What is the key difference between Azure Policy and RBAC?",
        "back": "RBAC controls what actions a user can take; Azure Policy controls what properties a resource may have.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "governance-compliance", "card_type": "scenario",
        "front": "Your company must guarantee that no one can deploy resources outside Europe, regardless of their permissions. Which tool enforces this?",
        "back": "Azure Policy.",
        "analogy": "La contrainte porte sur une propriete de la ressource (sa region), pas sur les droits d'un utilisateur : c'est le terrain d'Azure Policy, pas de RBAC.",
    },
    {
        "category": "governance", "theme": "governance-compliance", "card_type": "notion",
        "front": "What is a policy initiative?",
        "back": "A group of related Azure Policy definitions managed and assigned together toward a single compliance goal.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "governance-compliance", "card_type": "notion",
        "front": "What do resource locks do?",
        "back": "They prevent accidental modification (Read-only) or deletion (Delete) of a resource, even for users with RBAC rights.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "governance-compliance", "card_type": "scenario",
        "front": "A critical production database must never be deleted by accident, even by an administrator. What do you apply?",
        "back": "A Delete resource lock.",
        "analogy": "Le verrou s'applique au-dessus de RBAC : meme un admin doit retirer le lock avant de pouvoir supprimer.",
    },

    # ---- governance / resource-management ----------------------------------
    {
        "category": "governance", "theme": "resource-management", "card_type": "notion",
        "front": "What is the Azure portal?",
        "back": "A browser-based graphical interface to create, manage, and monitor almost any Azure resource.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "notion",
        "front": "What is Azure Cloud Shell?",
        "back": "A browser-based command-line that runs in Azure, offering both Bash and PowerShell with the Azure CLI and tools preinstalled.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "notion",
        "front": "What is the difference between Azure CLI and Azure PowerShell?",
        "back": "Both automate Azure from the command line; Azure CLI uses az commands, while Azure PowerShell uses PowerShell cmdlets.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "notion",
        "front": "What is the purpose of Azure Arc?",
        "back": "Extending Azure management and governance to resources running outside Azure: on-premises and in other clouds.",
        "analogy": "Un seul tableau de bord Azure pour piloter aussi ce qui tourne ailleurs.",
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "scenario",
        "front": "You want to manage on-premises servers and resources in another cloud using the same Azure tools and policies. Which service enables this?",
        "back": "Azure Arc.",
        "analogy": "Arc projette la gouvernance Azure (policies, RBAC) sur des ressources hors Azure ; c'est sa raison d'etre.",
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "notion",
        "front": "What is infrastructure as code (IaC)?",
        "back": "Defining and deploying infrastructure through declarative configuration files instead of manual steps, so it's repeatable and versionable.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "notion",
        "front": "What is Azure Resource Manager (ARM)?",
        "back": "The deployment and management layer of Azure: every request to create or manage resources goes through it.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "notion",
        "front": "What is an ARM template?",
        "back": "A declarative JSON file that defines the resources to deploy, enabling repeatable infrastructure-as-code deployments.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "scenario",
        "front": "A team wants to deploy the exact same set of resources to dev, test, and prod, repeatably and under version control. Which approach should they use?",
        "back": "Infrastructure as code with ARM templates.",
        "analogy": "Un fichier declaratif versionne redeploie un environnement identique a volonte : c'est tout l'interet de l'IaC via ARM templates.",
    },
    {
        "category": "governance", "theme": "resource-management", "card_type": "notion",
        "front": "What is the Azure mobile app for?",
        "back": "Accessing, monitoring, and managing your Azure resources from a phone or tablet.",
        "analogy": None,
    },

    # ---- governance / monitoring -------------------------------------------
    {
        "category": "governance", "theme": "monitoring", "card_type": "notion",
        "front": "What is Azure Monitor?",
        "back": "A service that collects, analyzes, and acts on telemetry (metrics and logs) from cloud and on-premises environments.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "monitoring", "card_type": "notion",
        "front": "What is Log Analytics within Azure Monitor?",
        "back": "The component used to write and run queries against the log data collected by Azure Monitor.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "monitoring", "card_type": "notion",
        "front": "What is the difference between metrics and logs in Azure Monitor?",
        "back": "Metrics are numeric values about performance over time; logs are richer records of events you can query.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "monitoring", "card_type": "notion",
        "front": "What does Application Insights monitor?",
        "back": "The availability, performance, and usage of web applications, helping diagnose issues proactively.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "monitoring", "card_type": "notion",
        "front": "What do Azure Monitor alerts do?",
        "back": "They proactively notify you when a metric or log condition crosses a threshold, so you can react quickly.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "monitoring", "card_type": "notion",
        "front": "What is Azure Service Health?",
        "back": "A personalized view of the health of the Azure services and regions you use, including incidents and planned maintenance.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "monitoring", "card_type": "scenario",
        "front": "You want to be notified about Azure outages and planned maintenance that specifically affect the services and regions you use. Which tool do you use?",
        "back": "Azure Service Health.",
        "analogy": "Service Health est centre sur l'etat d'Azure lui-meme pour TES services ; Azure Monitor surveille TES ressources et applications.",
    },
    {
        "category": "governance", "theme": "monitoring", "card_type": "notion",
        "front": "What five areas does Azure Advisor give recommendations on?",
        "back": "Reliability/high availability, security, performance, operational excellence, and cost.",
        "analogy": None,
    },
    {
        "category": "governance", "theme": "monitoring", "card_type": "scenario",
        "front": "You want free, personalized recommendations to improve the security, performance, and cost of your deployed resources. Which service provides them?",
        "back": "Azure Advisor.",
        "analogy": "Advisor analyse tes ressources deployees et propose des actions concretes sur ces cinq axes, dont le cout et la securite.",
    },


    # =========================================================================
    #  REEQUILIBRAGE CONCEPTS  (scale "par le haut", corpus + outline AZ-900)
    # =========================================================================

    # ---- concepts / cloud-benefits ----
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "What reliability services does a cloud provider typically offer?",
        "back": "Data backup, disaster recovery, and data replication.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "cloud-benefits", "card_type": "notion",
        "front": "What is the difference between scalability and elasticity?",
        "back": "Scalability is the ability to add or remove capacity (manually or automatically); elasticity is doing it automatically in response to demand.",
        "analogy": "Toute elasticite est une scalabilite, mais automatique : l'elasticite est le sous-ensemble qui s'ajuste tout seul.",
    },

    # ---- concepts / service-types ----
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "Name common use cases for IaaS.",
        "back": "Lift-and-shift migration, test/dev environments, and storage, backup, and recovery.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "What is a typical use case for PaaS?",
        "back": "Building, testing, and deploying applications (dev frameworks, analytics/BI) without managing the underlying infrastructure.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "Give examples of SaaS.",
        "back": "Ready-to-use subscription software such as Microsoft 365 and Dynamics CRM Online.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "What are the upfront costs for IaaS, PaaS, and SaaS?",
        "back": "None for all three: IaaS and PaaS are pay-as-you-go, SaaS is a recurring subscription.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "notion",
        "front": "In PaaS, who manages the operating system and infrastructure?",
        "back": "The provider. In PaaS you are responsible only for your applications and data.",
        "analogy": None,
    },
    {
        "category": "concepts", "theme": "service-types", "card_type": "scenario",
        "front": "A company subscribes to a fully hosted email and office suite, maintained entirely by the vendor, accessed through a browser. Which service type is this?",
        "back": "Software as a Service (SaaS).",
        "analogy": "Logiciel pret a l'emploi, heberge et maintenu par le fournisseur, paye a l'abonnement : c'est la definition du SaaS.",
    },

    # ---- concepts / cloud-computing ----
    {
        "category": "concepts", "theme": "cloud-computing", "card_type": "notion",
        "front": "What does 'lift and shift' mean?",
        "back": "Moving an existing application to the cloud with little or no change, instead of migrating everything at once.",
        "analogy": None,
    },
]


# =============================================================================
#  Envoi vers l'API
# =============================================================================

def post_card(card):
    """POST une carte vers /flashcards (protege par cle admin, comme /bank/questions)."""
    data = json.dumps(card).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/flashcards",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            ADMIN_HEADER: ADMIN_API_KEY,
        },
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status


def main():
    if not ADMIN_API_KEY:
        raise SystemExit("ADMIN_API_KEY manquant. Exporte-le avant de lancer le script.")

    # Petit recap de calibrage avant l'envoi (controle visuel rapide).
    by_cat, by_type = {}, {}
    for c in CARDS:
        by_cat[c["category"]] = by_cat.get(c["category"], 0) + 1
        by_type[c["card_type"]] = by_type.get(c["card_type"], 0) + 1
    total = len(CARDS)
    print(f"Deck : {total} cartes")
    for cat, n in by_cat.items():
        print(f"  {cat:13s} {n:3d}  ({round(100*n/total)}%)")
    print(f"  -> notion={by_type.get('notion',0)}  scenario={by_type.get('scenario',0)}\n")

    ok, ko = 0, 0
    for i, card in enumerate(CARDS, 1):
        try:
            post_card(card)
            ok += 1
        except urllib.error.HTTPError as e:
            ko += 1
            print(f"[{i:3d}] HTTP {e.code} sur : {card['front'][:60]}...")
        except urllib.error.URLError as e:
            raise SystemExit(f"Connexion impossible a {BASE_URL} : {e.reason}")
    print(f"\nTermine : {ok} inserees, {ko} en echec.")


if __name__ == "__main__":
    main()
