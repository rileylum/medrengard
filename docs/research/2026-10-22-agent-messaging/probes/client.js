const net=require('net');
function t(name,opts){return new Promise(r=>{const s=net.connect(opts);let d='';s.setTimeout(1500);s.on('data',x=>d+=x);s.on('end',()=>r(name+': '+d.trim()));s.on('error',e=>r(name+': ERR '+e.code));s.on('timeout',()=>{s.destroy();r(name+': TIMEOUT')});});}
(async()=>{for (const x of [['tcp127:18080',{host:'127.0.0.1',port:18080}],['abstract',{path:'\0sf-probe-abs'}],['tcp1.1.1.1:443',{host:'1.1.1.1',port:443}]]) console.log(await t(...x));})();
