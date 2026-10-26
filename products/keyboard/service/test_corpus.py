import json,tempfile,unittest
from pathlib import Path
from corpus import sent_messages,select_context

class CorpusTests(unittest.TestCase):
    def test_messages_are_labelled_and_short_replies_dont_fill_context(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'messages.json'
            p.write_text(json.dumps([{'date':'2026-10-01T12:00:00Z','text':'see you at dinner'},
                                     {'date':'2026-10-01T12:00:00Z','text':'ok'}]))
            docs=sent_messages(p)
            self.assertEqual(len(docs),1)
            self.assertEqual(docs[0]['source'],'imessage')
            self.assertEqual(docs[0]['kind'],'Paul said')
    def test_relevant_messages_share_context_with_agent_prompts(self):
        docs=[{'kind':'Paul said','source':'codex','text':str(i)} for i in range(8)]
        docs += [{'kind':'Paul said','source':'imessage','text':'message'+str(i)} for i in range(5)]
        found=select_context(docs,[.8]*8+[.75]*5,k_notes=0,k_said=6)
        self.assertEqual(sum(d['source']=='imessage' for d in found),3)
        self.assertEqual(len({d['text'] for d in found}),6)
    def test_no_irrelevant_message_padding_and_no_notes_in_voice_examples(self):
        docs=[{'kind':'memory note','text':'not Paul'}, {'kind':'Paul said','source':'codex','text':'project'},
              {'kind':'Paul said','source':'imessage','text':'dinner'}]
        found=select_context(docs,[.99,.9,.5],k_notes=0,k_said=1)
        self.assertEqual(found,[docs[1]])
    def test_empty_and_missing_snapshot_are_safe(self):
        self.assertEqual(select_context([],[],0,6),[])
        self.assertEqual(sent_messages(Path('/nonexistent-usual-source')),[])
if __name__=='__main__':unittest.main()
