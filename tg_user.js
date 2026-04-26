const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const http = require('http');
require('dotenv').config();
const S = './tg_session.txt';
const API_ID = parseInt(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;
const PHONE = process.env.TG_PHONE;
const client = new TelegramClient(
  new StringSession(fs.existsSync(S) ? fs.readFileSync(S,'utf8').trim() : ''),
  API_ID, API_HASH, { connectionRetries: 5 }
);
const G = [
  {id:-1003878856462,n:'חמל יוסי ביטחון'},
  {id:-1003997992718,n:'חמל יוסי כלכלה'},
  {id:-1001397114707,n:'ynet'},
  {id:-1001474443960,n:'מבזקי רעם'},
  {id:-1001985312884,n:'חדשות אמת'},
  {id:-1001441886157,n:'פיקוד העורף'},
  {id:-1001278471006,n:'חדשות מתפרצות'},
  {id:-1001005381772,n:'SANA'},
  {id:-1001622926957,n:'חמל ערים'},
];
let msgs = [], seen = new Set(), last = {};
async function poll() {
  for (const g of G) {
    try {
      const m = await client.getMessages(g.id, {limit:5, minId:last[g.id]||0});
      for (const x of m) {
        if (!x.text || seen.has(x.id)) continue;
        seen.add(x.id);
        last[g.id] = Math.max(last[g.id]||0, x.id);
        msgs.unshift({id:'u'+x.id, chatName:g.n, text:x.text, timestamp:x.date*1000, severity:'medium', source:'tg_user'});
        console.log('💬['+g.n+']:', x.text.slice(0,60));
      }
    } catch(e) {}
    await new Promise(r=>setTimeout(r,300));
  }
  msgs = msgs.slice(0,500);
}
(async()=>{
  await client.start({phoneNumber: async()=>PHONE, onError: ()=>{}});
  fs.writeFileSync(S, client.session.save());
  console.log('OK', G.length, 'groups');
  for (const g of G) {
    try { const m=await client.getMessages(g.id,{limit:1}); if(m[0]){last[g.id]=m[0].id;seen.add(m[0].id);} } catch {}
    await new Promise(r=>setTimeout(r,200));
  }
  console.log('ready - listening');
  setInterval(poll, 10000);
  http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(msgs));
  }).listen(3001, ()=>console.log('API:3001'));
  await new Promise(()=>{});
})().catch(console.error);
