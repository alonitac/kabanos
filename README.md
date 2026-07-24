# קבנוס – חזרות

אפליקציית חזרות לקבוצת התיאטרון קבנוס.

בוחרים תמונה ותפקיד — האפליקציה מנגנת את ההקלטה ועוצרת בכל שורה שלך, כדי שתאמר אותה לבד.

**לינק:** https://YOUR-USERNAME.github.io/kabanos/

## הכנת הנתונים (חד פעמי)

```bash
export OPENAI_API_KEY="sk-..."
python3 scripts/transcribe.py   # מתמלל את המ"פ3 עם Whisper
python3 scripts/align.py        # מיישר שורות לתמלול → data/scene-XX.json
```

ניתן לערוך ידנית את קבצי ה-JSON בתיקיית `data/` לתיקון חותמות זמן.
