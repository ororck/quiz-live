"""
seed_db.py — Pipeline docx -> PostgreSQL
=========================================
Lit tous les fichiers .docx dans le dossier `docs/` (configurable),
parse les questions avec leurs bonnes réponses (surlignage vert > jaune),
parse aussi le README.md si présent, et importe tout dans Postgres.

Convention de surlignage dans les docx :
  - Vert  = correction (prioritaire)
  - Jaune = réponse initiale

Nommage des fichiers -> catégorie automatique :
  module-01-questions-*.docx  -> az-900-module-1-mcq
  module-01-scenarios-*.docx  -> az-900-module-1-scenario
  module-02-questions-*.docx  -> az-900-module-2-mcq
  etc.
  README.md                   -> az-900

Usage:
  python seed_db.py
  python seed_db.py --docs-dir /chemin/vers/docx --dry-run
"""

import os
import re
import json
import glob
import getpass
import argparse
import psycopg2
from docx import Document
from docx.oxml.ns import qn

# ─── Config ────────────────────────────────────────────────────────────────────
HOST     = "quiz-live-db.postgres.database.azure.com"
DB       = "quizlive"
USER     = "quizadmin"
DOCS_DIR = "docs"   # dossier contenant les .docx et éventuellement README.md
LETTERS  = ['A', 'B', 'C', 'D', 'E', 'F']


# ─── Helpers docx ──────────────────────────────────────────────────────────────

def get_highlight(paragraph):
    """Retourne 'green', 'yellow', ou None pour un paragraphe."""
    colors = set()
    for run in paragraph.runs:
        rpr = run._element.find(qn('w:rPr'))
        if rpr is not None:
            hl = rpr.find(qn('w:highlight'))
            if hl is not None:
                val = hl.get(qn('w:val'))
                if val not in (None, 'none'):
                    colors.add(val)
    if 'green' in colors:
        return 'green'
    if 'yellow' in colors:
        return 'yellow'
    return None


def category_from_filename(filename):
    """
    module-01-questions-*.docx  -> az-900-module-1-mcq
    module-01-scenarios-*.docx  -> az-900-module-1-scenario
    module-02-questions-*.docx  -> az-900-module-2-mcq
    Tout autre .docx             -> az-900
    """
    name = os.path.basename(filename).lower()
    m = re.search(r'module-0?(\d+)-(questions|scenarios)', name)
    if m:
        num  = m.group(1)
        kind = 'mcq' if 'questions' in m.group(2) else 'scenario'
        return f"az-900-module-{num}-{kind}"
    return 'az-900'


def parse_docx(filepath):
    """Parse un docx corrigé et retourne une liste de questions."""
    category = category_from_filename(filepath)
    doc      = Document(filepath)
    questions = []

    current_label    = None
    current_text     = None
    choices          = []          # [(letter, text)]
    correct_by_color = {'green': [], 'yellow': []}

    def flush():
        if current_text is None:
            return
        correct_letters = (
            correct_by_color['green']
            if correct_by_color['green']
            else correct_by_color['yellow']
        )
        correct_indices = [LETTERS.index(l) for l in correct_letters if l in LETTERS]
        questions.append({
            "text":               current_text,
            "num_choices":        len(choices),
            "choices_text":       [c[1] for c in choices],
            "correct_choices":    correct_indices,
            "time_limit_seconds": None,
            "category":           category,
        })

    for p in doc.paragraphs:
        t       = p.text.strip()
        stripped = t.lstrip()

        # Nouvelle question
        if re.match(r'Question\s+\d+', t):
            flush()
            current_label    = t
            current_text     = None
            choices          = []
            correct_by_color = {'green': [], 'yellow': []}
            continue

        if current_label is None:
            continue

        # Option A. B. C. ...
        is_option = (
            len(stripped) >= 2
            and stripped[0] in LETTERS
            and stripped[1] == '.'
        )
        if is_option:
            letter      = stripped[0]
            option_text = stripped[2:].strip()
            choices.append((letter, option_text))
            hl = get_highlight(p)
            if hl in ('green', 'yellow'):
                correct_by_color[hl].append(letter)

        elif (
            t
            and current_text is None
            and not t.startswith('Your answer')
            and not any(t.startswith(x) for x in ['©', 'End of', '📋', '①', '✑'])
        ):
            current_text = t

    flush()
    return questions


# ─── Parser README.md ──────────────────────────────────────────────────────────

