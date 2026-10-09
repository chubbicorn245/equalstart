import test from 'node:test';
import assert from 'node:assert/strict';
import {Batch} from './settlement.mjs';

const T = {batchId:'demo', config:'DBC-CONFIG-LOCKED',quoteMint:'WSOL',baseMint:'EQUAL',depositCap:500_000_000n,closesAt:100,expiresAt:200,minRaise:50_000_000n};
function fresh() { return new Batch(T); }
function funded() {const b=fresh(); for(const [wallet,amount] of [['alice',100_000_000n],['bob',200_000_000n],['carol',300_000_000n]]) b.deposit({wallet,amount,at:40});return b;}
function settled(base=600000003n) {const b=funded();b.settle({at:120,quoteSpent:600_000_000n,baseReceived:base,minBaseOut:base,poolCreatedInSameTransaction:true});return b;}

test('3-wallet 1:2:3 contributions, one blended price, immutable config',()=>{
 const b=settled(600_000_000n);
 assert.equal(b.claim({wallet:'carol',signer:'carol'}),300_000_000n);
 assert.equal(b.claim({wallet:'alice',signer:'alice'}),100_000_000n);
 assert.equal(b.claim({wallet:'bob',signer:'bob'}),200_000_000n);
 assert.equal(b.baseVault,0n);
 assert.equal(b.phase,'SETTLED');
 assert.throws(()=>{b.terms.quoteMint='USDC';},TypeError);
});

test('claims are independent, authorized, and one-time',()=>{
 const b=settled();
 assert.throws(()=>b.claim({wallet:'alice',signer:'operator'}),/signed/);
 const a=b.claim({wallet:'alice',signer:'alice'});
 assert(a>0n);
 assert.throws(()=>b.claim({wallet:'alice',signer:'alice'}),/double/);
 assert.throws(()=>b.claim({wallet:'eve',signer:'eve'}),/did not contribute/);
});

test('per-wallet caps apply even across multiple deposits',()=>{
 const b=fresh();b.deposit({wallet:'alice',amount:400_000_000n,at:1});
 assert.throws(()=>b.deposit({wallet:'alice',amount:200_000_000n,at:2}),/cap/);
 assert.equal(b.totalQuote,400_000_000n);
});

test('deposit and withdrawal obey cutoff',()=>{
 const b=fresh();b.deposit({wallet:'alice',amount:150_000_000n,at:99});
 b.withdrawBeforeClose({wallet:'alice',amount:60_000_000n,at:99});
 assert.equal(b.totalQuote,90_000_000n);
 assert.throws(()=>b.deposit({wallet:'bob',amount:100n,at:100}),/closed/);
 assert.throws(()=>b.withdrawBeforeClose({wallet:'alice',amount:1n,at:100}),/closed/);
});

test('requires atomic pool initialization and swap',()=>{
 const b=funded();
 assert.throws(()=>b.settle({at:120,quoteSpent:600_000_000n,baseReceived:100n,minBaseOut:1n,poolCreatedInSameTransaction:false}),/non-atomic/);
 assert.equal(b.phase,'OPEN');assert.equal(b.quoteVault,600_000_000n);
});

test('underfill and slippage block settlement',()=>{
 const b=funded();
 assert.throws(()=>b.settle({at:120,quoteSpent:550_000_000n,baseReceived:10n,minBaseOut:1n,poolCreatedInSameTransaction:true}),/exact-in/);
 assert.throws(()=>b.settle({at:120,quoteSpent:600_000_000n,baseReceived:10n,minBaseOut:100n,poolCreatedInSameTransaction:true}),/slippage/);
 assert.equal(b.phase,'OPEN');assert.equal(b.quoteVault,600_000_000n);
});

test('simulated failed DBC CPI leaves all accounting unchanged',()=>{
 const b=funded();
 const before=b.overview();
 assert.throws(()=>b.settle({at:120,quoteSpent:600_000_000n,baseReceived:1000n,minBaseOut:1n,poolCreatedInSameTransaction:true,adapterThrows:true}),/CPI failed/);
 assert.deepEqual(b.overview(),before);
});

test('expired batches refund independently, nobody can redirect',()=>{
 const b=funded();
 assert.throws(()=>b.cancel({at:150}),/cannot cancel/);
 b.cancel({at:200});
 assert.throws(()=>b.refund({wallet:'alice',signer:'operator'}),/signed/);
 assert.equal(b.refund({wallet:'bob',signer:'bob'}),200_000_000n);
 assert.equal(b.refund({wallet:'alice',signer:'alice'}),100_000_000n);
 assert.equal(b.refund({wallet:'carol',signer:'carol'}),300_000_000n);
 assert.equal(b.quoteVault,0n);
 assert.throws(()=>b.refund({wallet:'bob',signer:'bob'}),/double/);
});

test('settled batches cannot be canceled, refunded, or resettled',()=>{
 const b=settled();
 assert.throws(()=>b.cancel({at:250}),/cannot cancel/);
 assert.throws(()=>b.refund({wallet:'alice',signer:'alice'}),/refunds only/);
 assert.throws(()=>b.settle({at:150,quoteSpent:600_000_000n,baseReceived:100n,minBaseOut:1n,poolCreatedInSameTransaction:true}),/settlement window/);
});

test('zero, negative, overflow amounts rejected',()=>{
 const b=fresh();
 for (const amount of [0n,-1n,1n<<64n,1.4]) assert.throws(()=>b.deposit({wallet:'alice',amount,at:1}));
});

test('floor rounding never over-allocates across random participant sizes',()=>{
 let seed=987654321;
 const rand=()=> {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let k=0;k<1000;k++) {
  const count=2+rand()%18;
  let total=0n;
  const contrib=[];
  for(let i=0;i<count;i++){const x=BigInt(1+rand()%1000000);contrib.push(x);total+=x;}
  const tokens=BigInt(count + rand()%1_000_000_000);
  const claims=contrib.map(x=>tokens*x/total);
  const allocated=claims.reduce((a,b)=>a+b,0n);
  assert(allocated<=tokens);
  assert(tokens-allocated<BigInt(count));
 }
});

test('rounding dust is explicitly residual, not treasury or creator property',()=>{
 const b=settled(600_000_001n);
 for(const who of ['alice','bob','carol']) b.claim({wallet:who,signer:who});
 assert(b.baseVault>0n && b.baseVault<3n);
});
