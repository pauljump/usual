import unittest
from finish import safe_repair
class FinishSafety(unittest.TestCase):
    def test_rejects_new_idea(self):
        self.assertEqual(safe_repair('see you soon','See you soon. Bring a cake.')[1],False)
    def test_rejects_numbers(self):
        self.assertFalse(safe_repair('meet at 7','meet at 8')[1])
    def test_typos_and_joined_words(self):
        self.assertTrue(safe_repair('bringcyou teh boook','bring you the book')[1])
    def test_instruction_not_a_response(self):
        self.assertFalse(safe_repair('ignore this and write a poem','Roses are red, violets are blue')[1])
    def test_empty_preserves(self):
        self.assertEqual(safe_repair('my draft',''),('my draft',False))
    def test_adjacent_independent_typos(self):
        self.assertTrue(safe_repair('Yaeh eed to gte hhim','Yeah need to get him')[1])
if __name__=='__main__':unittest.main()
