import sqlite3
import json

conn = sqlite3.connect("quiz.db")
cursor = conn.execute("SELECT * FROM question_bank")
rows = cursor.fetchall()
cols = [d[0] for d in cursor.description]

questions = [dict(zip(cols, row)) for row in rows]

with open("questions_export.json", "w", encoding="utf-8") as f:
    json.dump(questions, f, ensure_ascii=False, indent=2)

print(f"{len(questions)} questions exportées dans questions_export.json")
conn.close()