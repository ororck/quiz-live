"""
seed_exam_blanc.py -- Pipeline docx examens blancs AZ-900 -> PostgreSQL
=======================================================================
Sources : az900-test-a..f.docx (6 fichiers, 50 questions chacun = 300).
Chaque docx = enonces numerotes (Question N) + corrige en fin de doc
(section "Answer Key & Explanations") avec la bonne reponse marquee par
un signe de validation et un paragraphe d'explication.

Insere dans question_bank avec :
  category    = "exam-blanc-a" .. "exam-blanc-f"
  explanation = le paragraphe du corrige (colonne ajoutee au prealable)

IMPORTANT : ce script n'efface RIEN (pas de TRUNCATE). Il fait des INSERT.
Il vise la meme base partagee test+prod (piege 1 du brief) : ce qui est
insere en test est visible en prod. Lancer en connaissance de cause.

Usage :
  python seed_exam_blanc.py --dry-run                # parse + compte, aucune ecriture
  python seed_exam_blanc.py --uploads-dir .          # parse + insert (demande le mot de passe)
"""

import os
import re
import json
import glob
import getpass
import argparse
import zipfile

HOST = "quiz-live-db.postgres.database.azure.com"
DB   = "quizlive"
USER = "quizadmin"

LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']


# --- Lecture brute des paragraphes d'un docx (sans dependance externe) --------

def read_paragraphs(path):
    """Retourne la liste des paragraphes texte d'un .docx, dans l'ordre."""
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8', 'ignore')
    paras = re.findall(r'<w:p[ >].*?</w:p>', xml, re.S)
    out = []
    for p in paras:
        texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, re.S)
        line = ''.join(texts)
        line = line.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
        if line.strip():
            out.append(line.strip())
    return out


# --- Reperage de la lettre marquee comme correcte dans le corrige ------------
# Une ligne de reponse correcte ressemble a :   "<coche>  B. Azure Functions"
# On ne se fie PAS a un emoji precis : on prend la 1re lettre A-F suivie d'un
# point sur une ligne courte precedee d'un caractere non alphanumerique.

CORRECT_LINE = re.compile(r'^[^A-Za-z0-9]*\s*([A-F])\.\s+(.+)$')
# additions multi-reponses sur la meme ligne : "... + D. ..." -> lettre D
EXTRA_LETTER = re.compile(r'\+\s*([A-F])\.')
Q_ENONCE     = re.compile(r'^Question\s+(\d+)\b')
Q_CORRIGE    = re.compile(r'^Q(\d+)\.')
CHOICE_LINE  = re.compile(r'^([A-F])\.\s+(.+)$')


def parse_docx(path, category):
    paras = read_paragraphs(path)

    # 1. Reperer la frontiere enonces / corrige : le paragraphe qui contient
    #    "Answer Key" marque le debut de la section reponses.
    split_idx = None
    for i, line in enumerate(paras):
        if 'answer key' in line.lower():
            split_idx = i
            break
    if split_idx is None:
        raise ValueError(f"{path}: section corrige introuvable")

    enonces_part = paras[:split_idx]
    corrige_part = paras[split_idx:]

    # 2. Parser les enonces : Question N -> texte + choix
    questions = {}
    cur = None
    for line in enonces_part:
        mq = Q_ENONCE.match(line)
        if mq:
            cur = int(mq.group(1))
            questions[cur] = {'text': None, 'choices': []}
            continue
        if cur is None:
            continue
        if line.startswith('Your answer'):
            continue
        mc = CHOICE_LINE.match(line)
        if mc:
            questions[cur]['choices'].append(mc.group(2).strip())
        elif questions[cur]['text'] is None:
            questions[cur]['text'] = line

    # 3. Parser le corrige : QN -> lettre correcte + explication
    answers = {}
    cur = None
    for line in corrige_part:
        mq = Q_CORRIGE.match(line)
        if mq:
            cur = int(mq.group(1))
            answers[cur] = {'correct_letters': None, 'explanation': None}
            continue
        if cur is None:
            continue
        mcorr = CORRECT_LINE.match(line)
        if mcorr and answers[cur]['correct_letters'] is None:
            letters = [mcorr.group(1)]                 # lettre principale (debut de ligne)
            letters += EXTRA_LETTER.findall(line)      # additions "+ X." eventuelles
            # dedoublonne en gardant l'ordre
            answers[cur]['correct_letters'] = list(dict.fromkeys(letters))
            continue
        # premiere ligne de texte apres la reponse = explication
        if answers[cur]['correct_letters'] and answers[cur]['explanation'] is None:
            answers[cur]['explanation'] = line

    # 4. Croiser enonces et corrige -> lignes finales
    out = []
    warnings = []
    for num in sorted(questions):
        q = questions[num]
        a = answers.get(num)
        if not q['text'] or not q['choices']:
            warnings.append(f"{category} Q{num}: enonce ou choix manquant")
            continue
        if not a or not a['correct_letters']:
            warnings.append(f"{category} Q{num}: pas de reponse correcte dans le corrige")
            continue
        idxs = [LETTERS.index(l) for l in a['correct_letters']]
        if any(i >= len(q['choices']) for i in idxs):
            warnings.append(f"{category} Q{num}: reponse {a['correct_letters']} hors des {len(q['choices'])} choix")
            continue
        out.append({
            'text': q['text'],
            'num_choices': len(q['choices']),
            'choices_text': q['choices'],
            'correct_choices': sorted(idxs),
            'time_limit_seconds': None,
            'category': category,
            'explanation': a['explanation'],
        })
    return out, warnings


