"""Local corpus provenance and source balancing; no model calls or credentials."""
import json
from pathlib import Path

MESSAGE_SNAPSHOT = Path(__file__).resolve().parents[1] / 'eval/private/sent-messages.json'

def sent_messages(path=MESSAGE_SNAPSHOT):
    if not path.exists():
        return []
    rows=json.loads(path.read_text())
    return [{'kind':'Paul said', 'where':'imessage '+r['date'][:10], 'source':'imessage',
             'date':r['date'][:10], 'text':r['text']} for r in rows
            if len(r['text'].split())>=3 and len(r['text'])<=1500]

def select_context(docs, scores, k_notes=3, k_said=10):
    ranked=sorted(range(len(docs)),key=lambda i:(-float(scores[i]),i))
    notes=[i for i in ranked if docs[i]['kind']=='memory note'][:k_notes]
    said=[i for i in ranked if docs[i]['kind']=='Paul said']
    # Give relevant everyday messages up to half the examples. Don't force family
    # conversation into an unrelated project query merely to satisfy a quota.
    best=float(scores[said[0]]) if said else 0
    messages=[i for i in said if docs[i].get('source')=='imessage' and float(scores[i])>=best-.10]
    selected=messages[:(k_said+1)//2]
    selected += [i for i in said if i not in selected][:max(0,k_said-len(selected))]
    selected.sort(key=lambda i:(-float(scores[i]),i))
    return [docs[i] for i in notes+selected]
