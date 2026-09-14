import unittest,time
from collector import pools_response,Handler,ORIGIN,PORT
class CollectorTests(unittest.TestCase):
 def test_origin_and_host(self):
  h=object.__new__(Handler)
  for origin,host,expected in [(ORIGIN,f'127.0.0.1:{PORT}',True),('https://evil.example',f'127.0.0.1:{PORT}',False),(ORIGIN,'evil.example',False)]:
   h.headers={'Origin':origin,'Host':host};self.assertEqual(h.allowed(),expected)
 def test_stale_time_retained(self):
  p={'id':'x','chain':'base','symbol':'TEST','quote':'USDC','fetchedAt':123}
  r=pools_response({'chain':['base']},{'chains':{'base':{'pools':[p],'error':'rate limit'}}})
  self.assertEqual(r['pools'][0]['fetchedAt'],123);self.assertTrue(r['errors'])
 def test_validation(self):
  for q in [{'chain':['bad']},{'chain':['all'],'token':['x']},{'chain':['base'],'ids':['bad']}]:
   with self.assertRaises(ValueError):pools_response(q,{})
if __name__=='__main__':unittest.main()
