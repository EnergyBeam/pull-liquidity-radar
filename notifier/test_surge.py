import unittest,tempfile
from pathlib import Path
from unittest.mock import patch
import monitor as m
from test_monitor import pool
class SurgeTests(unittest.TestCase):
 def test_low_score_spike_sends_once_and_not_for_other_pairs(self):
  with tempfile.TemporaryDirectory() as tmp:
   old=m.DATA;m.DATA=Path(tmp)
   try:
    db=m.connect();cfg={**m.DEFAULT,'chains':['solana'],'enabled':True,'chat_id':'test'};m.save(db,cfg)
    db.execute("INSERT INTO baseline VALUES('solana')");db.commit()
    p=pool(20);p.update(volumeSignal=dict(kind='surge',ratio=5,peak=5000,peakAt=100000000,at=100000000))
    sent=[]
    with patch.object(m.time,'time',return_value=100000),patch.object(m.time,'sleep'):
     for _ in range(2):m.cycle(db,cfg,'fake',fetch=lambda c:[p],scorer=lambda ps,c:ps,sender=lambda *args:sent.append(args))
     other={**p,'id':'solana:other','quote':'USDC'}
     m.cycle(db,cfg,'fake',fetch=lambda c:[other],scorer=lambda ps,c:ps,sender=lambda *args:sent.append(args))
    self.assertEqual(len(sent),1)
    self.assertIn('РЕЗКИЙ РОСТ',sent[0][2]['text'])
    self.assertNotIn('двумя проверками',sent[0][2]['text'])
    db.close()
   finally:m.DATA=old
if __name__=='__main__':unittest.main()
