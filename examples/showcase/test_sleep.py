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
                {'date': '2020-01-03', 'asleepMinutes': 60, 'stages': {}},
                {'date': '2020-01-03', 'asleepMinutes': 400, 'stages': {}},
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


class StageTimelineTest(unittest.TestCase):
    def test_primary_source_and_adjacent_awake_intervals(self):
        from sleep_stages import stage_timeline
        def row(start, end, stage, source=1):
            return {'start': start*60000, 'end': end*60000, 'stage': 'HKCategoryValueSleepAnalysis'+stage, 'source': source}
        rows = [row(0,10,'AsleepCore'),row(10,11,'Awake'),row(11,13,'Awake'),row(13,23,'AsleepDeep'),row(23,33,'AsleepREM'),row(0,30,'AsleepUnspecified',2)]
        result = stage_timeline({'start':0,'end':33*60000,'asleepMinutes':30},rows)
        self.assertEqual([r['stage'] for r in result], ['core','awake','deep','rem'])
        self.assertEqual(result[1], {'start':10.0,'end':13.0,'stage':'awake'})
        self.assertNotIn('source', result[0])

    def test_gaps_are_unknown_and_conflicting_asleep_records_are_rejected(self):
        from sleep_stages import stage_timeline
        rows=[{'start':0,'end':600000,'stage':'HKCategoryValueSleepAnalysisAsleepCore','source':1},{'start':900000,'end':1500000,'stage':'HKCategoryValueSleepAnalysisAsleepREM','source':1}]
        result=stage_timeline({'start':0,'end':1500000,'asleepMinutes':20},rows)
        self.assertEqual(result[1]['stage'],'unknown')
        rows[1]['start']=300000
        with self.assertRaisesRegex(ValueError,'reconcile'):
            stage_timeline({'start':0,'end':1500000,'asleepMinutes':30},rows)

class PreOnlySleepTest(unittest.TestCase):
    def test_latest_sleep_before_milestone_is_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'input.json').write_text(json.dumps({'nights':[{'date':'2020-01-01','asleepMinutes':480,'stages':{}}]}))
            subprocess.run(['python3',str(Path(__file__).with_name('prepare-sleep.py')),str(root/'input.json'),str(root/'output.json'),'--milestone','2020-01-02'],check=True,capture_output=True)
            milestone=json.loads((root/'output.json').read_text())['milestones'][0]
            self.assertEqual(milestone['availableThrough'],-1)
            self.assertEqual(next(day for day in milestone['days'] if day['offset']==-1)['minutes'],480)

if __name__ == '__main__':
    unittest.main()
