"""
Seed de flashcards de test (local).
Usage : lance le serveur en local, puis  ->  python seed_flashcards.py
Cible http://localhost:8000 par defaut (override : API_URL=...).
Si ADMIN_API_KEY est definie cote serveur, exporte la meme valeur ici.
Aucune dependance externe (urllib stdlib).
"""
import json
import os
import urllib.request
import urllib.error

API = os.getenv("API_URL", "http://localhost:8000")
ADMIN_KEY = os.getenv("ADMIN_API_KEY")

CARDS = [
    # --- Module 1 : Cloud Concepts ---
    {"category": "az-900-module-1", "card_type": "notion",
     "front": "Qu'est-ce qu'un hypervisor ?",
     "back": "Une couche d'abstraction qui decouple le materiel de l'OS et emule un ordinateur complet dans une VM.",
     "analogy": "Un imitateur : chaque OS croit avoir sa propre machine."},
    {"category": "az-900-module-1", "card_type": "notion",
     "front": "Sur quelle technologie Azure repose-t-il pour faire tourner les applications ?",
     "back": "La virtualisation, repetee a l'echelle de datacenters entiers (racks, serveurs, switchs).",
     "analogy": None},
    {"category": "az-900-module-1", "card_type": "notion",
     "front": "Le modele pay-as-you-go, c'est quoi ?",
     "back": "Tu paies a la consommation : aucun cout initial, tu regles les ressources quand tu les utilises, tu arretes quand tu n'en as plus besoin.",
     "analogy": "Comme ta facture d'electricite : pas d'achat de centrale, tu paies les kWh consommes."},
    {"category": "az-900-module-1", "card_type": "notion",
     "front": "Qu'est-ce que l'elasticite ?",
     "back": "Le systeme ajoute et retire des ressources AUTOMATIQUEMENT selon la demande.",
     "analogy": "Piege classique : automatique = elasticite. Le faire a la main = scalabilite."},
    {"category": "az-900-module-1", "card_type": "scenario",
     "front": "Tu cliques \u00ab Creer une VM \u00bb dans le portail. Retrace le chemin de ta requete jusqu'a la machine physique.",
     "back": "Portail -> Azure API -> orchestrator (empaquette la demande) -> fabric controller du rack -> serveur + hypervisor qui cree la VM.",
     "analogy": None},
    {"category": "az-900-module-1", "card_type": "scenario",
     "front": "Ton appli sature chaque soir de 20h a 23h, puis ca retombe. Quel mecanisme ajoute des ressources juste pour ce creneau et coupe la facture apres ?",
     "back": "L'elasticite.",
     "analogy": "Ajout automatique selon la demande, paiement uniquement pendant le pic."},
    # --- Module 2 : Architecture & Compute ---
    {"category": "az-900-module-2", "card_type": "notion",
     "front": "Difference entre scaling horizontal et vertical ?",
     "back": "Horizontal = ajouter des serveurs (scale out). Vertical = renforcer un serveur existant avec plus de CPU/RAM (scale up).",
     "analogy": None},
    {"category": "az-900-module-2", "card_type": "notion",
     "front": "VM vs App Service vs Azure Functions ?",
     "back": "Trois niveaux de \"qui gere quoi\" : la VM, l'app web manage, le code a la demande.",
     "analogy": "VM = serveur entier a toi. App Service = appart loue meuble. Function = distributeur : tu paies au passage."},
    {"category": "az-900-module-2", "card_type": "scenario",
     "front": "Pour tenir la charge, tu ajoutes 5 serveurs identiques qui bossent ensemble comme un seul. Horizontal ou vertical ?",
     "back": "Horizontal (scale out).",
     "analogy": "Vertical = renforcer UNE machine en lui ajoutant CPU ou RAM."},
    {"category": "az-900-module-2", "card_type": "notion",
     "front": "Qu'est-ce que la tolerance de panne (fault tolerance) ?",
     "back": "La redondance integree : si un composant lache, un composant de secours prend le relais, sans impact pour tes clients.",
     "analogy": None},
]


def post(card):
    data = json.dumps(card).encode("utf-8")
    req = urllib.request.Request(API + "/flashcards", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if ADMIN_KEY:
        req.add_header("X-Api-Key", ADMIN_KEY)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


if __name__ == "__main__":
    print(f"Cible : {API}")
    ok = 0
    for c in CARDS:
        try:
            out = post(c)
            ok += 1
            print(f"  OK  #{out['id']:>3}  [{out['category']}]  {out['front'][:50]}")
        except urllib.error.HTTPError as e:
            print(f"  ERREUR {e.code} sur : {c['front'][:50]} -> {e.read().decode(errors='ignore')[:120]}")
        except Exception as e:
            print(f"  ERREUR : {c['front'][:50]} -> {e}")
    print(f"\n{ok}/{len(CARDS)} cartes inserees.")
