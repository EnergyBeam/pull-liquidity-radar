import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import monitor as m

def pool(score=80, pid='solana:one'):
    return dict(id=pid, chain='solana', symbol='TEST', quote='WSOL', liquidity=30000,
                v1=30000, v5=2500, change1=.5, createdAt=None, fetchedAt=1,
                url='https://example.com', rating=dict(score=score, regime='Наблюдение', reasons=[]))

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=m.DATA; m.DATA=Path(self.tmp.name)
        self.db=m.connect(); self.cfg={**m.DEFAULT,'enabled':True,'chains':['solana'],'chat_id':'123'}
        m.save(self.db,self.cfg)
    def tearDown(self):
        self.db.close(); m.DATA=self.old; self.tmp.cleanup()
    def test_network_quote_assets(self):
        for chain, accepted in m.PAIR_ASSETS.items():
            for asset in accepted:
                self.assertTrue(m.is_target_pair(dict(chain=chain,symbol='MEME',quote=asset+' 0.3%')))
                self.assertTrue(m.is_target_pair(dict(chain=chain,symbol=asset,quote='MEME')))
            self.assertEqual(m.is_target_pair(dict(chain=chain,symbol='MEME',quote='USDC')),chain=='base')
        self.assertFalse(m.is_target_pair(dict(chain='solana',symbol='MEME',quote='USDG')))
        self.assertFalse(m.is_target_pair(dict(chain='base',symbol='MEME',quote='BNB')))
        self.assertFalse(m.is_target_pair(dict(chain='unknown',symbol='MEME',quote='SOL')))
    def test_two_observations(self):
        self.assertFalse(m.observe(self.db,pool(),self.cfg,100000))
        self.assertTrue(m.observe(self.db,pool(),self.cfg,100120))
    def test_baseline_no_flood(self):
        self.assertFalse(m.observe(self.db,pool(),self.cfg,100000,True))
        self.assertFalse(m.observe(self.db,pool(),self.cfg,100120))
    def test_missing_and_low_tvl(self):
        for p in [pool(None),{**pool(),'liquidity':1}]:
            self.assertFalse(m.observe(self.db,p,self.cfg,100000))
            self.assertFalse(m.observe(self.db,p,self.cfg,100120))
    def test_gap_breaks_confirmation(self):
        m.observe(self.db,pool(),self.cfg,100000)
        self.assertFalse(m.observe(self.db,pool(),self.cfg,101000))
    def test_rearm_and_cooldown(self):
        m.observe(self.db,pool(),self.cfg,100000)
        self.db.execute('UPDATE pools SET armed=0,sent=100000'); self.db.commit()
        m.observe(self.db,pool(60),self.cfg,100120)
        m.observe(self.db,pool(),self.cfg,100240)
        self.assertFalse(m.observe(self.db,pool(),self.cfg,100360))
        m.observe(self.db,pool(),self.cfg,130000)
        self.assertTrue(m.observe(self.db,pool(),self.cfg,130120))
    def test_restart_preserves_reservation(self):
        m.observe(self.db,pool(),self.cfg,100000)
        self.db.execute('UPDATE pools SET armed=0,sent=100000'); self.db.commit()
        self.db.close(); self.db=m.connect()
        self.assertFalse(m.observe(self.db,pool(),self.cfg,100120))
    def test_failed_network_breaks_streak(self):
        m.observe(self.db,pool(),self.cfg,100000)
        def fail(_): raise m.ApiError(429)
        m.cycle(self.db,self.cfg,'dummy',fetch=fail)
        self.assertEqual(self.db.execute('SELECT streak FROM pools').fetchone()[0],0)
    def test_ambiguous_delivery_not_repeated(self):
        self.db.execute("INSERT INTO baseline VALUES('solana')"); self.db.commit()
        m.observe(self.db,pool(),self.cfg,100000)
        calls=[]
        def sender(*args): calls.append(1); raise m.ApiError()
        with patch.object(m.time,'time',return_value=100120):
            m.cycle(self.db,self.cfg,'dummy',fetch=lambda _: [pool()],scorer=lambda p,c:p,sender=sender)
            m.cycle(self.db,self.cfg,'dummy',fetch=lambda _: [pool()],scorer=lambda p,c:p,sender=sender)
        self.assertEqual(len(calls),1)
    def test_429_retries_after_requested_delay(self):
        self.db.execute("INSERT INTO baseline VALUES('solana')"); self.db.commit()
        m.observe(self.db,pool(),self.cfg,100000)
        def sender(*args): raise m.ApiError(429,600)
        with patch.object(m.time,'time',return_value=100120):
            delay=m.cycle(self.db,self.cfg,'dummy',fetch=lambda _: [pool()],scorer=lambda p,c:p,sender=sender)
        self.assertEqual(delay,600)
        self.assertEqual(self.db.execute('SELECT armed FROM pools').fetchone()[0],1)
    def test_shared_scoring_engine(self):
        p=pool(); p['fetchedAt']=m.time.time()*1000
        r=m.rate([p],self.cfg)[0]['rating']
        self.assertGreaterEqual(r['score'],75)
    def test_dpapi(self):
        secret='synthetic-test-token'
        ciphertext=m.protect(secret)
        self.assertNotIn(secret,ciphertext)
        self.assertEqual(m.protect(ciphertext,True),secret)

if __name__=='__main__': unittest.main()
