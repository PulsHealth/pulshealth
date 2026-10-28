import json
from pathlib import Path
import subprocess
import tempfile
import unittest

class SleepAdapterTest(unittest.TestCase):
    def test_longest_main_session_and_relative_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = {'nights': [
                {'date': '2020-01-01', 'asleepMinutes': 480, 'stages': {'core': 300, 'rem': 100, 'deep': 80, 'awake': 0}, 'sources': ['private source']},
                {'date': '2020-01-02', 'asleepMinutes': 60, 'stages': {}},
                {'date': '2020-01-02', 'asleepMinutes': 400, 'stages': {}},
            ]}
            (root/'input.json').write_text(json.dumps(source))
            subprocess.run(['python3', str(Path(__file__).with_name('prepare-sleep.py')), str(root/'input.json'), str(root/'output.json'), '--milestone', '2020-01-02'], check=True, capture_output=True)
            text = (root/'output.json').read_text()
            self.assertNotIn('2020', text)
            self.assertNotIn('private source', text)
            milestone = json.loads(text)['milestones'][0]
            days = {day['offset']: day for day in milestone['days']}
            self.assertEqual(milestone['availableThrough'], 0)
            self.assertEqual(days[0]['minutes'], 400)
            self.assertIsNone(days[0]['awake'])
            self.assertEqual(days[-1]['awake'], 0)
            self.assertIsNone(days[-2]['minutes'])

if __name__ == '__main__':
    unittest.main()
