import unittest
from links import links, link_text
from monitor import message, DEFAULT

class LinkTests(unittest.TestCase):
    def test_token_is_not_pool(self):
        token='A'*32; address='B'*32
        gmgn,label,lp=links(dict(chain='solana',token=token,address=address,dex='meteora'))
        self.assertEqual(gmgn,'https://gmgn.ai/sol/token/'+token)
        self.assertEqual(lp,'https://app.meteora.ag/dlmm/'+address)
    def test_damm_v2(self):
        self.assertIn('/dammv2/',links(dict(chain='solana',token='A'*32,address='B'*32,dex='meteora-damm-v2'))[2])
    def test_other_solana_dex_not_meteora(self):
        self.assertIsNone(links(dict(chain='solana',token='A'*32,address='B'*32,dex='raydium'))[2])
    def test_pancake_link(self):
        self.assertIn('protocol=pancakev3',links(dict(chain='bsc',address='0x'+'a'*40,dex='pancakeswap-v3'))[2])
    def test_robinhood_v4(self):
        gmgn,_,lp=links(dict(chain='robinhood',token='0x'+'a'*40,address='0x'+'b'*64,dex='uniswap-v4-robinhood'))
        self.assertIn('/robinhood/token/0x'+'a'*40,gmgn)
        self.assertIn('chainId=4663',lp)
        self.assertIn('protocol=uniswapv4',lp)
    def test_injection_rejected(self):
        gmgn,_,lp=links(dict(chain='solana',token='bad\nhttps://evil.example',address='bad',dex='meteora'))
        self.assertIsNone(gmgn);self.assertIsNone(lp)
    def test_message_has_volume_and_links(self):
        p=dict(chain='solana',token='A'*32,address='B'*32,dex='meteora',symbol='A',quote='SOL',liquidity=10000,v1=20000,v5=1500,change1=1,url='https://www.geckoterminal.com/',rating=dict(score=80,regime='test',reasons=[]))
        text=message(p,DEFAULT)
        self.assertIn('Объём пула 5м $1,500',text)
        self.assertIn('GMGN: https://gmgn.ai/sol/token/',text)
        self.assertIn('Meteora: https://app.meteora.ag/dlmm/',text)

if __name__=='__main__':unittest.main()