def collect_files(uploads_dir):
    """Trouve az900-test-a..f, ignore les doublons (fichiers avec __1_ etc.)."""
    found = {}
    for path in glob.glob(os.path.join(uploads_dir, 'az900-test-*.docx')):
        base = os.path.basename(path).lower()
        m = re.search(r'az900-test-([a-f])', base)
        if not m:
            continue
        letter = m.group(1)
        # priorite au nom SANS suffixe de doublon
        if letter in found and '__' in base:
            continue
        if letter in found and '__' not in os.path.basename(found[letter]).lower():
            continue
        found[letter] = path
    return {L: found[L] for L in sorted(found)}


def import_to_postgres(rows, password, dry_run):
    from collections import Counter
    cats = Counter(r['category'] for r in rows)
    print(f"\nTotal : {len(rows)} questions")
    for c in sorted(cats):
        with_expl = sum(1 for r in rows if r['category'] == c and r['explanation'])
        print(f"  {c}: {cats[c]} questions ({with_expl} avec explication)")

    if dry_run:
        print("\n[DRY RUN] Aucune ecriture en base.")
        print("\nExemple de question parsee :")
        ex = rows[0]
        print(f"  text     : {ex['text'][:80]}...")
        print(f"  choices  : {ex['choices_text']}")
        print(f"  correct  : {ex['correct_choices']} -> {ex['choices_text'][ex['correct_choices'][0]]}")
        print(f"  explain  : {(ex['explanation'] or '')[:80]}...")
        print(f"  category : {ex['category']}")
        return

    import psycopg2
    conn = psycopg2.connect(host=HOST, dbname=DB, user=USER, password=password, sslmode="require")
    cur = conn.cursor()
    imported = 0
    for r in rows:
        cur.execute("""
            INSERT INTO question_bank
                (text, num_choices, choices_text, correct_choices, time_limit_seconds, category, explanation)
            VALUES (%s, %s, %s::json, %s::json, %s, %s, %s)
        """, (r['text'], r['num_choices'], json.dumps(r['choices_text']),
              json.dumps(r['correct_choices']), r['time_limit_seconds'],
              r['category'], r['explanation']))
        imported += 1
    conn.commit(); cur.close(); conn.close()
    print(f"\nOK : {imported} questions inserees.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--uploads-dir', default='.')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    files = collect_files(args.uploads_dir)
    if not files:
        print(f"Aucun fichier az900-test-*.docx dans '{args.uploads_dir}'")
        return

    all_rows = []
    all_warnings = []
    for letter, path in files.items():
        category = f"exam-blanc-{letter}"
        rows, warnings = parse_docx(path, category)
        print(f"  {os.path.basename(path)} -> {len(rows)} questions ({category})")
        all_rows.extend(rows)
        all_warnings.extend(warnings)

    if all_warnings:
        print(f"\n{len(all_warnings)} avertissement(s) :")
        for w in all_warnings:
            print(f"  ! {w}")

    if not all_rows:
        print("Rien a inserer.")
        return

    if args.dry_run:
        import_to_postgres(all_rows, None, dry_run=True)
    else:
        password = getpass.getpass(f"\nMot de passe pour {USER}@{HOST} : ")
        import_to_postgres(all_rows, password, dry_run=False)


if __name__ == '__main__':
    main()