def parse_readme(filepath):
    """Parse le README.md avec la convention - [x] / - [ ]."""
    with open(filepath, encoding='utf-8') as f:
        content = f.read()

    questions = []
    blocks = re.split(r'\n### ', content)

    for block in blocks[1:]:
        lines        = block.strip().split('\n')
        q_text       = lines[0].strip()
        choices_text = []
        correct_idx  = []

        for line in lines[1:]:
            m = re.match(r'-\s+\[(x| )\]\s+(.*)', line.strip())
            if m:
                is_correct = m.group(1) == 'x'
                idx        = len(choices_text)
                choices_text.append(m.group(2).strip())
                if is_correct:
                    correct_idx.append(idx)

        if choices_text and correct_idx:
            questions.append({
                "text":               q_text,
                "num_choices":        len(choices_text),
                "choices_text":       choices_text,
                "correct_choices":    correct_idx,
                "time_limit_seconds": None,
                "category":           "az-900",
            })

    return questions


# ─── Import Postgres ────────────────────────────────────────────────────────────

def import_to_postgres(questions, password, dry_run=False):
    if dry_run:
        print(f"[DRY RUN] {len(questions)} questions prêtes, aucune écriture en base.")
        cats = {}
        for q in questions:
            cats[q['category']] = cats.get(q['category'], 0) + 1
        for cat, n in sorted(cats.items()):
            print(f"  {cat}: {n}")
        return

    conn = psycopg2.connect(
        host=HOST, dbname=DB, user=USER,
        password=password, sslmode="require"
    )
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS question_bank (
            id                 SERIAL PRIMARY KEY,
            text               VARCHAR NOT NULL,
            num_choices        INTEGER NOT NULL,
            choices_text       JSON NOT NULL,
            correct_choices    JSON NOT NULL,
            time_limit_seconds INTEGER,
            category           VARCHAR
        )
    """)
    cur.execute("TRUNCATE TABLE question_bank RESTART IDENTITY")

    imported = 0
    errors   = 0
    for q in questions:
        try:
            cur.execute("""
                INSERT INTO question_bank
                    (text, num_choices, choices_text, correct_choices, time_limit_seconds, category)
                VALUES (%s, %s, %s::json, %s::json, %s, %s)
            """, (
                q["text"],
                q["num_choices"],
                json.dumps(q["choices_text"]),
                json.dumps(q["correct_choices"]),
                q.get("time_limit_seconds"),
                q.get("category"),
            ))
            imported += 1
        except Exception as e:
            print(f"  ✗ Erreur: {q['text'][:50]} -> {e}")
            errors += 1

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n✓ {imported} questions importées dans Postgres")
    if errors:
        print(f"✗ {errors} erreurs")


# ─── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Seed PostgreSQL depuis les docx AZ-900")
    parser.add_argument('--docs-dir', default=DOCS_DIR, help=f"Dossier des docx (défaut: {DOCS_DIR})")
    parser.add_argument('--dry-run', action='store_true', help="Parse sans écrire en base")
    args = parser.parse_args()

    docs_dir = args.docs_dir
    all_questions = []

    # 1. Docx corrigés
    docx_files = sorted(glob.glob(os.path.join(docs_dir, '*.docx')))
    if not docx_files:
        print(f"⚠ Aucun .docx trouvé dans '{docs_dir}'")
    for filepath in docx_files:
        qs = parse_docx(filepath)
        no_answer = sum(1 for q in qs if not q['correct_choices'])
        flag = f"  ⚠ {no_answer} sans réponse" if no_answer else ""
        print(f"  {os.path.basename(filepath)}: {len(qs)} questions{flag}")
        all_questions.extend(qs)

    # 2. README.md
    readme_path = os.path.join(docs_dir, 'README.md')
    if os.path.exists(readme_path):
        qs = parse_readme(readme_path)
        print(f"  README.md: {len(qs)} questions")
        all_questions.extend(qs)
    else:
        print(f"  README.md non trouvé dans '{docs_dir}' (ignoré)")

    print(f"\nTotal: {len(all_questions)} questions")

    # Questions sans réponse = on refuse d'importer
    no_answer_total = sum(1 for q in all_questions if not q['correct_choices'])
    if no_answer_total:
        print(f"\n⛔ {no_answer_total} questions sans réponse détectée. Import annulé.")
        print("   Vérifie que les fichiers sont bien les versions corrigées (surlignage jaune/vert).")
        return

    # Import
    if args.dry_run:
        import_to_postgres(all_questions, None, dry_run=True)
    else:
        password = getpass.getpass(f"\nMot de passe pour {USER}@{HOST}: ")
        import_to_postgres(all_questions, password)


if __name__ == "__main__":
    main()
