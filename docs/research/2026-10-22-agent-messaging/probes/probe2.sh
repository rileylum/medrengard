#!/bin/bash
S=/var/tmp/software_factory/agent-messaging-research/scratch
NODE=$(dirname $(readlink -f $(which node)))
$NODE/node -e 'for (const p of [18090,18091,18082]) require("net").createServer(s=>{s.end("host port "+p+"\n")}).listen(p,"127.0.0.1")' & L=$!
sleep 0.4
COMMON="--die-with-parent --new-session --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin --ro-bind $NODE $NODE --ro-bind $S $S --proc /proc --dev /dev --tmpfs /tmp"
NONET="--unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup"
C='const net=require("net");const t=(p)=>new Promise(r=>{const s=net.connect(p,"127.0.0.1");let d="";s.on("data",x=>d+=x);s.on("end",()=>r(p+": "+d.trim()));s.on("error",e=>r(p+": ERR "+e.code))});(async()=>{for(const p of [3128,18082,18090]) console.log(await t(p))})()'
echo "== run A: ns 3128 -> host 18090"
pasta -q --splice-only -t none -u none -T 3128:18090 -U none -- bwrap $NONET $COMMON -- $NODE/node -e "$C"
echo "== run B: ns 3128 -> host 18091"
pasta -q --splice-only -t none -u none -T 3128:18091 -U none -- bwrap $NONET $COMMON -- $NODE/node -e "$C"
echo "== run A listens on 4000 for 3s; run B tries 127.0.0.1:4000"
pasta -q --splice-only -t none -u none -T 3128:18090 -U none -- bwrap $NONET $COMMON -- $NODE/node -e 'require("net").createServer(s=>s.end("A\n")).listen(4000,"127.0.0.1");setTimeout(()=>process.exit(),3000)' &
sleep 1
pasta -q --splice-only -t none -u none -T 3128:18091 -U none -- bwrap $NONET $COMMON -- $NODE/node -e 'const s=require("net").connect(4000,"127.0.0.1");s.on("data",d=>console.log("B got",String(d)));s.on("error",e=>console.log("B ->4000:",e.code))'
echo "== host sees A's 4000?"; $NODE/node -e 'const s=require("net").connect(4000,"127.0.0.1");s.on("data",d=>console.log("host got",String(d)));s.on("error",e=>console.log("host ->4000:",e.code))'
echo "== inside: visible pids, ps of host?"; bwrap --unshare-all $COMMON -- /usr/bin/ls /proc | grep -E '^[0-9]+$' | tr '\n' ' '; echo
wait; kill $L
