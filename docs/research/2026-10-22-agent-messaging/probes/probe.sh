#!/bin/bash
S=/var/tmp/software_factory/agent-messaging-research/scratch; cd $S
NODE=$(dirname $(readlink -f $(which node)))
$NODE/node -e 'require("net").createServer(s=>{s.end("host-ok\n")}).listen(18080,"127.0.0.1")' & L=$!
$NODE/node -e 'require("net").createServer(s=>{s.end("abs-ok\n")}).listen("\0sf-probe-abs")' & A=$!
sleep 0.5
COMMON="--die-with-parent --new-session --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin --ro-bind $NODE $NODE --ro-bind $S $S --proc /proc --dev /dev --tmpfs /tmp"
NONET="--unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup"
echo "== share-net"; bwrap --unshare-all --share-net $COMMON -- $NODE/node $S/client.js
echo "== no net"; bwrap --unshare-all $COMMON -- $NODE/node $S/client.js
echo "== pasta --splice-only -T 18080"
time pasta -q --splice-only -t none -u none -T 18080 -U none -- bwrap $NONET $COMMON -- $NODE/node $S/client.js
echo "== pasta --config-net, no port fwd"
time pasta -q --config-net -t none -u none -T none -U none -- bwrap $NONET $COMMON -- $NODE/node $S/client.js
echo "== timing: bwrap --unshare-all true"; time bwrap --unshare-all $COMMON -- true
echo "== timing: pasta splice-only + bwrap true"; time pasta -q --splice-only -t none -u none -T 18080 -U none -- bwrap $NONET $COMMON -- true
echo "== timing: pasta config-net + bwrap true"; time pasta -q --config-net -t none -u none -T none -U none -- bwrap $NONET $COMMON -- true
echo "== bwrap bind unix socket path"
$NODE/node -e 'require("net").createServer(s=>{s.end("path-ok\n")}).listen(process.argv[1])' $S/broker.sock & P=$!; sleep 0.3
bwrap --unshare-all $COMMON --bind $S/broker.sock /tmp/broker.sock -- $NODE/node -e 'const s=require("net").connect("/tmp/broker.sock");s.on("data",d=>process.stdout.write("unix path: "+d));s.on("error",e=>console.log("unix path ERR",e.code))'
kill $L $A $P; rm -f $S/broker.sock
